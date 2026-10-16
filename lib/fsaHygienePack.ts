// The runtime join behind the FSA hygiene badge: an OSM pub's own `fhrs:id`
// (public/data/osm_fhrs/london.json, ODbL) meets the FSA's published rating
// for that establishment (public/data/fsa_hygiene/london.json, OGL v3.0).
//
// THE JOIN IS EXACT. A venue reaches its establishment only through the tag
// OSM states for it, never through a name or a postcode, so a pub sharing a
// postcode with a cafe can no longer be shown the cafe's rating. The live
// name-and-postcode match in lib/foodHygiene.ts stays the fallback for a pub
// OSM has not tagged.
//
// A MISSING ROW IS NOT A "NO". No link, no pack, or no rating for the id all
// answer null, and the sheet then says nothing about hygiene at all.
//
// Both packs are written by scripts (scripts/build_osm_fhrs_links.mjs,
// scripts/build_fsa_hygiene_pack.mjs); the shapes are guarded here because a
// pack is read from disk, not trusted.

type FsaRatingValue = "0" | "1" | "2" | "3" | "4" | "5" | "Exempt" | "AwaitingInspection";

const RATING_VALUES: ReadonlySet<string> = new Set(["0", "1", "2", "3", "4", "5", "Exempt", "AwaitingInspection"]);

export type OsmFhrsLinks = {
  fetchedAt: string;
  /** compact OSM ref ("n123") → FHRSID */
  fhrsByRef: ReadonlyMap<string, number>;
  /** curated venue id → compact OSM ref */
  refByVenueId: ReadonlyMap<string, string>;
};

export type FsaHygieneRatings = {
  retrievedAt: string;
  source: string;
  sourceUrl: string;
  license: string;
  byFhrsId: ReadonlyMap<number, readonly [FsaRatingValue, string | null, string | null]>;
};

/** What the sheet shows, with the source and both dates it owes the reader. */
export type FsaHygieneFact = {
  fhrsid: number;
  rating: FsaRatingValue;
  /** The day the local authority awarded the rating, as the FSA publishes it. */
  ratingDate: string | null;
  localAuthority: string | null;
  source: string;
  sourceUrl: string;
  license: string;
  /** The day PUBMAXX read the FSA's data. */
  retrievedAt: string;
  /** The day the OSM snapshot that named the establishment was taken. */
  linkedAt: string;
};

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Guard the OSM link pack; null when it is not one. */
export function parseOsmFhrsLinks(raw: unknown): OsmFhrsLinks | null {
  const file = raw as { version?: unknown; fetchedAt?: unknown; links?: unknown } | null;
  if (!file || file.version !== 1 || !isDate(file.fetchedAt) || !Array.isArray(file.links)) return null;
  const fhrsByRef = new Map<string, number>();
  const refByVenueId = new Map<string, string>();
  for (const link of file.links) {
    if (!Array.isArray(link)) continue;
    const [ref, fhrsId, venueId] = link as unknown[];
    if (typeof ref !== "string" || !/^[nwr][1-9]\d*$/.test(ref)) continue;
    if (typeof fhrsId !== "number" || !Number.isSafeInteger(fhrsId) || fhrsId <= 0) continue;
    fhrsByRef.set(ref, fhrsId);
    if (typeof venueId === "string" && venueId) refByVenueId.set(venueId, ref);
  }
  return { fetchedAt: file.fetchedAt, fhrsByRef, refByVenueId };
}

/** Guard the FSA ratings pack; null when it is not one. */
export function parseFsaHygieneRatings(raw: unknown): FsaHygieneRatings | null {
  const file = raw as {
    version?: unknown;
    retrievedAt?: unknown;
    source?: unknown;
    sourceUrl?: unknown;
    license?: unknown;
    ratings?: unknown;
  } | null;
  if (!file || file.version !== 1 || !isDate(file.retrievedAt)) return null;
  if (!isText(file.source) || !isText(file.sourceUrl) || !isText(file.license)) return null;
  if (!file.ratings || typeof file.ratings !== "object" || Array.isArray(file.ratings)) return null;
  const byFhrsId = new Map<number, readonly [FsaRatingValue, string | null, string | null]>();
  for (const [key, row] of Object.entries(file.ratings as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== key || !Array.isArray(row)) continue;
    const [rating, ratingDate, authority] = row as unknown[];
    if (typeof rating !== "string" || !RATING_VALUES.has(rating)) continue;
    byFhrsId.set(id, [
      rating as FsaRatingValue,
      isDate(ratingDate) ? ratingDate : null,
      isText(authority) ? authority : null,
    ]);
  }
  return { retrievedAt: file.retrievedAt, source: file.source, sourceUrl: file.sourceUrl, license: file.license, byFhrsId };
}

/** The compact OSM ref a venue id names: a base pub's own, or a curated pub's link. */
export function osmRefForVenueId(venueId: string, links: OsmFhrsLinks): string | null {
  const base = /^venue-uk-([nwr][1-9]\d*)$/.exec(venueId);
  if (base) return base[1] ?? null;
  return links.refByVenueId.get(venueId) ?? null;
}

/** The FSA's rating for this venue, through its OSM `fhrs:id`, or null. */
export function fsaHygieneForVenue(
  venueId: string,
  links: OsmFhrsLinks | null,
  ratings: FsaHygieneRatings | null,
): FsaHygieneFact | null {
  if (!links || !ratings) return null;
  const ref = osmRefForVenueId(venueId, links);
  const fhrsid = ref ? links.fhrsByRef.get(ref) : undefined;
  if (fhrsid === undefined) return null;
  const row = ratings.byFhrsId.get(fhrsid);
  if (!row) return null;
  return {
    fhrsid,
    rating: row[0],
    ratingDate: row[1],
    localAuthority: row[2],
    source: ratings.source,
    sourceUrl: ratings.sourceUrl,
    license: ratings.license,
    retrievedAt: ratings.retrievedAt,
    linkedAt: links.fetchedAt,
  };
}
