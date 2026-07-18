// "We're out" check-ins (Social Loop v1). POST creates a lightweight, area-level
// check-in; GET reads the viewer's "Your lot" check-ins (friends-only, mutual
// follows) OR the area-public set — always through the single privacy choke
// (lib/socialFeed.ts), never straight from the store.
//
// The POST author is the self-asserted handle (resolved to the JWT-linked handle
// when signed in), the same demo identity that authors a pint drop or a follow.
// Writes go through the service role (check_ins has no anon policy). Certified as
// a mutating surface via the durable rate limit boundary (isLimited).

import { jsonNoStore } from "@/lib/apiResponses";
import { validateCheckInInput, type CheckInInputRaw } from "@/lib/checkIn";
import { checkInStore } from "@/lib/checkInStore";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { areaPublicCheckIns, visibleCheckInsForViewer } from "@/lib/socialFeed";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

assertServerEnv();

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

// GET /api/check-ins?viewer=<handle>  → the viewer's "Your lot" check-ins.
// GET /api/check-ins?scope=area       → the area-public check-ins (visibility 'area').
// Read-only; the privacy choke (lib/socialFeed.ts) decides what is returned.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const viewer = readString(url.searchParams.get("viewer") ?? undefined);
  const scope = readString(url.searchParams.get("scope") ?? undefined);

  try {
    if (scope === "area") {
      const checkIns = await areaPublicCheckIns();
      return jsonNoStore({ checkIns }, { status: 200 });
    }
    // Default + viewer path: the friends-only "Your lot" read. No viewer handle
    // (anonymous) resolves to an empty list inside the choke, never a leak.
    const checkIns = await visibleCheckInsForViewer(viewer ?? "");
    return jsonNoStore({ checkIns }, { status: 200 });
  } catch {
    // Fail-soft read: an empty list keeps the feed tab honest, never a crash.
    return jsonNoStore({ checkIns: [] }, { status: 200 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  // JWT-linked handle wins over a self-asserted body.handle when signed in.
  const handle = await resolveMessageHandle(request, readString(body.handle));
  if (!handle) {
    return jsonNoStore(
      { error: "Set a handle first. Drop a pint to claim one." },
      { status: 400 },
    );
  }

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  // Rate-limit per handle + hashed IP so check-ins can't be spammed (raw IP is
  // never keyed). This is also the route's certification boundary (rate_limit).
  const key = `check-in:${ownership.handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(ownership.handle, key)) {
    return jsonNoStore({ error: "Too many check-ins, slow down." }, { status: 429 });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return jsonNoStore({ error: "Check-in storage is not configured." }, { status: 503 });
  }

  // Validate against the resolved handle (never the raw body handle).
  const raw: CheckInInputRaw = { ...body, handle: ownership.handle };
  const validation = validateCheckInInput(raw);
  if (!validation.ok) {
    return jsonNoStore({ error: validation.error }, { status: 400 });
  }

  try {
    const checkIn = await checkInStore().create(validation.value);
    return jsonNoStore({ checkIn }, { status: 201 });
  } catch {
    return jsonNoStore({ error: "Check-in storage is unavailable." }, { status: 503 });
  }
}
