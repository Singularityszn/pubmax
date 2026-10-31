/**
 * Duplicate-venue-identity canonicalization (D1).
 *
 * The venue dataset carries the SAME physical pub twice across dataset lineages
 * — e.g. a seed record `"The Rochester Castle"` and a Wetherspoons-directory
 * record `"The Rochester Castle - JD Wetherspoon"`, each with its own price set
 * and a slightly different address/geocode. Because venue identity is derived
 * from `pub_name|address|lat5|lng5` (see lib/venues.ts#venueGroupingKey), the
 * two records hash to two different `venue-…` ids, so borough leaderboards
 * double-count the pub and the map draws two pins.
 *
 * This module detects those duplicate pairs and collapses them into one venue
 * identity BEFORE grouping, so every consumer (borough, map, search, ledger,
 * detail) heals at once. It is a PURE library imported by:
 *   - scripts/canonicalize_venue_dataset.mjs (rewrites the bundled dataset)
 *   - __tests__/venueCanonicalization.test.ts (unit + regression)
 *
 * Merge policy (constraints from the D1 task):
 *   1. Keep the canonical id selected by compareCanonical. Every losing id
 *      enters the alias map so stored pint drops, plans, and saves still resolve.
 *   2. Union the duplicate's price rows into the canonical identity, keeping
 *      each row's own `source_datasets` / provenance untouched — no averaging,
 *      no invented prices.
 *   3. Exact-name and fuzzy passes each require proximity and compatible
 *      postcodes. looksSamePub and looksSameFuzzy own those checks.
 *      Coordinates can be wrong, so conflicting outward postcodes block a
 *      merge even for a verified alias.
 */

import { haversineMeters } from "./geo.mjs";
import { OPERATOR_SUFFIX_RE, hasOperatorSuffix } from "../../lib/venueOperatorSuffix.mjs";

export { haversineMeters };

// --- venue identity (mirror of lib/venues.ts — keep in lockstep) -------------

