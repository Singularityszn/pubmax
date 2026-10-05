// Which OSM pubs the bounded London promotion takes, and in what order.
//
// THE BATCH IS CAPPED IN CODE. `PROMOTION_BATCH_CAP` is a hard ceiling no
// argument can raise: a caller may ask for fewer, never more. A promotion is a
// reviewed change to the curated index, so its size is a number a reviewer can
// hold in their head (the first ship is about 300).
//
// WHO IS ELIGIBLE. An OSM `amenity=pub` inside Greater London that states its
// own website (the evidence the later price passes read), that no curated venue
// already owns (`curatedRef` absent) and that the dataset does not already hold
// under another spelling. A pub a chain harvester owns (Wetherspoons, Greene
// King, Mitchells & Butlers) is left to that chain's own gazetteer lane. The borough comes from the point-in-polygon
// classifier, never from a name.
//
// WHAT ORDER. Round robin across boroughs, thinnest curated borough first, then
// OSM id inside a borough. A plain sort by borough would spend the whole batch
// on one borough, and the point of the batch is depth where London is thin.
import { boroughNameForPoint } from "../../lib/londonBoroughPoint.mjs";
import { classifyChainPub } from "./tavilyPubEnrichment.mjs";
import { inGreaterLondon } from "./londonOsmDatasetRows.mjs";

export const PROMOTION_BATCH_CAP = 300;

function hasHttpWebsite(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The batch size actually used: the request, clamped to 1..PROMOTION_BATCH_CAP. */
export function resolveBatchLimit(requested) {
  if (requested === undefined || requested === null) return PROMOTION_BATCH_CAP;
  const n = Number(requested);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--limit must be an integer from 1 to ${PROMOTION_BATCH_CAP}.`);
  }
  return Math.min(n, PROMOTION_BATCH_CAP);
}

/**
 * @param {Array<Record<string, any>>} osmPubs the UK OSM pack's pubs
 * @param {Array<Record<string, any>>} appRows the London app dataset rows
 * @param {{ boundaries: any, isDuplicate: (osmId: string, name: string, lat: number, lng: number) => boolean, limit?: number }} options
 * @returns {{ picked: Array<{ pub: Record<string, any>, borough: string }>, eligible: number, limit: number }}
 */
export function selectPromotions(osmPubs, appRows, { boundaries, isDuplicate, limit }) {
  const cap = resolveBatchLimit(limit);

  const curatedByBorough = new Map();
  for (const row of appRows) {
    const borough = String(row.primary_borough ?? "").trim();
    if (borough) curatedByBorough.set(borough, (curatedByBorough.get(borough) ?? 0) + 1);
  }

  const byBorough = new Map();
  let eligible = 0;
  for (const pub of osmPubs) {
    if (pub.amenity !== "pub" || pub.curatedRef || !hasHttpWebsite(pub.website)) continue;
    if (classifyChainPub(pub)) continue;
    const name = String(pub.name ?? "").trim();
    const lat = Number(pub.lat);
    const lng = Number(pub.lng);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !inGreaterLondon(lat, lng)) continue;
    const borough = boroughNameForPoint(lat, lng, boundaries);
    if (!borough) continue;
    if (isDuplicate(String(pub.osmId ?? ""), name, lat, lng)) continue;
    eligible += 1;
    const queue = byBorough.get(borough) ?? [];
    queue.push(pub);
    byBorough.set(borough, queue);
  }

  const order = [...byBorough.keys()].sort(
    (a, b) => (curatedByBorough.get(a) ?? 0) - (curatedByBorough.get(b) ?? 0) || a.localeCompare(b),
  );
  for (const queue of byBorough.values()) {
    queue.sort((a, b) => String(a.osmId).localeCompare(String(b.osmId)));
  }

  const picked = [];
  // Two near-duplicates inside the same batch must not both be taken, so the
  // caller's `isDuplicate` is asked again as each pub is accepted.
  for (let round = 0; picked.length < cap; round += 1) {
    let tookAny = false;
    for (const borough of order) {
      const pub = byBorough.get(borough)[round];
      if (!pub) continue;
      tookAny = true;
      if (picked.length >= cap) break;
      picked.push({ pub, borough });
    }
    if (!tookAny) break;
  }
  return { picked, eligible, limit: cap };
}
