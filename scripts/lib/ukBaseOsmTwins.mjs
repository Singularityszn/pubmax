// One pub OpenStreetMap maps twice: a node for the pub and a way for its
// building, both tagged amenity=pub under the same name. Shipped as two rows,
// they draw two pins and the NHLE join lists the building under both. The base
// layer ships the node, the object that marks the pub itself, and the way's
// `venue-uk-*` id is recorded as an alias of the node's
// (scripts/lib/ukBaseVenueIdAliases.mjs), so an id stored under it still lands
// on the same pub.

import { haversineMeters, normalizeVenueIdentityName } from "./venueCanonicalization.mjs";

// The same radius a redrawn pub keeps its id within: a node can sit at the
// door while the way's point is the centre of a large building.
const TWIN_METERS = 50;

const isNodeRef = (ref) => ref.startsWith("n");

/**
 * Merge every way or relation row into the nearest node row under the same
 * name within 50 m. The node keeps its own address and owner and takes the
 * way's where it has none. Rows are `[osmRef, name, address, lat, lng,
 * curatedVenueId]`; the order of the rows that remain is kept.
 *
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} rows
 * @returns {{ rows: unknown[][], twins: Map<string, string> }} `twins` maps each merged-away ref to its node's ref
 */
export function mergeOsmTwins(rows) {
  const nodesByName = new Map();
  for (const row of rows) {
    const name = normalizeVenueIdentityName(row[1]);
    if (!name || !isNodeRef(String(row[0]))) continue;
    nodesByName.set(name, [...(nodesByName.get(name) ?? []), row]);
  }

  const twins = new Map();
  const merged = new Map();
  for (const row of rows) {
    const ref = String(row[0]);
    const name = normalizeVenueIdentityName(row[1]);
    if (!name || isNodeRef(ref)) continue;
    let node = null;
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of nodesByName.get(name) ?? []) {
      const metres = haversineMeters(Number(row[3]), Number(row[4]), Number(candidate[3]), Number(candidate[4]));
      if (metres <= TWIN_METERS && metres < nearest) {
        nearest = metres;
        node = candidate;
      }
    }
    if (!node) continue;
    twins.set(ref, String(node[0]));
    const kept = merged.get(node) ?? [...node];
    if (!kept[2]) kept[2] = row[2];
    if (!kept[5]) kept[5] = row[5];
    merged.set(node, kept);
  }

  return {
    rows: rows.filter((row) => !twins.has(String(row[0]))).map((row) => merged.get(row) ?? [...row]),
    twins,
  };
}
