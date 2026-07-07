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
// Identity is the self-asserted `handle`. The code IS the capability — anyone who
// knows it can read + (as a member) build the Round; that's the design (see
// supabase/migrations/0011_rounds.sql). Writes are rate-limited per handle + IP.

import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { isValidRoundCode } from "@/lib/rounds";
import { roundsStore, type RoundWriteError } from "@/lib/roundsStore";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

type Ctx = { params: Promise<{ code: string }> };

// Map a store write-error to an HTTP status + a grounded message.
function errorResponse(error: RoundWriteError): Response {
  const map: Record<RoundWriteError, { status: number; message: string }> = {
    not_found: { status: 404, message: "That Round doesn't exist." },
    closed: { status: 409, message: "This Round has been called — it's closed." },
    invalid: { status: 400, message: "Check the details and try again." },
    forbidden: { status: 403, message: "You're not in this Round." },
    // A store failure is a degraded dependency (503, fail-soft), not a bug (500)
    // — the house contract every other write route uses (see pint-drops).
    error: { status: 503, message: "Something went wrong. Try again." },
  };
  const { status, message } = map[error];
  return Response.json({ error: message }, { status });
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { code } = await ctx.params;
  if (!isValidRoundCode(code)) {
    return Response.json({ error: "That Round doesn't exist." }, { status: 404 });
  }
  const state = await roundsStore().getByCode(code);
  if (!state) return Response.json({ error: "That Round doesn't exist." }, { status: 404 });
  return Response.json(state, { status: 200 });
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { code } = await ctx.params;
  if (!isValidRoundCode(code)) {
    return Response.json({ error: "That Round doesn't exist." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const action = readString(body.action);
  const handle = normalizeHandle(readString(body.handle) ?? "");
  if (!handle) return Response.json({ error: "Add a handle." }, { status: 400 });

  // One limiter budget per handle+IP across every Round action.
  const key = `round-action:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return Response.json({ error: "Too many updates, slow down." }, { status: 429 });
  }

  const store = roundsStore();
  switch (action) {
    case "join": {
      const result = await store.join(code, handle);
      return result.ok ? Response.json(result.state, { status: 200 }) : errorResponse(result.error);
    }
    case "addStop": {
      const result = await store.addStop(code, {
        venueId: body.venueId,
        venueName: body.venueName,
        addedByHandle: handle,
        dropRef: body.dropRef,
      });
      return result.ok ? Response.json(result.state, { status: 200 }) : errorResponse(result.error);
    }
    case "close": {
      const result = await store.close(code, handle);
      return result.ok ? Response.json(result.state, { status: 200 }) : errorResponse(result.error);
    }
    default:
      return Response.json({ error: "Unknown action." }, { status: 400 });
  }
}
