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
 *   1. Keep the richer/cleaner record's id as CANONICAL; never delete an id
 *      silently — every losing id is recorded in an alias map so stored
 *      references (pint drops, plans, saved lists) still resolve.
 *   2. Union the duplicate's price rows into the canonical identity, keeping
 *      each row's own `source_datasets` / provenance untouched — no averaging,
 *      no invented prices.
 *   3. Only merge when confident it's the SAME pub: identical normalized name
 *      AND geo proximity <= 100 m AND no conflicting postcode. Coordinates can
 *      lie (a Rickmansworth "Coach & Horses" mis-geocoded into Soho), so a
 *      differing postcode outward code BLOCKS the merge.
 */

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
// SAME physical pub. Matches "- JD Wetherspoon", "(Wetherspoons)", "- Greene
// King", "- Young's", … Used to (a) collapse names for duplicate detection and
// (b) prefer the clean, brewery-neutral pub name as the canonical identity.
const OPERATOR_SUFFIX_RE =
  /\s*[-–—(]\s*(jd\s+)?wetherspoons?\b.*$|\s*[-–—]\s*(greene\s+king|nicholson'?s|young'?s|fuller'?s|sam(uel)?\s+smith'?s?|mitchells?\s*&?\s*butlers?|m\s*&\s*b|stonegate)\b.*$/i;

export function hasOperatorSuffix(name) {
  return OPERATOR_SUFFIX_RE.test(String(name ?? ""));
}

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

export function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
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

// Canonical preference (lower sorts first = more canonical):
//   1. no operator suffix  (never surface "- JD Wetherspoon" as the pub name)
//   2. more price rows      (richer coverage)
//   3. more distinct sources
//   4. no parenthetical qualifier (cleaner name)
//   5. lexicographically smallest id (stable, deterministic tiebreak)
function compareCanonical(a, b) {
  if (a.hasSuffix !== b.hasSuffix) return a.hasSuffix ? 1 : -1;
  if (a.rowCount !== b.rowCount) return b.rowCount - a.rowCount;
  if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount;
  if (a.hasParen !== b.hasParen) return a.hasParen ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Canonicalize a raw price-row dataset.
 *
 * @param {Array<object>} rows  raw pint_prices rows
 * @param {{maxMergeMeters?: number}} [options]
 * @returns {{
 *   rows: Array<object>,                 // rows with duplicate identities rewritten to canonical
 *   aliases: Record<string,string>,      // losingVenueId -> canonicalVenueId
 *   clusters: Array<object>,             // human-readable merge report
 *   stats: object,
 * }}
 */
export function canonicalizeDataset(rows, options = {}) {
  const maxMergeMeters = options.maxMergeMeters ?? 100;

  // 1. Fold rows into their existing venue identities.
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

  const groupList = [...groups.values()].map((g) => ({
    ...g,
    rowCount: g.rowIdx.length,
    sourceCount: g.sourceSet.size,
    normName: normalizeVenueIdentityName(g.name),
    hasSuffix: hasOperatorSuffix(g.name),
    hasParen: /\([^)]*\)/.test(g.name),
  }));

  // 2. Cluster identities that share a normalized name and look like the same
  //    pub (single-link over the proximity+postcode predicate).
  const byName = new Map();
  for (const g of groupList) {
    if (!g.normName) continue;
    if (!byName.has(g.normName)) byName.set(g.normName, []);
    byName.get(g.normName).push(g);
  }

  const clusters = [];
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
      if (cluster.length > 1) clusters.push(cluster);
    }
  }

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
  const newRows = rows.map((row, idx) => {
    const rw = rewriteByRowIdx.get(idx);
    if (!rw) return row;
    return { ...row, ...rw };
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
    },
  };
}
