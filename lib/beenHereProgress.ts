// How much of each London postcode district a person's Been here list covers.
// A pure leaf: the map layer and the Layers caption read the same counts.
//
// Every figure is a count of real rows. The total is the pubs on our London
// list whose own address gives a whole postcode, so a pub with no postcode on
// record is never guessed into a district. A visited pub with no postcode is
// counted apart, so the caption can say why it is missing from the map.

import { BEEN_HERE_LIST } from "@/lib/beenHere";
import { fullPostcodeOutward } from "@/lib/venuePermalinkSlug";

export type DistrictPub = {
  id: string;
  lat: number;
  lng: number;
  /** The slim index's search text, which carries the pub's address. */
  searchText?: string;
};

type DistrictProgress = {
  /** The postcode district, upper case: "N1", "SW1", "EC1". */
  district: string;
  visited: number;
  total: number;
  /** Whole per cent, rounded down, so it never claims a pub you have not been to. */
  percent: number;
  /** The middle of the district's pubs on our list. */
  lng: number;
  lat: number;
};

export type BeenHereProgress = {
  /** Districts with at least one Been here pub, most covered first. */
  districts: DistrictProgress[];
  /** Been here pubs on our London list whose address gives no postcode. */
  visitedWithoutPostcode: number;
};

/**
 * The postcode district a pub's address names, or null. A sub-district folds
 * into its district (W1F to W1, SW1A to SW1, EC1V to EC1), the way people say it.
 */
export function postcodeDistrict(text: string | undefined): string | null {
  const outward = fullPostcodeOutward(text ?? "");
  if (!outward) return null;
  const district = /^[a-z]{1,2}\d{1,2}[a-z]$/.test(outward) ? outward.slice(0, -1) : outward;
  return district.toUpperCase();
}

/** The venue ids on the Been here list, from any saved-list rows. */
export function beenHereIds(saved: readonly { venueId: string; listType: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const row of saved) if (row.listType === BEEN_HERE_LIST) ids.add(row.venueId);
  return ids;
}

export function beenHereProgress(
  pubs: readonly DistrictPub[],
  visited: ReadonlySet<string>,
): BeenHereProgress {
  const byDistrict = new Map<string, { visited: number; total: number; lng: number; lat: number }>();
  let visitedWithoutPostcode = 0;
  const seen = new Set<string>();
  for (const pub of pubs) {
    if (seen.has(pub.id)) continue;
    seen.add(pub.id);
    const district = postcodeDistrict(pub.searchText);
    const been = visited.has(pub.id);
    if (!district) {
      if (been) visitedWithoutPostcode += 1;
      continue;
    }
    const row = byDistrict.get(district) ?? { visited: 0, total: 0, lng: 0, lat: 0 };
    row.total += 1;
    row.lng += pub.lng;
    row.lat += pub.lat;
    if (been) row.visited += 1;
    byDistrict.set(district, row);
  }
  const districts: DistrictProgress[] = [];
  for (const [district, row] of byDistrict) {
    if (row.visited === 0) continue;
    districts.push({
      district,
      visited: row.visited,
      total: row.total,
      percent: Math.floor((row.visited * 100) / row.total),
      lng: row.lng / row.total,
      lat: row.lat / row.total,
    });
  }
  districts.sort((a, b) => b.percent - a.percent || b.visited - a.visited || a.district.localeCompare(b.district));
  return { districts, visitedWithoutPostcode };
}
