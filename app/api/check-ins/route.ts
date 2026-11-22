// "We're out" check-ins (Social Loop v1). POST creates a lightweight, area-level
// check-in — area is optional, so a no-area check-in is a plain "out tonight"
// presence signal; GET reads the viewer's "Your lot" check-ins (friends-only,
// mates) OR the area-public set — always through the single privacy choke
// (lib/socialFeed.ts), never straight from the store; DELETE ends the caller's
// own check-in early ("turn off"). The "Your lot" read answers only a verified
// Social reader from the Authorization bearer, as GET /api/presence does.
//
// The POST/DELETE author is the self-asserted handle (resolved to the
// JWT-linked handle when signed in), the same demo identity that authors a
// pint drop or a follow. Writes go through the service role (check_ins has no
// anon policy). Certified as a mutating surface via the durable rate limit
// boundary (isLimited).

import { accountAdultWriteRefusal } from "@/lib/adultOnFile.server";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { projectPublicAuthors } from "@/lib/avatarResolve";
import { validateCheckInInput, type CheckInInputRaw } from "@/lib/checkIn";
import { isCheckInLimited } from "@/lib/checkInRateLimit";
import { checkInStore } from "@/lib/checkInStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { gateHandleAction, gateHasVerifiedActor } from "@/lib/profileOwnership";
import { profileStore } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { areaPublicCheckIns, visibleCheckInsForViewer } from "@/lib/socialFeed";
import { isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";
import { fulfilWantedsForHandleAtVenue } from "@/lib/wantedFulfil.server";
import { wantedFulfilledLine } from "@/lib/wanted";

assertServerEnv();

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

// GET /api/check-ins             → the verified reader's "Your lot" check-ins.
// GET /api/check-ins?scope=area  → the area-public check-ins (visibility 'area').
// Read-only; the privacy choke (lib/socialFeed.ts) decides what is returned.
export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const scope = readString(new URL(request.url).searchParams.get("scope") ?? undefined);

  try {
    if (scope === "area") {
      const checkIns = await projectPublicAuthors(await areaPublicCheckIns());
      return jsonNoStore({ checkIns }, { status: 200 });
    }
    // The friends-only "Your lot" read. A cookie cannot authorise it, and a
    // reader who is not a verified Social actor gets an empty list, never a leak.
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    const access = await requireVerifiedSocialActor(new Request(request.url, { headers }));
    if (!access.ok) return jsonNoStore({ checkIns: [] }, { status: 200 });
    const checkIns = await projectPublicAuthors(await visibleCheckInsForViewer(access.actor));
    return jsonNoStore({ checkIns }, { status: 200 });
  } catch {
    // Fail-soft read: an empty list keeps the feed tab honest, never a crash.
    return jsonNoStore({ checkIns: [] }, { status: 200 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  // Solo-operator emergency freeze (U15): posting a check-in is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // JWT-linked handle wins over a self-asserted body.handle when signed in.
  const handle = await resolveMessageHandle(request, readString(body.handle));
  if (!handle) {
    return publicApiError(
      "Choose a handle in your account first.",
      "HANDLE_REQUIRED",
      400,
    );
  }

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    // A 5xx from the ownership store is a transient dependency (retryable); a
    // 4xx is a correction the caller must make (auth/pick another handle).
    const retryable = ownership.status >= 500;
    return publicApiError(
      ownership.error,
      retryable ? "STORE_UNAVAILABLE" : "HANDLE_FORBIDDEN",
      ownership.status,
      { retryable },
    );
  }
  // A check-in tells mates where a person is, so a signed-in account must pass the adult gate.
  if (ownership.callerUserId) {
    const adultRefusal = await accountAdultWriteRefusal(ownership.callerUserId);
    if (adultRefusal) return adultRefusal;
  }

  // Rate-limit per handle + hashed IP so check-ins can't be spammed (raw IP is
  // never keyed). The shared factory keys the in-memory and durable axes on the
  // SAME `check-in:<handle>:<ipHash>` key. This is also the route's
  // certification boundary (rate_limit).
  if (await isCheckInLimited(request, ownership.handle)) {
    return publicApiError("Too many check-ins, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Check-in storage is not configured.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  // Validate against the resolved handle (never the raw body handle).
  const raw: CheckInInputRaw = { ...body, handle: ownership.handle };
  const validation = validateCheckInInput(raw);
  if (!validation.ok) {
    return publicApiError(validation.error, "INVALID_REQUEST", 400);
  }

  try {
    // A check-in hangs off its author's profile row. A signed-in author's row
    // was created, owned, by the gate. An anonymous check-in may only use a row
    // that already exists: minting one would leave it unowned, and an unowned
    // row is frozen against the account that later claims the handle.
    if (
      !gateHasVerifiedActor(ownership) &&
      !(await profileStore().getByHandle(ownership.handle))
    ) {
      return publicApiError("Sign in to check in.", "UNAUTHENTICATED", 401);
    }
    const checkIn = await checkInStore().create(validation.value);
    let wantedNote: string | undefined;
    let wantedFulfilled = 0;
    if (validation.value.venueId) {
      const fulfilled = await fulfilWantedsForHandleAtVenue(
        ownership.handle,
        validation.value.venueId,
      );
      wantedFulfilled = fulfilled.length;
      if (fulfilled[0]) wantedNote = wantedFulfilledLine(fulfilled[0].venueName);
    }
    return jsonNoStore(
      {
        checkIn,
        ...(wantedFulfilled > 0 ? { wantedFulfilled, wantedNote } : {}),
      },
      { status: 201 },
    );
  } catch {
    return publicApiError("Check-in storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

// DELETE /api/check-ins → ends a check-in early ("turn off"). Deliberately
// skips socialFreezeResponse: turning off is safety-reducing, so it must never
// be blocked by a solo-operator emergency freeze of social writes. Hard-deletes
// every check-in the caller authored — a check-in is single-purpose (one
// "we're out" state per handle) and short-lived by design (12h TTL), so
// deleteForHandle needs no extra scoping to stay correct.
export async function DELETE(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = await resolveMessageHandle(request, readString(body.handle));
  if (!handle) {
    return publicApiError(
      "Choose a handle in your account first.",
      "HANDLE_REQUIRED",
      400,
    );
  }

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    const retryable = ownership.status >= 500;
    return publicApiError(
      ownership.error,
      retryable ? "STORE_UNAVAILABLE" : "HANDLE_FORBIDDEN",
      ownership.status,
      { retryable },
    );
  }

  if (await isCheckInLimited(request, ownership.handle)) {
    return publicApiError("Too many check-ins, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Check-in storage is not configured.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  try {
    await checkInStore().deleteForHandle(ownership.handle);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Check-in storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
