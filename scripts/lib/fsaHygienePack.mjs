// The FSA Food Hygiene Rating Scheme (FHRS) pack: the Food Standards Agency's
// own published rating for every establishment an OSM London pub names in its
// `fhrs:id` tag (public/data/osm_fhrs/london.json).
//
// ONE SOURCE PER PACK. Every value here is the FSA's, read from its open data
// (Open Government Licence v3.0). The pack holds no OSM data and no name match:
// it is keyed by FHRSID, and the OSM link pack is what says which pub that is.
//
// NOTHING IS INFERRED. An establishment the FSA did not return gets no row,
// and a rating outside the closed set below is dropped and counted, so a
// missing row is "not read" and never "not rated".

import { openDataSourceUrl } from "../../lib/harvest/sourcePolicy.ts";

export const FSA_HYGIENE_PACK_VERSION = 1;

/** The FSA API's row in lib/harvest/sourceRegistry.ts. */
const FSA_SOURCE_POLICY_ID = "fsa-fhrs-api";

export const FSA_SOURCE = Object.freeze({
  source: "Food Standards Agency, Food Hygiene Rating Scheme",
  sourceUrl: "https://ratings.food.gov.uk/open-data",
  apiUrl: "https://api.ratings.food.gov.uk",
  license: "Open Government Licence v3.0",
  licenseUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Food hygiene ratings from the Food Standards Agency. Contains public sector information licensed under the Open Government Licence v3.0.",
});

/**
 * The FHRS answers a pack row may carry: the 0-5 rating, or the two statuses
 * the FSA publishes in their place. Scotland's FHIS scheme and every other
 * status are not in the set.
 */
export const FSA_RATING_VALUES = Object.freeze(["0", "1", "2", "3", "4", "5", "Exempt", "AwaitingInspection"]);

/**
 * The day the FSA writes in RatingDate when it holds none (an establishment
 * awaiting inspection, or exempt). It is a placeholder, not a rating day.
 */
const FSA_NO_RATING_DAY = "1901-01-01";

function isoDay(value) {
  if (typeof value !== "string" || !value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match || match[1] === FSA_NO_RATING_DAY) return null;
  return Number.isFinite(Date.parse(match[1])) ? match[1] : null;
}

/**
 * One API establishment as a compact row `[rating, ratingDay | null, authority | null]`,
 * or null when the FSA did not state a rating this pack may carry.
 */
export function compactEstablishment(establishment) {
  if (establishment?.SchemeType !== "FHRS") return null;
  const rating = typeof establishment.RatingValue === "string" ? establishment.RatingValue.trim() : "";
  if (!FSA_RATING_VALUES.includes(rating)) return null;
  const authority =
    typeof establishment.LocalAuthorityName === "string" && establishment.LocalAuthorityName.trim()
      ? establishment.LocalAuthorityName.trim()
      : null;
  return [rating, isoDay(establishment.RatingDate), authority];
}

/** The FHRSIDs the OSM link pack names, the only establishments the pack keeps. */
export function wantedFhrsIds(linksPack) {
  const wanted = new Set();
  for (const link of Array.isArray(linksPack?.links) ? linksPack.links : []) {
    if (Array.isArray(link) && Number.isSafeInteger(link[1]) && link[1] > 0) wanted.add(link[1]);
  }
  return wanted;
}

/**
 * Assemble the pack from every establishment the reads returned. An FHRSID the
 * reads returned twice and disagreed about states nothing, so it is dropped.
 */
export function buildFsaHygienePack({ wanted, establishments, retrievedAt }) {
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error("retrievedAt must be a date");
  const rows = new Map();
  const conflicted = new Set();
  const counts = { wanted: wanted.size, returned: 0, kept: 0, notInScheme: 0, conflicted: 0, notReturned: 0 };
  for (const establishment of establishments) {
    const id = establishment?.FHRSID;
    if (!Number.isSafeInteger(id) || !wanted.has(id)) continue;
    counts.returned += 1;
    const row = compactEstablishment(establishment);
    if (!row) {
      counts.notInScheme += 1;
      continue;
    }
    const previous = rows.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) conflicted.add(id);
    rows.set(id, row);
  }
  for (const id of conflicted) rows.delete(id);
  counts.conflicted = conflicted.size;
  counts.kept = rows.size;
  counts.notReturned = [...wanted].filter((id) => !rows.has(id) && !conflicted.has(id)).length;
  const ratings = {};
  for (const id of [...rows.keys()].sort((a, b) => a - b)) ratings[String(id)] = rows.get(id);
  return { version: FSA_HYGIENE_PACK_VERSION, ...FSA_SOURCE, retrievedAt, counts, ratings };
}

/**
 * The FSA's own page-size ceiling: its API best-practice note asks for pages
 * of 200 or fewer and rate-limits larger ones.
 */
export const FSA_PAGE_SIZE = 200;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * GET one FSA API path as JSON, or null when the FSA answers 404.
 *
 * THE SOURCE POLICY OWNS THE HOST. The URL comes from `openDataSourceUrl`
 * (lib/harvest/sourcePolicy.ts, row `fsa-fhrs-api` in
 * lib/harvest/sourceRegistry.ts), which refuses a path that resolves to any
 * other host or scheme, and a redirect is an error, so no
 * response from another host is ever read. A 429 or a 5xx is
 * asked again after the server's `Retry-After` (or a doubling wait from
 * `baseDelayMs`), at most `maxAttempts` times in all; any other failure stops
 * the run, so a partial read never ships.
 */
export async function fsaGetJson(
  pathAndQuery,
  { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxAttempts = 5, baseDelayMs = 2000 } = {},
) {
  const url = openDataSourceUrl(FSA_SOURCE_POLICY_ID, pathAndQuery);
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchImpl(url.href, {
      headers: { "x-api-version": "2", accept: "application/json" },
      redirect: "error",
    });
    if (response.status === 404) return null;
    if (response.ok) return response.json();
    if (!RETRYABLE.has(response.status) || attempt >= maxAttempts) {
      throw new Error(`FSA ${response.status} for ${url.href} after ${attempt} attempt(s)`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** (attempt - 1));
  }
}