export function normaliseVenueKeyPart(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

export function venueGroupingKey(row) {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}

export function stableVenueIdFromKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

// --- normalization -----------------------------------------------------------

// Operator / brewery marketing suffixes that mark a duplicate lineage of the
// SAME physical pub ("- JD Wetherspoon", "(Wetherspoons)", "- Greene King", …).
// The pattern is lib/venueOperatorSuffix.mjs, shared with the reader-facing name
// (lib/venueDisplay.ts#displayVenueName). Used here to (a) collapse names for
// duplicate detection and (b) prefer the clean, brewery-neutral pub name as the
// canonical identity.
export { hasOperatorSuffix };

// Normalize a pub name for duplicate detection: drop the operator suffix and
// any parenthetical locality qualifier ("(Southwark)"), fold "&"→"and", strip
// punctuation and a leading "the". "The Rochester Castle" and "The Rochester
// Castle - JD Wetherspoon" both collapse to "rochester castle".
export function normalizeVenueIdentityName(name) {
  let s = String(name ?? "").toLowerCase().replace(/[’‘`]/g, "'");
  s = s.replace(OPERATOR_SUFFIX_RE, "");
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/^the\s+/, "");
  return s.replace(/\s+/g, " ").trim();
}

// Extract the UK postcode OUTWARD code (e.g. "N16 0NY" → "N16") from an
// address, using the last postcode-shaped token. Returns null when the address
// carries no postcode (common for seed-lineage rows) — a missing postcode never
// blocks a merge, it just can't confirm one.
export function postcodeOutward(address) {
  const matches = String(address ?? "")
    .toUpperCase()
    .match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g);
  if (!matches) return null;
  const last = matches[matches.length - 1].replace(/\s+/g, " ").trim();
  const outward = last.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}$/);
  return outward ? outward[1] : null;
}

// Two records may be the same physical pub only when they are geographically
// close AND their postcodes don't actively conflict.
function looksSamePub(a, b, maxMergeMeters) {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return false;
  if (haversineMeters(a.lat, a.lng, b.lat, b.lng) > maxMergeMeters) return false;
  const pa = postcodeOutward(a.address);
  const pb = postcodeOutward(b.address);
  if (pa && pb && pa !== pb) return false;
  return true;
}

// --- fuzzy name matching (coordinate-drift + matching-ish names) --------------
//
// The exact-name clustering above only ever links records whose NORMALIZED name
// is byte-identical. That misses the real-world duplicate a bulk gazetteer/OSM
// import creates: the same physical pub carried under a slightly different name
// AND with a geocode that drifts a few metres, e.g. an existing canonical "The
// Moon on the Hill" (51.5794,-0.3342) vs an imported "The Moon on the Hill"
// seed at (51.5795,-0.335) — 56 m and a 4-dp coordinate key apart — or "Kings
// Head" vs "Kings Head Tavern" a few doors along. A distance-gated
// name-SIMILARITY pass (below) folds those in, tightly bounded so two genuinely
// distinct neighbouring pubs never collapse.

// Generic descriptor tokens carry no identity on their own — "The Sports Bar"
// and "The Wine Bar" are not the same pub because both end in "bar". Stripped
// before comparison so "Kings Head" ≡ "Kings Head Tavern" but a lone shared
// generic never drives a merge.
const GENERIC_NAME_TOKENS = new Set([
  "pub", "bar", "tavern", "inn", "the", "ye", "olde", "house", "hotel", "lounge", "and",
]);

export function significantNameTokens(normName) {
  return String(normName ?? "")
    .split(" ")
    .filter((t) => t && !GENERIC_NAME_TOKENS.has(t));
}

function tokenSet(normName) {
  return new Set(String(normName ?? "").split(" ").filter(Boolean));
}

// Do two ALREADY-NORMALIZED venue names look like the same physical pub, one
// carrying an extra qualifier the other omits?
//
// The rule is deliberately asymmetric and conservative, tuned against real
// dataset evidence:
//
//   1. One name's FULL token set must be a subset of the other's. This is the
//      load-bearing guard: it means one name is exactly the other PLUS extra
//      tokens — "Old Hat" ⊂ "Old Hat Ealing", "Kings Head" ⊂ "Kings Head
//      Tavern". It rejects the dangerous two-sided case where both names append
//      a DIFFERENT word to a shared locality — "New Cross Inn" vs "New Cross
//      House" are genuinely distinct pubs and neither token set contains the
//      other, so they are never merged.
//
//   2. The shared DISTINCTIVE (non-generic) core decides how much extra is
//      allowed. A core of >= 2 distinctive tokens ("old hat", "blue boat") is
//      strong enough that a locality/qualifier suffix ("ealing", "fulham
//      reach") still reads as the same pub. When the shared core is a SINGLE
//      distinctive token, the longer name may only add GENERIC words ("the
//      canonbury" ↔ "canonbury tavern") — if it adds another distinctive token
//      ("Bell" vs "Bell and Crown", "Crown" vs "Crown and Anchor") the two are
//      treated as different pubs.
export function namesLikelySamePub(aNorm, bNorm) {
  const a = String(aNorm ?? "");
  const b = String(bNorm ?? "");
  if (!a || !b) return false;
  if (a === b) return true;

  const fullA = tokenSet(a);
  const fullB = tokenSet(b);
  const sigA = new Set(significantNameTokens(a));
  const sigB = new Set(significantNameTokens(b));
  if (sigA.size === 0 || sigB.size === 0) return false; // no distinctive content

  // (1) one full token set must contain the other.
  const [small, large] = fullA.size <= fullB.size ? [fullA, fullB] : [fullB, fullA];
  for (const t of small) if (!large.has(t)) return false;

  // (2) shared distinctive core + extra-token policy.
  const [smallSig, largeSig] = sigA.size <= sigB.size ? [sigA, sigB] : [sigB, sigA];
  for (const t of smallSig) if (!largeSig.has(t)) return false; // core must be shared
  if (smallSig.size >= 2) return true; // strong multi-token core: qualifier suffixes ok
  const extraDistinctive = [...largeSig].filter((t) => !smallSig.has(t));
  return extraDistinctive.length === 0; // single-token core: extra must be generic only
}

// A fuzzy (near-name) merge is far weaker evidence than an exact-name match, so
// it is gated much tighter on distance than the 100 m exact-name radius.
const DEFAULT_FUZZY_MERGE_METERS = 45;

// At least one shared distinctive name token (see significantNameTokens).
export function cheapSamePubNameCandidate(aNorm, bNorm) {
  const sigA = new Set(significantNameTokens(aNorm));
  const sigB = new Set(significantNameTokens(bNorm));
  if (sigA.size === 0 || sigB.size === 0) return false;
  for (const t of sigA) if (sigB.has(t)) return true;
  return false;
}

// Verified at 174 Queen Victoria Street. The Wikipedia spelling has no price.
// Keep its old id resolvable without loosening name matching for other pubs.
// The Guard House, No 1 Street, SE18 6GH: the Young's seed spells it
// "The Guardhouse" 0.1 m from OSM node/4515363508's "The Guard House", and its
// own site prints both. Token matching cannot join one word to two.
const VERIFIED_VENUE_ALIASES = {
  "venue-1sw9ofl": "venue-eltcmh",
  "venue-kkpnq8": "venue-9e93hd",
  // Verified 2026-10-17 by street address or the pub's own website, each pair
  // within 33 m. The first three differ only by an apostrophe or a space, which
  // normalizeVenueIdentityName reads as a word break. The record kept is the one with the full street address and
  // coordinates, since its name and address are written onto the merged rows;
  // where both have one, the correctly spelled name is kept.
  "venue-ydvsco": "venue-6bh8l6", // The King's Tun -> The Kings Tun, Wetherspoon, Kingston
  "venue-9otpi8": "venue-x49k8g", // O'Neills -> O'Neill's
  "venue-1g7sv3b": "venue-y78jw5", // Mc Glynn's Bar -> McGlynn's Bar, 70 Willesden Lane NW6
  "venue-ttu2zy": "venue-l6qdob", // Price Albert -> The Prince Albert, 418 Coldharbour Lane SW9
  "venue-4lt7c6": "venue-c0r9ym", // Flowes -> Flowers of the Forest, 14 Westminster Bridge Rd SE1
  "venue-1fudad7": "venue-14alocj", // Richard the First -> Richard I, 52-54 Royal Hill SE10
  "venue-1gnufko": "venue-16xmzi7", // Ye Olde London City -> Ye Olde London, 42 Ludgate Hill EC4M
  "venue-oyallt": "venue-cgh71l", // The Alma Newington Green -> The Alma, 59 Newington Green Rd N1
  "venue-g295gw": "venue-698bu3", // The Old Shades (Wikipedia, borough only) -> 37 Whitehall SW1A
  "venue-lkjwk4": "venue-68ns7y", // Ye Olde Mitre (Wikipedia, borough only) -> EC1N 6SJ record
  "venue-1r0yf7r": "venue-s68ndf", // Greene Man (Wikipedia, borough only) -> 383 Euston Road NW1
  "venue-67akji": "venue-pzbwmw", // Cask -> Cask Pub & Kitchen, 6 Charlwood St SW1V
  "venue-6hsjmi": "venue-1b9434y", // The Only Running Footman -> The Footman, 5 Charles St W1J
  "venue-bb2v2w": "venue-1xmac", // The Grapes (Wikipedia) -> The Grapes SW18, 39 Fairfield St
  "venue-cxy85g": "venue-1gy9xkj", // Queens, Crouch End (Wikipedia) -> The Queens, 26 Tottenham Lane N8
  "venue-204w0t": "venue-bdf9cy", // Temperance Billiard Hall (Wikipedia) -> The Temperance, 90 Fulham High St
  "venue-806vol": "venue-mz6byd", // The Ship Soho -> The Ship, 116 Wardour St W1F
  "venue-1pzhx7d": "venue-qw9l0q", // The Castle Inn, Ealing -> The Castle Inn, 36 St Mary's Rd W5
  "venue-172mx8n": "venue-168ndjw", // Crown & Horseshoes (Enfield) -> 12-15 Horseshoe Lane EN2
  "venue-1hq7rkl": "venue-1yiyopd", // Windsor Fenchurch -> The Windsor, 2 New London St EC3R
  "venue-1hd5y0u": "venue-18x41hr", // Yeh Olde Watling -> Ye Olde Watling, 29 Watling St
  "venue-w1qzhg": "venue-13z79s7", // Churchills, Clapham -> Churchills, 151 St John's Hill SW11
  "venue-jlqlve": "venue-hvsgg4", // Cricketers Arms -> Cricketers Enfield, Chase Side Place
  "venue-13wpw9e": "venue-gv8lwa", // Anchor - Bankside -> Anchor, 34 Park Street SE1
  "venue-1i9h4wb": "venue-x8tw9t", // The Cock, Fulham (Wikipedia) -> Cock Tavern, 360 North End Rd SW6
  "venue-1n7o6gw": "venue-1qb9nzj", // The Fox, Palmers Green (Wikipedia) -> The Fox (OSM)
};
// Verified 2026-10-17 like the pairs above, but 50-66 m apart, past the fuzzy
// radius those may bypass. Each is joined by id alone, within
// VERIFIED_FAR_MERGE_METERS and never across a postcode; no other pair gains
// any reach.
const VERIFIED_FAR_VENUE_ALIASES = {
  "venue-11mu12n": "venue-o98nz5", // J.J. Moons (Tooting Broadway) -> J.J. Moon's, 56a High St SW17
  "venue-1clnw4x": "venue-1lj3hj4", // Trafalgar Tavern (Wikipedia) -> The Trafalgar, Park Row SE10
  "venue-1r6x415": "venue-1c7e71q", // The Cross Keys, Hammersmith (Wikipedia) -> 57 Black Lion Lane W6
  "venue-1brmot5": "venue-whwqzo", // Queens Head Winchmore Hill -> The Queens Head, 41-43 Station Rd N21
};
const VERIFIED_FAR_MERGE_METERS = 100;
// Deliberately NOT merged (2026-10-17): The Millers Well (venue-10paqy, E6 2JX)
// and its OSM twin The Miller's Well (venue-1i5w333). The twin still carries
// the Wetherspoon website for a pub the chain left in 2023, so a merge would
// label it a Wetherspoon again. Merge once an OSM refresh drops that tag.

// A record whose address names only a street, so a street-level geocode put it
// hundreds of metres off its pub, and whose name is misspelled past what the
// name matcher forgives. Neither check can see it is the same pub, so each
// entry is a verified pair of ids. An id hashes the record's name, address and
// point, so an edit to either record changes its id and stops the merge rather
// than stretching it to a record nobody checked.
export const VERIFIED_MISPLACED_RECORDS = Object.freeze([
  Object.freeze({
    // "Maruquis of Cornwallis", Bethnal Green Road, about 640 m west of the pub.
    from: "venue-j71x23",
    // The Marquis of Cornwallis, 304 Bethnal Green Rd, E2 0AG. OpenStreetMap
    // way/1059879142 is the only Marquis of Cornwallis on Bethnal Green Road,
    // and no pub stands at the misplaced point.
    to: "venue-1eyb3zz",
  }),
  Object.freeze({
    // "The Moon on the Square - JD Wetherspoon", Unit 30, The Centre, Feltham.
    // The Wetherspoon directory geocodes the shopping centre, 177 m from the pub.
    from: "venue-g9jxzs",
    // The Moon on the Square, 30 High Street, Feltham TW13 4AU, at the pub door
    // in OpenStreetMap. Both records share the postcode.
    to: "venue-86sj0g",
  }),
  Object.freeze({
    // "Three Colts Tavern", address "E2 0EL" alone. pint-prices.com printed it
    // twice; this copy geocodes the postcode, 164 m from the pub.
    from: "venue-1s1ffqx",
    // The Three Colts Tavern, 199 Cambridge Heath Rd, E2 0EL. OpenStreetMap
    // node/13327212416 is the only Three Colts Tavern in E2, 20 m from this
    // record. Both records share the postcode (SEO audit #2126, finding 22).
    to: "venue-1g0y58p",
  }),
]);

// A pub's own website that the source also printed on a namesake across town.
// Each entry is the one site and the postcode of the pub it belongs to; a row
// at any other postcode loses the link, so every export (`npm run export:data`
// runs this pass straight after it) clears it again rather than letting the
// CSV hand it back. A row with a different site, or none, is left alone.
export const VERIFIED_BORROWED_WEBSITES = Object.freeze([
  // The Marquis Cornwallis, 31 Marchmont St. The Bethnal Green Road pub (E2)
  // carried it.
  Object.freeze({ site: "themarquiscornwalliswc1.co.uk", ownerPostcode: "WC1N 1AP" }),
  // Greene King's Goat Tavern, 3a Kensington High Street. The Mayfair Goat
  // Tavern (W1S) carried it.
  Object.freeze({ site: "greeneking.co.uk/pubs/greater-london/goat-tavern", ownerPostcode: "W8 5NP" }),
]);

function normalisedSite(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "");
}

function compactPostcode(value) {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

// The row with a borrowed website cleared, or the same row when it keeps its own.
function withoutBorrowedWebsite(row) {
  const site = normalisedSite(row.website);
  if (!site) return row;
  const entry = VERIFIED_BORROWED_WEBSITES.find((candidate) => candidate.site === site);
  if (!entry) return row;
  if (compactPostcode(row.address).includes(compactPostcode(entry.ownerPostcode))) return row;
  return { ...row, website: "" };
}

const VERIFIED_CANONICAL_IDS = new Set([
  ...Object.values(VERIFIED_VENUE_ALIASES),
  ...Object.values(VERIFIED_FAR_VENUE_ALIASES),
  ...VERIFIED_MISPLACED_RECORDS.map((entry) => entry.to),
]);

// A verified alias can bypass name matching, but never distance or postcode
// checks. Other pairs use the caller's matcher or namesLikelySamePub.
function looksSameFuzzy(a, b, fuzzyMergeMeters, samePubMatch) {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return false;
  if (haversineMeters(a.lat, a.lng, b.lat, b.lng) > fuzzyMergeMeters) return false;
  const pa = postcodeOutward(a.address);
  const pb = postcodeOutward(b.address);
  if (pa && pb && pa !== pb) return false;
  if (VERIFIED_VENUE_ALIASES[a.id] === b.id || VERIFIED_VENUE_ALIASES[b.id] === a.id) return true;
  if (samePubMatch) return samePubMatch(a, b);
  return namesLikelySamePub(a.normName, b.normName);
}

// Canonical preference (lower sorts first = more canonical):
//   1. the target of a verified alias
//   2. no operator suffix   (never surface "- JD Wetherspoon" as the pub name)
//   3. more price rows       (richer coverage)
//   4. more distinct sources
//   5. no parenthetical qualifier (cleaner name)
//   6. has a postcode in its address (a seed row's bare "England" address loses
//      to a directory row's full "N16 0NY" address, so prefer the more complete,
//      more useful address as canonical)
//   7. lexicographically smallest id (stable, deterministic tiebreak)
function compareCanonical(a, b) {
  const aVerified = VERIFIED_CANONICAL_IDS.has(a.id);
  const bVerified = VERIFIED_CANONICAL_IDS.has(b.id);
  if (aVerified !== bVerified) return aVerified ? -1 : 1;
  if (a.hasSuffix !== b.hasSuffix) return a.hasSuffix ? 1 : -1;
  if (a.rowCount !== b.rowCount) return b.rowCount - a.rowCount;
  if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount;
  if (a.hasParen !== b.hasParen) return a.hasParen ? 1 : -1;
  if (a.hasPostcode !== b.hasPostcode) return a.hasPostcode ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Cluster-wide safety net: single-link growth (below) only ever admits a new
// member after checking it against EVERY existing member, so a postcode
// conflict should never survive into a finished cluster — but that invariant
// lives in the growth loop's control flow, not in the cluster's data. This
// re-derives it directly from the cluster's postcodes so a future refactor of
// the growth loop can't silently reintroduce a transitive false-merge without
// tripping a test.
export function clusterHasPostcodeConflict(cluster) {
  const postcodes = cluster
    .map((g) => postcodeOutward(g.address))
    .filter((p) => p != null);
  return new Set(postcodes).size > 1;
}

// Merge a previous run's alias map into this run's freshly-computed one.
//
// A prior run's canonical target can itself become a loser in a later run
// (new source coverage flips which record wins compareCanonical) — naively
// spreading both maps (`{ ...prev, ...current }`) can then create a cycle,
// e.g. prior `{ a: b }` plus current `{ b: a }`. Rebase every prior mapping
// through this run's aliases so it always points at the CURRENT winner, and
// drop any mapping that rebases to a self-map (a cycle already recorded
// historically, or one this run just introduced) rather than persist it.
export function mergeAliasMaps(prevAliases, currentAliases) {
  const previous = prevAliases ?? {};
  const merged = { ...currentAliases };
  for (const [from, to] of Object.entries(previous)) {
    if (Object.prototype.hasOwnProperty.call(merged, from)) continue; // this run wins
    // Follow the chain to its terminal id through BOTH this run's aliases and
    // the prior map — a cycle can live entirely in the prior map (e.g. a
    // historical `{ a: b, b: a }` this run doesn't touch), so traversing only
    // currentAliases would silently persist it. Resolving to a terminal also
    // flattens prior-only chains, matching lib/venueAliases.ts's single-hop
    // lookup (every alias must point straight at a live canonical id).
    let target = to;
    const seen = new Set([from]);
    let cyclic = false;
    while (true) {
      if (seen.has(target)) {
        cyclic = true;
        break;
      }
      seen.add(target);
      if (Object.prototype.hasOwnProperty.call(currentAliases, target)) {
        target = currentAliases[target];
      } else if (Object.prototype.hasOwnProperty.call(previous, target)) {
        target = previous[target];
      } else {
        break;
      }
    }
    if (cyclic) continue; // rebases to a cycle/self-map — drop, never persist
    merged[from] = target;
  }
  return merged;
}

// Fold in coordinate-drift / matching-ish-name duplicates the exact-name pass
// can't see. Two units merge when SOME cross-unit pair looks the same under the
// tight fuzzy predicate AND the combined unit carries no postcode conflict (so a
// real N16-vs-W1D distinction is never bridged). Mutates `units` in place,
// removing folded units. A naive all-pairs scan is O(units²) and too slow on the
// full dataset, so candidate pairs come from a spatial grid: the fuzzy radius is
// tiny, so only groups in the same or an adjacent cell can possibly match.
function unionVerifiedFarPairs(units, groupList) {
  const byId = new Map(groupList.map((g) => [g.id, g]));
  for (const [fromId, toId] of Object.entries(VERIFIED_FAR_VENUE_ALIASES)) {
    const a = byId.get(fromId);
    const b = byId.get(toId);
    if (!a || !b || !looksSamePub(a, b, VERIFIED_FAR_MERGE_METERS)) continue;
    const ua = units.find((u) => u.includes(a));
    const ub = units.find((u) => u.includes(b));
    if (!ua || !ub || ua === ub || clusterHasPostcodeConflict([...ua, ...ub])) continue;
    units.splice(units.indexOf(ub), 1);
    ua.push(...ub);
  }
}

function fuzzyUnionUnits(units, groupList, fuzzyMergeMeters, samePubMatch) {
  const unitOf = new Map(); // group -> its unit array
  for (const u of units) for (const g of u) unitOf.set(g, u);

  // Cell size >= fuzzy radius so any pair within the radius shares a cell edge.
  const cellDeg = Math.max(0.0006, fuzzyMergeMeters / 111_320 + 1e-6);
  const grid = new Map();
  for (const g of groupList) {
    if (!Number.isFinite(g.lat) || !Number.isFinite(g.lng)) continue;
    const key = `${Math.floor(g.lat / cellDeg)}:${Math.floor(g.lng / cellDeg)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push(g);
  }

  // Merge the units of two groups when the fuzzy predicate holds and the merged
  // membership stays postcode-consistent. Re-reads unitOf each time so chained
  // merges compose. Mutates `units`/`unitOf` in place.
  const tryFuzzyMerge = (a, b) => {
    const ua = unitOf.get(a);
    const ub = unitOf.get(b);
    if (ua === ub) return;
    if (!looksSameFuzzy(a, b, fuzzyMergeMeters, samePubMatch)) return;
    if (clusterHasPostcodeConflict([...ua, ...ub])) return;
    const idx = units.indexOf(ub); // fold ub into ua
    if (idx !== -1) units.splice(idx, 1);
    ua.push(...ub);
    for (const g of ub) unitOf.set(g, ua);
  };

  for (const g of groupList) {
    if (!Number.isFinite(g.lat) || !Number.isFinite(g.lng)) continue;
    const ci = Math.floor(g.lat / cellDeg);
    const cj = Math.floor(g.lng / cellDeg);
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        const bucket = grid.get(`${ci + di}:${cj + dj}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other !== g) tryFuzzyMerge(g, other);
        }
      }
    }
  }
}

// Fold each verified misplaced record into its pub (VERIFIED_MISPLACED_RECORDS).
// A pair whose records are absent is skipped: once merged, the loser's rows
// carry the pub's identity, so a later run finds nothing to fold. Mutates
// `units` in place.
function unionVerifiedMisplacedRecords(units, groupList) {
  const groupById = new Map(groupList.map((g) => [g.id, g]));
  for (const entry of VERIFIED_MISPLACED_RECORDS) {
    const from = groupById.get(entry.from);
    const to = groupById.get(entry.to);
    if (!from || !to) continue;
    const fromUnit = units.find((u) => u.includes(from));
    const toUnit = units.find((u) => u.includes(to));
    if (!fromUnit || !toUnit || fromUnit === toUnit) continue;
    if (clusterHasPostcodeConflict([...fromUnit, ...toUnit])) continue;
    units.splice(units.indexOf(fromUnit), 1);
    toUnit.push(...fromUnit);
  }
}

/**
 * Canonicalize a raw price-row dataset.
 *
 * @param {Array<object>} rows  raw pint_prices rows
 * @param {{maxMergeMeters?: number, fuzzyMergeMeters?: number, samePubMatch?: (a: object, b: object) => boolean}} [options]
 * @returns {{
 *   rows: Array<object>,                 // rows with duplicate identities rewritten to canonical
 *   aliases: Record<string,string>,      // losingVenueId -> canonicalVenueId
 *   clusters: Array<object>,             // human-readable merge report
 *   stats: object,
 * }}
 */
export function buildVenueGroupList(rows) {
  const groups = new Map();
  rows.forEach((row, idx) => {
    const key = venueGroupingKey(row);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        id: stableVenueIdFromKey(key),
        name: String(row.pub_name ?? ""),
        address: String(row.address ?? ""),
        lat: Number(row.latitude),
        lng: Number(row.longitude),
        rowIdx: [],
        sourceSet: new Set(),
      };
      groups.set(key, g);
    }
    g.rowIdx.push(idx);
    String(row.source_datasets ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => g.sourceSet.add(s));
  });

  return [...groups.values()].map((g) => ({
    ...g,
    rowCount: g.rowIdx.length,
    sourceCount: g.sourceSet.size,
    normName: normalizeVenueIdentityName(g.name),
    hasSuffix: hasOperatorSuffix(g.name),
    hasParen: /\([^)]*\)/.test(g.name),
    hasPostcode: postcodeOutward(g.address) != null,
  }));
}

export function canonicalizeDataset(rows, options = {}) {
  const maxMergeMeters = options.maxMergeMeters ?? 100;
  const fuzzyMergeMeters = options.fuzzyMergeMeters ?? DEFAULT_FUZZY_MERGE_METERS;
  const samePubMatch = options.samePubMatch;

  const groupList = buildVenueGroupList(rows);

  // 2. Cluster identities that share a normalized name and look like the same
  //    pub (single-link over the proximity+postcode predicate).
  const byName = new Map();
  for (const g of groupList) {
    if (!g.normName) continue;
    if (!byName.has(g.normName)) byName.set(g.normName, []);
    byName.get(g.normName).push(g);
  }

  // 2a. Exact-name clusters (single physical pub across dataset lineages). Every
  //     group lands in exactly one "unit" — a multi-member exact cluster, or a
  //     singleton — which the fuzzy pass (2b) may then union further.
  const placed = new Set();
  const units = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const used = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i += 1) {
      if (used[i]) continue;
      const cluster = [list[i]];
      used[i] = true;
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < list.length; j += 1) {
          if (used[j]) continue;
          if (cluster.every((c) => looksSamePub(c, list[j], maxMergeMeters))) {
            cluster.push(list[j]);
            used[j] = true;
            grew = true;
          }
        }
      }
      // Belt-and-braces: the growth loop above already blocks postcode-
      // conflicting members from joining, so this should be unreachable — but
      // never silently merge on a violated invariant. Drop the whole cluster
      // (its members fall through to singletons) rather than guess.
      if (cluster.length > 1 && !clusterHasPostcodeConflict(cluster)) {
        units.push(cluster);
        for (const g of cluster) placed.add(g);
      }
    }
  }
  // Every group not in a multi-member exact cluster starts as its own unit.
  for (const g of groupList) {
    if (!placed.has(g)) units.push([g]);
  }

  // 2b. Fuzzy union: fold in coordinate-drift / matching-ish-name duplicates the
  //     exact pass can't see (see fuzzyUnionUnits).
  fuzzyUnionUnits(units, groupList, fuzzyMergeMeters, samePubMatch);

  // 2c. The verified pairs too far apart for the fuzzy grid to ever compare.
  unionVerifiedFarPairs(units, groupList);

  // 2c. Verified misplaced records: a street-only geocode and a misspelt name
  //     that no distance or name check can bridge.
  unionVerifiedMisplacedRecords(units, groupList);

  const clusters = units.filter((u) => u.length > 1);

  // 3. Pick the canonical identity per cluster and plan the row rewrites.
  const aliases = {};
  const rewriteByRowIdx = new Map();
  const clusterReport = [];
  for (const cluster of clusters) {
    const canonical = [...cluster].sort(compareCanonical)[0];
    const target = {
      pub_name: canonical.name,
      address: canonical.address,
      latitude: canonical.lat,
      longitude: canonical.lng,
    };
    const mergedFrom = [];
    for (const g of cluster) {
      if (g === canonical) continue;
      aliases[g.id] = canonical.id; // ids differ per group, so never self-maps
      mergedFrom.push({ id: g.id, name: g.name, rows: g.rowCount });
      for (const idx of g.rowIdx) rewriteByRowIdx.set(idx, target);
    }
    clusterReport.push({
      canonicalId: canonical.id,
      canonicalName: canonical.name,
      mergedFrom,
    });
  }

  // 4. Rewrite only the four identity fields of losing rows; every other field
  //    (price, pint_name, source_datasets, …) is preserved so per-row
  //    provenance stays honest.
  //    A verified borrowed website is cleared from any row at another pub's
  //    postcode (VERIFIED_BORROWED_WEBSITES).
  let borrowedWebsitesCleared = 0;
  const newRows = rows.map((row, idx) => {
    const rw = rewriteByRowIdx.get(idx);
    const rewritten = rw ? { ...row, ...rw } : row;
    const cleaned = withoutBorrowedWebsite(rewritten);
    if (cleaned !== rewritten) borrowedWebsitesCleared += 1;
    return cleaned;
  });

  return {
    rows: newRows,
    aliases,
    clusters: clusterReport,
    stats: {
      inputRows: rows.length,
      venueIdentitiesBefore: groupList.length,
      duplicateClusters: clusters.length,
      mergedRecords: Object.keys(aliases).length,
      venueIdentitiesAfter: groupList.length - Object.keys(aliases).length,
      borrowedWebsitesCleared,
    },
  };
}
