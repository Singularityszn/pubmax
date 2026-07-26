// "We're out" check-ins (Social Loop v1). POST creates a lightweight, area-level
// check-in; GET reads the viewer's "Your lot" check-ins (friends-only, mutual
// follows) OR the area-public set — always through the single privacy choke
// (lib/socialFeed.ts), never straight from the store.
//
// The POST author is the self-asserted handle (resolved to the JWT-linked handle
// when signed in), the same demo identity that authors a pint drop or a follow.
// Writes go through the service role (check_ins has no anon policy). Certified as
// a mutating surface via the durable rate limit boundary (isLimited).

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { validateCheckInInput, type CheckInInputRaw } from "@/lib/checkIn";
import { isCheckInLimited } from "@/lib/checkInRateLimit";
import { checkInStore } from "@/lib/checkInStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { resolveViewerFromRequest } from "@/lib/pintDropViewer";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { areaPublicCheckIns, visibleCheckInsForViewer } from "@/lib/socialFeed";
import { isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";
import { getPostHogNodeClient } from "@/lib/posthogServer";

assertServerEnv();

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Dev/test only: allow self-asserted ?viewer= when JWT does not resolve. */
function allowQueryViewerFallback(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

/**
 * Friends-gated "Your lot" viewer — same posture as pint-drops (#29):
 * JWT → profiles.user_id → handle is authoritative; ?viewer= is a
 * dev/test fallback only and never unlocks friends reads in production.
 */
async function resolveCheckInViewer(request: Request, queryViewer?: string): Promise<string> {
  const resolved = await resolveViewerFromRequest(request);
  let handle = resolved.handle ? normalizeViewerHandle(resolved.handle) : "";
  if (!handle && allowQueryViewerFallback() && queryViewer) {
    handle = normalizeViewerHandle(queryViewer);
  }
  return handle;
}

// GET /api/check-ins?viewer=<handle>  → the viewer's "Your lot" check-ins.
// GET /api/check-ins?scope=area       → the area-public check-ins (visibility 'area').
// Read-only; the privacy choke (lib/socialFeed.ts) decides what is returned.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const queryViewer = readString(url.searchParams.get("viewer") ?? undefined);
  const scope = readString(url.searchParams.get("scope") ?? undefined);

  try {
    if (scope === "area") {
      const checkIns = await areaPublicCheckIns();
      return jsonNoStore({ checkIns }, { status: 200 });
    }
    // Default + viewer path: the friends-only "Your lot" read. No verified
    // viewer (anonymous / spoofed query in production) resolves to an empty
    // list inside the choke, never a leak.
    const viewer = await resolveCheckInViewer(request, queryViewer);
    const checkIns = await visibleCheckInsForViewer(viewer);
    return jsonNoStore({ checkIns }, { status: 200 });
  } catch {
    // Fail-soft read: an empty list keeps the feed tab honest, never a crash.
    return jsonNoStore({ checkIns: [] }, { status: 200 });
  }
}

export async function POST(request: Request): Promise<Response> {
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
      "Set a handle first. Drop a pint to claim one.",
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
    const checkIn = await checkInStore().create(validation.value);
    const phClient = getPostHogNodeClient();
    if (phClient) {
      phClient.capture({
        distinctId: ownership.handle,
        event: "check_in_created",
        properties: { area_slug: validation.value.areaSlug },
      });
      await phClient.shutdown();
    }
    return jsonNoStore({ checkIn }, { status: 201 });
  } catch {
    return publicApiError("Check-in storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
