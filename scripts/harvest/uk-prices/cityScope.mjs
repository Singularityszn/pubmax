// `--city <id,...>`: point the UK price lanes at the pubs of named cities.
//
// The ids are the curated city ids in lib/cityBounds.mjs, and their boxes are
// the one box each city map draws. A city price therefore lands on a map that
// already shows prices, through the curated owner the bundle builder resolves.
//
// Scoping must not change attribution. A host is chosen when ANY pub it serves
// is in a named city, and it keeps EVERY pub the snapshot gives it. Cutting a
// host's out-of-city pubs away would make an estate look like one pub's own
// site, and the estate rule in lib/harvest/ukPriceCrawl.ts would then give a
// home-page price to that one pub.
//
// London is not a `--city`: `--london` adds the curated London websites and
// menu seeds that no other city holds.

import { CITY_BOUNDS } from "../../../lib/cityBounds.mjs";

/**
 * @param {readonly string[]} ids
 * @returns {{ ids: string[], contains: (point: { lat?: unknown, lng?: unknown }) => boolean } | null}
 */
export function harvestCityScope(ids) {
  const wanted = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0))];
  if (wanted.length === 0) return null;
  for (const id of wanted) {
    if (id === "london") throw new Error("--city london: use --london, which also reads curated London websites");
    if (!Object.hasOwn(CITY_BOUNDS, id)) {
      throw new Error(`--city ${id}: not a city in lib/cityBounds.mjs (${Object.keys(CITY_BOUNDS).join(", ")})`);
    }
  }
  const boxes = wanted.map((id) => CITY_BOUNDS[id]);
  return {
    ids: wanted,
    contains(point) {
      const { lat, lng } = point ?? {};
      if (typeof lat !== "number" || typeof lng !== "number") return false;
      return boxes.some(
        (box) => lat >= box.latMin && lat <= box.latMax && lng >= box.lonMin && lng <= box.lonMax,
      );
    },
  };
}

/**
 * The hosts with at least one pub in scope, each with all of its pubs.
 *
 * @template {{ pubs: ReadonlyArray<{ lat?: unknown, lng?: unknown }> }} T
 * @param {readonly T[]} hosts
 * @param {{ contains: (point: { lat?: unknown, lng?: unknown }) => boolean }} scope
 */
export function hostsTouchingCityScope(hosts, scope) {
  const kept = hosts.filter((entry) => entry.pubs.some((pub) => scope.contains(pub)));
  return { hosts: kept, hostsOutsideScope: hosts.length - kept.length };
}
