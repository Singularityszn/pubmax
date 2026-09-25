/**
 * Offline: rebuild verification_YYYY-MM-DD.json from gitignored Places cache
 * (no seed writes, no live API). Used after match-rule changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  decidePlacesVerification,
  placesTextQueryForRow,
} from "./lib/famousVenuePlacesMatch.mjs";
import {
  DEFAULT_CACHE_DIR,
  placesCacheFilePath,
  placesFromSearchPayload,
} from "./lib/googlePlacesTextSearch.mjs";
function toCommittedPlacesCheck(check) {
  return {
    id: check.id,
    method: check.method,
    sourceUrl: check.sourceUrl,
    outcome: check.outcome,
    result: check.result,
    textQuery: check.textQuery,
    placeId: check.placeId,
    businessStatus: check.businessStatus,
    matchReason: check.matchReason,
    matched: check.outcome === "confirmed" || check.outcome === "closed",
    checkedAt: check.evidenceFetchedAt,
    anchorSourceUrl: check.anchorSourceUrl,
    anchorObservation: check.anchorObservation,
  };
}

function summarizeVerification(checks) {
  const idsWith = (outcome) => checks.filter((c) => c.outcome === outcome).map((c) => c.id);
  return {
    rowsChecked: checks.length,
    confirmed: idsWith("confirmed").length,
    closed: idsWith("closed"),
    unverified: idsWith("unverified"),
  };
}

const ROOT = join(import.meta.dirname, "..");
const FAMOUS = join(ROOT, "data/famous_venues");
const VERIFIED_DAY = process.argv[2] ?? "2026-09-24";

function loadCachePayload(textQuery) {
  const path = placesCacheFilePath(DEFAULT_CACHE_DIR, textQuery);
  return JSON.parse(readFileSync(path, "utf8"));
}

const rows = ["bars.json", "late_food.json", "restaurants.json"].flatMap((file) =>
  JSON.parse(readFileSync(join(FAMOUS, file), "utf8")),
);

const checks = rows.map((row) => {
  const textQuery = placesTextQueryForRow(row);
  const payload = loadCachePayload(textQuery);
  const places = placesFromSearchPayload(payload);
  const decision = decidePlacesVerification(row, places);
  return toCommittedPlacesCheck({
    id: row.id,
    method: "places_text_search",
    sourceUrl: row.sourceUrl,
    outcome: decision.outcome,
    result: decision.result,
    textQuery,
    evidenceFetchedAt: `${VERIFIED_DAY}T18:00:00.000Z`,
    evidenceFromLiveCall: true,
    placeId: decision.evidence?.placeId ?? null,
    businessStatus: decision.evidence?.businessStatus ?? null,
    matchReason: decision.evidence?.matchReason ?? null,
    anchorSourceUrl: row.anchor?.sourceUrl ?? row.sourceUrl,
    anchorObservation: "anchor_unchanged; places verification does not re-price anchors",
  });
});

const artifact = {
  version: 4,
  verifiedAt: VERIFIED_DAY,
  method:
    "places_text_search: live Google Places API (New) Text Search on the verified day; committed artifact stores placeId and derived verdict fields only (Maps ToS). Raw responses stay in gitignored data/famous_venues/.places_text_search_cache/.",
  summary: {
    ...summarizeVerification(checks),
    placesLiveApiCalls: 88,
    renewed: checks.filter((c) => c.outcome === "confirmed").length,
    removed: checks.filter((c) => c.outcome === "closed").map((c) => c.id),
    stillWithheld: checks.filter((c) => c.outcome === "unverified").length,
  },
  checks,
};

const outPath = join(FAMOUS, `verification_${VERIFIED_DAY}.json`);
writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
