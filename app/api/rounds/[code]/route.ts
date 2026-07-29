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
import {
  resolveContributionIdentity,
  type ContributionIdentityResolution,
} from "@/lib/contributionIdentity.server";
import { submitCommunityPrice } from "@/lib/communityPriceStore";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  ROUND_PRICE_DEGRADED_RETRY_SECONDS,
  chargeRoundPriceLines,
  type RoundPriceBudget,
} from "@/lib/roundPriceBudget";
import {
  ROUND_SPEND_PRICE_LINE_MAX,
  cleanNewRoundSpend,
  firstPartyPriceItems,
  isValidRoundCode,
  type RoundSpendDTO,
  type RoundState,
} from "@/lib/rounds";
import {
  roundsStore,
  type RoundsStore,
  type RoundWriteError,
} from "@/lib/roundsStore";
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

type ResolvedContributor = Extract<
  ContributionIdentityResolution,
  { ok: true }
>;

function roundBudgetFailure(budget: RoundPriceBudget): Response | null {
  if (budget.allowed) return null;
  if (budget.mode === "degraded") {
    return jsonNoStore(
      {
        error:
          "Your round is kept, but price sharing is unavailable. Try again shortly.",
      },
      {
        status: 503,
        headers: { "Retry-After": String(ROUND_PRICE_DEGRADED_RETRY_SECONDS) },
      },
    );
  }
  if (budget.mode === "rejected") {
    return jsonNoStore(
      {
        error: "Your round is kept, but price sharing could not be verified.",
      },
      { status: 503 },
    );
  }
  return jsonNoStore(
    { error: "Your round is kept. Too many price logs, try again later." },
    { status: 429 },
  );
}

async function preparePendingRoundPrices(input: {
  store: RoundsStore;
  code: string;
  clientRef: string;
  state: RoundState;
  contributor: ResolvedContributor;
  promotionOwner: string;
}): Promise<
  | { ok: true; state: RoundState; stored: RoundSpendDTO }
  | { ok: false; response: Response }
> {
  let state = input.state;
  let stored = state.spends.find(
    (spend) => spend.clientRef === input.clientRef,
  );
  if (!stored) return { ok: false, response: errorResponse("error") };
  const pending = stored.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.promotionStatus === "pending");
  if (pending.length === 0) return { ok: true, state, stored };

  const budget = await chargeRoundPriceLines(
    input.contributor.actor,
    input.promotionOwner,
    pending.map(({ index }) => ({
      clientRef: stored.clientRef,
      spendId: stored.id,
      lineIndex: index,
    })),
  );
  const failure = roundBudgetFailure(budget);
  if (failure) return { ok: false, response: failure };

  const marked = await input.store.updateSpendPromotions(
    input.code,
    input.clientRef,
    pending.map(({ index }) => ({ index, status: "ready" as const })),
  );
  if (!marked.ok) {
    return { ok: false, response: errorResponse(marked.error) };
  }
  state = marked.state;
  stored = state.spends.find(
    (spend) => spend.clientRef === input.clientRef,
  );
  return stored
    ? { ok: true, state, stored }
    : { ok: false, response: errorResponse("error") };
}

async function promoteReadyRoundPrices(input: {
  store: RoundsStore;
  code: string;
  clientRef: string;
  state: RoundState;
  stored: RoundSpendDTO;
  contributor: ResolvedContributor;
}): Promise<Response> {
  const ready = input.stored.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.promotionStatus === "ready");
  const promoted: Array<{ index: number; status: "promoted" }> = [];
  const recordedAt = Date.parse(input.stored.recordedAt);
  for (const { item, index } of ready) {
    const write = await submitCommunityPrice(
      {
        venueId: input.stored.venueId,
        drinkCategory: item.drinkCategory,
        priceGbp: item.pricePence / 100,
        actor: input.contributor.actor,
        contributorHandle: input.contributor.handle,
      },
      recordedAt,
    );
    if (!write.failed && write.price) {
      promoted.push({ index, status: "promoted" });
    }
  }

  let state = input.state;
  if (promoted.length > 0) {
    const marked = await input.store.updateSpendPromotions(
      input.code,
      input.clientRef,
      promoted,
    );
    if (!marked.ok) return errorResponse(marked.error);
    state = marked.state;
  }
  if (promoted.length !== ready.length) {
    return jsonNoStore(
      { error: "Your round is kept, but some prices need another try." },
      { status: 503 },
    );
  }
  return jsonNoStore(state, { status: 200 });
}

// One immutable buying turn, plus the price submissions its drink lines earn.
async function recordSpend(
  request: Request,
  code: string,
  handle: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const store = roundsStore();
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

  // A plain total is a diary figure, not one drink, so it stops here.
  const observed = firstPartyPriceItems(clean.items);
  const contributor =
    observed.length > 0 ? await resolveContributionIdentity(request) : null;
  if (contributor?.ok && observed.length > ROUND_SPEND_PRICE_LINE_MAX) {
    return jsonNoStore(
      {
        error: `Log up to ${ROUND_SPEND_PRICE_LINE_MAX} drink prices in one round. Keep this one, then start another.`,
      },
      { status: 400 },
    );
  }

  const hasBearer = /^Bearer\s+\S+/i.test(
    request.headers.get("authorization") ?? "",
  );
  if (
    observed.length > 0 &&
    hasBearer &&
    contributor &&
    !contributor.ok &&
    contributor.httpStatus === 401
  ) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }
  const promotionOwner =
    contributor?.accountId ? `account:${contributor.accountId}` : null;
  const result = await store.recordSpend(code, {
    ...spendInput,
    initialPromotionStatus:
      observed.length > 0 && promotionOwner ? "pending" : "diary_only",
    ...(promotionOwner ? { promotionActor: promotionOwner } : {}),
  });
  if (!result.ok) return errorResponse(result.error);

  if (observed.length === 0 || (!hasBearer && !contributor?.ok)) {
    return jsonNoStore(result.state, { status: 200 });
  }
  if (!contributor?.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }
  if (!promotionOwner) return errorResponse("error");
  const owner = await store.claimSpendPromotionOwner(
    code,
    clean.clientRef,
    promotionOwner,
  );
  if (!owner.ok) {
    return owner.error === "forbidden"
      ? jsonNoStore(
          { error: "This saved round belongs to another account." },
          { status: 403 },
        )
      : errorResponse(owner.error);
  }

  const prepared = await preparePendingRoundPrices({
    store,
    code,
    clientRef: clean.clientRef,
    state: result.state,
    contributor,
    promotionOwner,
  });
  if (!prepared.ok) return prepared.response;
  return promoteReadyRoundPrices({
    store,
    code,
    clientRef: clean.clientRef,
    state: prepared.state,
    stored: prepared.stored,
    contributor,
  });
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
    case "recordSpend":
      return recordSpend(request, code, handle, body);
    case "close": {
      const result = await store.close(code, handle);
      return result.ok ? jsonNoStore(result.state, { status: 200 }) : errorResponse(result.error);
    }
    default:
      return jsonNoStore({ error: "Unknown action." }, { status: 400 });
  }
}
