// A single Round's live state + the join / add-stop / close actions (GH #26).
//   GET                              → 200 { round, members, stops }  | 404
//   POST { action: "join",  handle } → 200 RoundState | 400/404/409
//   POST { action: "addStop", handle, venueId, venueName, dropRef? }
//                                    → 200 RoundState | 400/403/404/409
//   POST { action: "close",  handle } → 200 RoundState | 400/403/404
//
// The GET is what the Round page polls (~10s while open + on focus) — live-ness by
// polling, the repo convention (the notifications bell polls; no websockets). It is
// fail-soft: a store outage renders as 404 (not found), never a 500.
//
// Identity: prefer a verified Supabase Auth JWT when present — if the auth user
// has a linked profile, that handle is the actor (body handle is not trusted
// alone). When auth is absent / unconfigured / unlinked, the self-asserted
// handle still works (demo path), same as messages. The code IS the capability —
// anyone who knows it can read + (as a member) build the Round. Writes are
// rate-limited per handle + IP.

import { jsonNoStore } from "@/lib/apiResponses";
import { deriveCommunityPriceActor } from "@/lib/communityPriceActor";
import { submitCommunityPrice } from "@/lib/communityPriceStore";
import { isDemoSeedPrice } from "@/lib/drinkSeeds";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { cleanNewRoundSpend, isValidRoundCode } from "@/lib/rounds";
import { roundsStore, type RoundWriteError } from "@/lib/roundsStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { isRoundsReadLimited } from "@/lib/roundsReadRateLimit";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

assertServerEnv();

type Ctx = { params: Promise<{ code: string }> };

// Map a store write-error to an HTTP status + a grounded message.
function errorResponse(error: RoundWriteError): Response {
  const map: Record<RoundWriteError, { status: number; message: string }> = {
    not_found: { status: 404, message: "That Round doesn't exist." },
    closed: { status: 409, message: "This Round has been called. It's closed." },
    invalid: { status: 400, message: "Check the details and try again." },
    forbidden: { status: 403, message: "You're not in this Round." },
    // A store failure is a degraded dependency (503, fail-soft), not a bug (500)
    // — the house contract every other write route uses (see pint-drops).
    error: { status: 503, message: "Couldn't save that. Try again." },
  };
  const { status, message } = map[error];
  return jsonNoStore({ error: message }, { status });
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { code } = await ctx.params;
  if (!isValidRoundCode(code)) {
    return jsonNoStore({ error: "That Round doesn't exist." }, { status: 404 });
  }
  if (await isRoundsReadLimited(request)) {
    return jsonNoStore({ error: "Too many requests, slow down." }, { status: 429 });
  }
  const state = await roundsStore().getByCode(code);
  if (!state) return jsonNoStore({ error: "That Round doesn't exist." }, { status: 404 });
  return jsonNoStore(state, { status: 200 });
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { code } = await ctx.params;
  if (!isValidRoundCode(code)) {
    return jsonNoStore({ error: "That Round doesn't exist." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const action = readString(body.action);
  const handle = await resolveMessageHandle(request, readString(body.handle) ?? "");
  if (!handle) return jsonNoStore({ error: "Add a handle." }, { status: 400 });

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  // One limiter budget per handle+IP across every Round action.
  const key = `round-action:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return jsonNoStore({ error: "Too many updates, slow down." }, { status: 429 });
  }

  const store = roundsStore();
  switch (action) {
    case "join": {
      const result = await store.join(code, handle);
      return result.ok ? jsonNoStore(result.state, { status: 200 }) : errorResponse(result.error);
    }
    case "addStop": {
      const requestedVenueId = readString(body.venueId) ?? "";
      const venueLookup = await lookupCanonicalVenue(requestedVenueId);
      if (venueLookup.status === "unavailable") {
        return jsonNoStore(
          { error: "Venue list is unavailable right now, try again shortly." },
          { status: 503 },
        );
      }
      if (venueLookup.status !== "found" || !isPubVenueKind(venueLookup.venue.kind)) {
        return jsonNoStore({ error: "Pick a pub from the map." }, { status: 400 });
      }
      const result = await store.addStop(code, {
        venueId: venueLookup.canonicalId,
        venueName: venueLookup.venue.name,
        addedByHandle: handle,
        dropRef: body.dropRef,
      });
      return result.ok ? jsonNoStore(result.state, { status: 200 }) : errorResponse(result.error);
    }
    case "recordSpend": {
      const requestedVenueId = readString(body.venueId) ?? "";
      const venueLookup = await lookupCanonicalVenue(requestedVenueId);
      if (venueLookup.status === "unavailable") {
        return jsonNoStore(
          { error: "Venue list is unavailable right now, try again shortly." },
          { status: 503 },
        );
      }
      if (venueLookup.status !== "found" || !isPubVenueKind(venueLookup.venue.kind)) {
        return jsonNoStore({ error: "Pick a pub from this Round." }, { status: 400 });
      }
      const spendInput = {
        clientRef: body.clientRef,
        payerHandle: body.payerHandle,
        recordedByHandle: handle,
        venueId: venueLookup.canonicalId,
        venueName: venueLookup.venue.name,
        totalGbp: body.totalGbp,
        items: body.items,
      };
      const clean = cleanNewRoundSpend(spendInput);
      if (!clean) return errorResponse("invalid");

      const result = await store.recordSpend(code, spendInput);
      if (!result.ok) return errorResponse(result.error);

      // A plain total is a diary figure, not one drink, so it stops here.
      // Itemised prices enter the existing community store and earn map
      // authority only through its independent-submitter and age gates. A
      // seeded demo figure is nobody's observation, so it stays in the Round
      // diary and never reaches the community store, however it was typed.
      if (result.created && clean.items.length > 0) {
        const actor = deriveCommunityPriceActor(request);
        const stored = result.state.spends.find(
          (spend) => spend.clientRef === clean.clientRef,
        );
        const recordedAt = stored ? Date.parse(stored.recordedAt) : Date.now();
        for (const item of clean.items) {
          if (
            isDemoSeedPrice(clean.venueId, item.drinkCategory, item.pricePence / 100)
          ) {
            continue;
          }
          await submitCommunityPrice(
            {
              venueId: clean.venueId,
              drinkCategory: item.drinkCategory,
              priceGbp: item.pricePence / 100,
              actor,
            },
            recordedAt,
          );
        }
      }
      return jsonNoStore(result.state, { status: 200 });
    }
    case "close": {
      const result = await store.close(code, handle);
      return result.ok ? jsonNoStore(result.state, { status: 200 }) : errorResponse(result.error);
    }
    default:
      return jsonNoStore({ error: "Unknown action." }, { status: 400 });
  }
}
