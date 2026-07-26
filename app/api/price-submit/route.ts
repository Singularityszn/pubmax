// Community price-submission route - backs the "What's it tonight?" card on the
// venue sheet (VenuePriceSubmit). A submission is a NEW dated observation by a
// drinker standing in the pub, unlike /api/price-confirm which only counts
// vouches for a price that is already displayed. The two are siblings; this one
// is the first time a figure enters the map from the community.
//
//   POST { venueId, drinkCategory, priceGbp } → { ok: true, price }
//   GET  ?venueId=<id>                        → { prices: CommunityPrice[] }
//
// Identity is server-derived (hashActor of the hashed client IP), never trusted
// from the body - exactly as price-confirm does it, so an anonymous drinker can
// contribute with no account and one device still can't stack duplicate
// observations for the same drink. Rate-limited on the same isLimited plumbing.
//
// Bounds are checked by the SHARED validator (lib/communityPrice.ts) that the
// submit UI also runs, so a rejection reads the same friendly sentence on both
// sides of the wire. Reads are fail-soft (a hiccup degrades to no community
// price, and the sourced baseline still renders); a durable WRITE failure
// answers 503 per the house rule, so the client knows the tap didn't land.
//
// PROVENANCE: this route only ever APPENDS to community_prices. It never edits
// the venue dataset, the scraped price CSV, or visit_reports - the scraped
// baseline survives every submission and keeps its own dated badge.
// No Supabase and no env are required.

import { jsonNoStore } from "@/lib/apiResponses";
import { validateCommunityPrice } from "@/lib/communityPrice";
import { readCommunityPrices, submitCommunityPrice } from "@/lib/communityPriceStore";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { getVenueIndex } from "@/lib/venueIndex";

// Best-effort, server-derived submitter token. Never throws - if IP hashing is
// unavailable the store records the observation unattributed (it still counts,
// it just can't replace that device's earlier entry for the same drink).
function deriveActor(request: Request): string | undefined {
  try {
    return hashActor(`price-submit:${hashIp(clientIp(request))}`);
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  // Sanity bounds, category allowlist and venue cleaning all live in the one
  // shared validator - the client's own pre-check is never trusted.
  const result = validateCommunityPrice(body);
  if (!result.ok) {
    return jsonNoStore({ error: result.error }, { status: 400 });
  }

  // getVenueIndex degrades to an EMPTY map when no city pack could be read.
  // That is a transient dependency failure, not a bad venue id — answer 503
  // (retryable) rather than bouncing every valid submission with a 400. The
  // membership check itself is never skipped.
  const venueIndex = await getVenueIndex();
  if (venueIndex.size === 0) {
    return jsonNoStore(
      { error: "Venue list is unavailable right now, try again shortly." },
      { status: 503 },
    );
  }
  if (!venueIndex.has(result.value.venueId)) {
    return jsonNoStore({ error: "Pick a venue from the map." }, { status: 400 });
  }

  const actor = deriveActor(request);

  // Cap one device across every venue before applying the tighter per-venue
  // budget. Without this actor-only key, changing venueId resets the budget and
  // lets one device spray a price across the whole map. Deliberate: the key is
  // the hashed IP, so devices behind one NAT share the 30/hour budget - a
  // client-minted id would be cleared-storage-evadable and defeat the cap.
  const actorLimitKey = `price-submit-actor:${actor ?? "anon"}`;
  if (await isLimited(actorLimitKey, actorLimitKey, 30, 3_600_000)) {
    return jsonNoStore({ error: "Too many price logs, slow down." }, { status: 429 });
  }

  // Keep the per-venue cap too, so one actor cannot churn one pub's figure.
  const limitKey = `price-submit:${actor ?? "anon"}:${result.value.venueId}`;
  if (await isLimited(limitKey, limitKey)) {
    return jsonNoStore({ error: "Too many price logs, slow down." }, { status: 429 });
  }

  // submitCommunityPrice never throws; a hard durable-write failure comes back
  // flagged so we answer 503 (degraded dependency) rather than a fake success.
  const { price, failed } = await submitCommunityPrice({ ...result.value, actor });
  if (failed || !price) {
    return jsonNoStore({ error: "Could not log that price right now." }, { status: 503 });
  }
  return jsonNoStore({ ok: true, price }, { status: 201 });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const venueId = (new URL(request.url).searchParams.get("venueId") ?? "").trim();
    if (!venueId) return jsonNoStore({ prices: [] }, { status: 200 });
    return jsonNoStore({ prices: await readCommunityPrices(venueId) }, { status: 200 });
  } catch {
    // The reader never 500s - degrade to no community prices so the sourced
    // baseline still renders on the sheet.
    return jsonNoStore({ prices: [] }, { status: 200 });
  }
}
