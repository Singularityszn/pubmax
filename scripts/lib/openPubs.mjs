/**
 * Open Pubs (getthedata.com) evaluation helpers.
 *
 * Pure parse + identity match for the FSA-derived UK pub CSV. Used by
 * scripts/evaluate_open_pubs.mjs and __tests__/openPubs.test.ts.
 *
 * This module never invents prices and never mutates the curated slim index.
 * Matching is conservative: same normalised name, distance gate, optional
 * postcode outward conflict block (mirrors scripts/lib/ukOsmSeed.mjs).
 *
 * Upstream: https://www.getthedata.com/open-pubs
 * Columns (headerless CSV): fsa_id, name, address, postcode, easting, northing,
 * latitude, longitude, local_authority.
 */

import { normalisePubName } from "./venueMatch.mjs";
import {
  haversineMeters,
  normalizeVenueIdentityName,
  postcodeOutward,
} from "./venueCanonicalization.mjs";

/** Official zip download (redirect target from getthedata.com). */
export const OPEN_PUBS_DOWNLOAD_URL =
  "https://download.getthedata.com/downloads/open_pubs.csv.zip";

/** Same building-width gate as curated ↔ OSM overlap. */
export const OPEN_PUBS_MATCH_RADIUS_M = 150;

export const OPEN_PUBS_COLUMNS = [
  "fsa_id",
  "name",
  "address",
  "postcode",
  "easting",
  "northing",
  "latitude",
  "longitude",
  "local_authority",
];

const INDEX_CELL_DEG = 0.01;

function cellKey(lat, lng) {
  return `${Math.floor(lat / INDEX_CELL_DEG)}:${Math.floor(lng / INDEX_CELL_DEG)}`;
}

/** Parse a CSV scalar that may be quoted, empty, or MySQL-style \N. */
export function parseCsvNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "" || s === "\\N" || s.toLowerCase() === "null") return null;
  return s;
}

export function parseFiniteNumber(value) {
  const s = parseCsvNull(value);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Minimal RFC4180-ish CSV splitter for the Open Pubs export (quoted fields,
 * commas inside quotes, no embedded newlines in practice).
 * @param {string} text
 * @returns {string[][]}
 */
export function splitCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function looksLikeHeader(cells) {
  if (!cells?.length) return false;
  const first = String(cells[0] ?? "")
    .trim()
    .toLowerCase();
  return first === "fsa_id" || first === "fsaid";
}

/**
 * @typedef {{
 *   fsaId: number,
 *   name: string,
 *   address: string,
 *   postcode: string | null,
 *   easting: number | null,
 *   northing: number | null,
 *   lat: number | null,
 *   lng: number | null,
 *   localAuthority: string | null,
 * }} OpenPubsRow
 */

/**
 * Normalise one Open Pubs field array into a row, or null when unusable.
 * Requires a numeric fsa_id and a non-empty name. Coordinates may be null
 * (some easting/northing rows ship `\N` lat/lng).
 * @param {string[]} cells
 * @returns {OpenPubsRow | null}
 */
export function normalizeOpenPubsCells(cells) {
  if (!Array.isArray(cells) || cells.length < 4) return null;
  const fsaId = parseFiniteNumber(cells[0]);
  if (fsaId == null || fsaId <= 0) return null;
  const name = parseCsvNull(cells[1]);
  if (!name) return null;
  return {
    fsaId: Math.trunc(fsaId),
    name,
    address: parseCsvNull(cells[2]) ?? "",
    postcode: parseCsvNull(cells[3]),
    easting: parseFiniteNumber(cells[4]),
    northing: parseFiniteNumber(cells[5]),
    lat: parseFiniteNumber(cells[6]),
    lng: parseFiniteNumber(cells[7]),
    localAuthority: parseCsvNull(cells[8]),
  };
}

/**
 * Parse a full Open Pubs CSV body into normalised rows. Headerless by default;
 * a leading fsa_id header row is skipped when present.
 * @param {string} text
 * @returns {OpenPubsRow[]}
 */
export function parseOpenPubsCsv(text) {
  const raw = splitCsv(text);
  if (raw.length === 0) return [];
  let start = 0;
  if (looksLikeHeader(raw[0])) start = 1;
  const out = [];
  for (let i = start; i < raw.length; i += 1) {
    const row = normalizeOpenPubsCells(raw[i]);
    if (row) out.push(row);
  }
  return out;
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   lat: number,
 *   lng: number,
 *   address?: string | null,
 *   postcode?: string | null,
 *   layer: "curated" | "osm",
 * }} IdentityCandidate
 */

