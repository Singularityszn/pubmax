// Community price-submission route - backs the "What's it tonight?" card on the
// venue sheet (VenuePriceSubmit). A submission is a NEW dated observation by a
// drinker standing in the pub, unlike /api/price-confirm which only counts
// vouches for a price that is already displayed. The two are siblings; this one
// is the first time a figure enters the map from the community.
//
//   POST { venueId, drinkCategory, priceGbp } → { ok: true, price }
//   GET  ?venueId=<id>                        → { prices: CommunityPrice[] }
//
// Both shapes carry `corroborations` - how many independent submitters back the
// figure. It is derived server-side on every read and is never accepted from a
// body: it is the number that decides whether a price moves a pin, so a client
// that could set it could repaint the map alone, which is exactly the hole the
// trust wave closed.
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
import { getUkBaseIdIndex } from "@/lib/ukBaseIndex";
import { isUkBaseId } from "@/lib/ukBasePubs";
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

  if (isUkBaseId(result.value.venueId)) {
    const ukBaseIndex = await getUkBaseIdIndex();
    if (ukBaseIndex.status === "unavailable") {
      return jsonNoStore(
        { error: "Venue list is unavailable right now, try again shortly." },
        { status: 503 },
      );
    }
    if (!ukBaseIndex.ids.has(result.value.venueId)) {
      return jsonNoStore({ error: "Pick a venue from the map." }, { status: 400 });
    }
  } else {
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
  // Read the venue back so the response carries this figure's authoritative
  // `corroborations` - the number that decides whether the submitter's tap
  // moves a pin or only lands on the pub's sheet. The client cannot derive it
  // (it never sees other devices' rows), and counting it in the store's one
  // read path rather than a second time on write keeps a single definition of
  // "how much the community backs this price".
  //
  // Adopted only when the read-back is still THIS submission's figure. When it
  // is not - another device holds the freshest row for this drink at a
  // different price, or the read degraded - answering with that row would show
  // the submitter a price they never typed, so we answer with their own at an
  // explicit one voice. A figure that is not even the record for its drink is
  // certainly not driving the map, and stating the 1 beats omitting it and
  // leaving the client to infer the same thing. The category's mapCandidate
  // still rides along on that fallback: dropping it would let this submitter's
  // own map transiently un-paint an already-corroborated figure until the next
  // read. Only when the read-back really produced a row, though - a degraded
  // or empty read stays candidate-less rather than inventing one.
  const categoryRow = (await readCommunityPrices(result.value.venueId)).find(
    (row) => row.drinkCategory === price.drinkCategory,
  );
  const record = categoryRow?.priceGbp === price.priceGbp ? categoryRow : undefined;
  return jsonNoStore(
    {
      ok: true,
      price:
        record ??
        {
          ...price,
          corroborations: 1,
          ...(categoryRow?.mapCandidate ? { mapCandidate: categoryRow.mapCandidate } : {}),
        },
    },
    { status: 201 },
  );
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