/**
 * @typedef {{
 *   byCell: Map<string, Array<IdentityCandidate & { normalizedName: string, identityName: string, outward: string | null }>>,
 *   size: number,
 * }} IdentityIndex
 */

/**
 * Spatial + name index over curated slim and/or OSM identity candidates.
 * @param {IdentityCandidate[]} candidates
 * @returns {IdentityIndex}
 */
export function buildIdentityIndex(candidates) {
  const byCell = new Map();
  let size = 0;
  for (const entry of candidates) {
    if (!entry?.id || !entry?.name) continue;
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) continue;
    const layer = entry.layer === "osm" ? "osm" : "curated";
    const indexed = {
      id: String(entry.id),
      name: String(entry.name),
      lat: entry.lat,
      lng: entry.lng,
      address: entry.address ?? null,
      postcode: entry.postcode ?? null,
      layer,
      normalizedName: normalisePubName(String(entry.name)),
      identityName: normalizeVenueIdentityName(String(entry.name)),
      outward: postcodeOutward(entry.postcode ?? entry.address ?? ""),
    };
    if (!indexed.normalizedName && !indexed.identityName) continue;
    const key = cellKey(entry.lat, entry.lng);
    const bucket = byCell.get(key);
    if (bucket) bucket.push(indexed);
    else byCell.set(key, [indexed]);
    size += 1;
  }
  return { byCell, size };
}

function postcodesConflict(aOutward, bOutward) {
  return Boolean(aOutward && bOutward && aOutward !== bOutward);
}

/**
 * Match one Open Pubs row to an identity candidate inside the radius gate.
 * Within the same name tier, curated beats OSM (we want the product id when
 * both layers know the pub); distance is the tie-break inside a layer.
 * @param {OpenPubsRow} row
 * @param {IdentityIndex} index
 * @param {{ radiusM?: number }} [opts]
 * @returns {{
 *   id: string,
 *   layer: "curated" | "osm",
 *   name: string,
 *   matchType: "exact-name-distance" | "identity-name-distance",
 *   distanceM: number,
 * } | null}
 */
export function matchOpenPubToIdentity(row, index, opts = {}) {
  if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
  const radiusM = opts.radiusM ?? OPEN_PUBS_MATCH_RADIUS_M;
  const normalized = normalisePubName(row.name);
  const identity = normalizeVenueIdentityName(row.name);
  if (!normalized && !identity) return null;
  const outward = postcodeOutward(row.postcode ?? row.address ?? "");

  const latCell = Math.floor(row.lat / INDEX_CELL_DEG);
  const lngCell = Math.floor(row.lng / INDEX_CELL_DEG);
  /** @type {null | { id: string, layer: "curated" | "osm", name: string, matchType: "exact-name-distance" | "identity-name-distance", distanceM: number, tier: number, layerRank: number }} */
  let best = null;

  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLng = -1; dLng <= 1; dLng += 1) {
      const bucket = index.byCell.get(`${latCell + dLat}:${lngCell + dLng}`);
      if (!bucket) continue;
      for (const candidate of bucket) {
        if (postcodesConflict(outward, candidate.outward)) continue;
        const distanceM = haversineMeters(row.lat, row.lng, candidate.lat, candidate.lng);
        if (distanceM > radiusM) continue;

        let matchType = null;
        let tier = 9;
        if (normalized && candidate.normalizedName === normalized) {
          matchType = "exact-name-distance";
          tier = 0;
        } else if (identity && candidate.identityName === identity) {
          matchType = "identity-name-distance";
          tier = 1;
        } else {
          continue;
        }

        const layerRank = candidate.layer === "curated" ? 0 : 1;
        if (
          !best ||
          tier < best.tier ||
          (tier === best.tier && layerRank < best.layerRank) ||
          (tier === best.tier &&
            layerRank === best.layerRank &&
            distanceM < best.distanceM)
        ) {
          best = {
            id: candidate.id,
            layer: candidate.layer,
            name: candidate.name,
            matchType,
            distanceM,
            tier,
            layerRank,
          };
        }
      }
    }
  }

  if (!best) return null;
  return {
    id: best.id,
    layer: best.layer,
    name: best.name,
    matchType: best.matchType,
    distanceM: Math.round(best.distanceM),
  };
}

/**
 * Dry-run evaluation: match rates only. Never mutates candidates or rows.
 * @param {OpenPubsRow[]} rows
 * @param {IdentityCandidate[]} candidates
 * @param {{ radiusM?: number }} [opts]
 */
export function evaluateOpenPubsMatches(rows, candidates, opts = {}) {
  const index = buildIdentityIndex(candidates);
  let withCoords = 0;
  let matchedCurated = 0;
  let matchedOsm = 0;
  let unmatched = 0;
  let skippedNoCoords = 0;
  /** @type {Array<{ fsaId: number, name: string, match: ReturnType<typeof matchOpenPubToIdentity> }>} */
  const matches = [];
  /** @type {Array<{ fsaId: number, name: string, reason: string }>} */
  const misses = [];

  for (const row of rows) {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
      skippedNoCoords += 1;
      misses.push({ fsaId: row.fsaId, name: row.name, reason: "no-coords" });
      continue;
    }
    withCoords += 1;
    const match = matchOpenPubToIdentity(row, index, opts);
    if (!match) {
      unmatched += 1;
      misses.push({ fsaId: row.fsaId, name: row.name, reason: "no-identity-match" });
      continue;
    }
    matches.push({ fsaId: row.fsaId, name: row.name, match });
    if (match.layer === "curated") matchedCurated += 1;
    else matchedOsm += 1;
  }

  const matched = matchedCurated + matchedOsm;
  const pct = (n, d) => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);

  return {
    rowsRead: rows.length,
    identityCandidates: index.size,
    withCoords,
    skippedNoCoords,
    matched,
    matchedCurated,
    matchedOsm,
    unmatched,
    matchRateOfCoordsPct: pct(matched, withCoords),
    curatedRateOfCoordsPct: pct(matchedCurated, withCoords),
    osmOnlyRateOfCoordsPct: pct(matchedOsm, withCoords),
    radiusM: opts.radiusM ?? OPEN_PUBS_MATCH_RADIUS_M,
    matches,
    misses,
  };
}

/**
 * Map a venues_slim row into an identity candidate.
 * @param {{ id?: unknown, name?: unknown, lat?: unknown, lng?: unknown, filterHints?: { searchText?: string } }} venue
 * @returns {IdentityCandidate | null}
 */
export function identityFromSlimVenue(venue) {
  if (!venue || typeof venue.id !== "string" || typeof venue.name !== "string") return null;
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lng)) return null;
  return {
    id: venue.id,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    address: venue.filterHints?.searchText ?? null,
    layer: "curated",
  };
}

/**
 * Map a UK OSM seed pub into an identity candidate (`venue-uk-*` id shape).
 * @param {{ osmId?: unknown, name?: unknown, lat?: unknown, lng?: unknown, address?: unknown, postcode?: unknown }} pub
 * @param {(osmId: string) => string} [idForOsm]
 * @returns {IdentityCandidate | null}
 */
export function identityFromOsmPub(pub, idForOsm) {
  if (!pub || typeof pub.name !== "string") return null;
  if (!Number.isFinite(pub.lat) || !Number.isFinite(pub.lng)) return null;
  const osmId = String(pub.osmId ?? "");
  if (!osmId) return null;
  const id =
    typeof idForOsm === "function"
      ? idForOsm(osmId)
      : `venue-uk-${osmId.replace("node/", "n").replace("way/", "w").replace("relation/", "r")}`;
  return {
    id,
    name: pub.name,
    lat: pub.lat,
    lng: pub.lng,
    address: typeof pub.address === "string" ? pub.address : null,
    postcode: typeof pub.postcode === "string" ? pub.postcode : null,
    layer: "osm",
  };
}
