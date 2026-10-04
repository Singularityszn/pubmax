#!/usr/bin/env node
/**
 * Check up to 2,000 already-verified London pubs, most central first.
 * Dry run is default and makes no network calls. --write reads live usage,
 * lifts daily quota for this job, checks hours in memory, and restores quota.
 * No Google response is saved. Resume the verdict-only checkpoint across days.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseOsmOpeningHours } from "../lib/nearDesk.ts";
import { restoreQuotasUntilVerified } from "../lib/placesVerification.ts";
import { haversineMeters } from "./lib/geo.mjs";
import { checkHours, hasHours, planHoursCheck } from "./lib/placesHoursCheck.ts";
import { accessToken, dailyOverrideValue, effectiveDailyLimit, setDailyOverrides,
  monthPlacesRequests, SEARCH_METRIC, DETAILS_METRIC } from "./lib/googlePlacesQuota.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAP = 20;
const REASON = "london-pub-hours-verify";
const DAY = new Date().toISOString().slice(0, 10);
const OUT = join(ROOT, "data/places_verification", "pub_hours_london.json");
const REVIEW = join(ROOT, "data/places_verification", "pub_hours_review_london.json");
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
function write(path, value) {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

function loadVenues() {
  const hours = new Map(read("data/osm/uk/uk_osm_pubs.json").pubs.map((row) => [
    row.osmId.replace(/^node\//, "n").replace(/^way\//, "w").replace(/^relation\//, "r"),
    parseOsmOpeningHours(row.openingHours),
  ]));
  // The desk pack is a separate stored OSM snapshot. Prefer its exact-ref hours when present.
  for (const row of read("public/data/london_desks/desks.json").venues) {
    if (row[5] === "pub" && typeof row[8] === "string" && row[8].trim()) hours.set(row[0], parseOsmOpeningHours(row[8]));
  }
  const current = new Map();
  const manifest = read("public/data/london_venues/manifest.json");
  // Only the current published pack, never retired sibling packs.
  if (!/^\/data\/london_venues\/packs\/[a-f0-9]{16}\/$/.test(manifest.urlPrefix)) throw new Error("Invalid London pack prefix");
  for (const shard of manifest.shards) {
    if (!/^[0-9.-]+_[0-9.-]+$/.test(shard.id)) throw new Error("Invalid London shard id");
    const body = read(`public${manifest.urlPrefix}${shard.id}.json`);
    for (const row of body.venues ?? []) {
      if (row[5] === "pub") current.set(`venue-osm-${row[0]}`, {
        venueId: `venue-osm-${row[0]}`, hours: hours.get(row[0]) ?? null,
        distance: haversineMeters(row[3], row[4], 51.5074, -0.1278),
      });
    }
  }
  return read("data/places_verification/london.json").pubs
    .filter((row) => current.has(row.venueId))
    .map((row) => ({ ...current.get(row.venueId), googlePlaceId: row.googlePlaceId }))
    .sort((a, b) => a.distance - b.distance || a.venueId.localeCompare(b.venueId)).slice(0, 2000);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--write", "--dry-run"].includes(arg)) || (args.includes("--write") && args.includes("--dry-run"))) {
    throw new Error("Usage: npm run verify:pub-hours -- [--dry-run | --write]");
  }
  const venues = loadVenues();
  if (!venues.length) throw new Error("No verified London pubs joined to the current pack");
  const fingerprint = createHash("sha256").update(JSON.stringify(venues)).digest("hex");
  const checkpoint = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  if (checkpoint && checkpoint.inputHash !== fingerprint) throw new Error("Hours inputs changed during this run; refuse stale checkpoint");
  const priorRows = checkpoint?.rows ?? [];
  const priorCalls = checkpoint?.spend.calls ?? 0;
  const priorUsd = checkpoint?.spend.estimatedUsd ?? 0;
  const done = new Set(priorRows.map((row) => row.venueId));
  const pending = venues.filter((row) => !done.has(row.venueId));
  const live = args.includes("--write");
  const apiKey = live ? process.env.GOOGLE_PLACES_API_KEY : null;
  if (live && !apiKey) throw new Error("GOOGLE_PLACES_API_KEY is required for --write");
  // Total Places requests deliberately underestimates remaining Enterprise credit.
  // Monitoring may lag, so known prior Enterprise calls are also reserved.
  const token = live ? accessToken() : null;
  const monthUsage = live ? await monthPlacesRequests(token) : null;
  const reserved = checkpoint?.checkedOn?.slice(0, 7) === DAY.slice(0, 7) ? 1000 - checkpoint.spend.remainingFreeCalls : 0;
  const alreadyUsed = monthUsage === null ? null : Math.max(monthUsage, reserved);
  const budget = planHoursCheck(pending.filter((row) => hasHours(row.hours)).length, alreadyUsed, Math.max(0, CAP - priorUsd));
  console.log(JSON.stringify({ mode: live ? "live" : "dry-run", selected: venues.length,
    storedHours: venues.filter((row) => hasHours(row.hours)).length, pending: pending.length,
    monthToDatePlacesRequests: monthUsage, monthlyUsageRead: live,
    calls: budget.calls, projectedUsd: budget.projectedUsd, priorEstimatedUsd: priorUsd, capUsd: CAP }));
  if (!live) return;
  const save = (newRows, calls) => {
    const rows = [...priorRows, ...newRows];
    write(OUT, { version: 1, inputHash: fingerprint, checkedOn: DAY,
      ordering: "distance from 51.5074,-0.1278, then venueId", selected: venues.length,
      spend: { capUsd: CAP, calls: priorCalls + calls, estimatedUsd: Math.round((priorUsd + Math.max(0, calls - budget.freeCalls) * 0.02) * 100) / 100,
        remainingFreeCalls: Math.max(0, budget.freeCalls - calls) }, rows });
    write(REVIEW, { version: 1, checkedOn: DAY, rows: rows.filter((row) => row.verdict === "mismatch") });
  };
  if (!budget.calls) {
    await checkHours({ venues: pending, maxCalls: 0, apiKey, save });
    return;
  }
  const searchBefore = await dailyOverrideValue(token, SEARCH_METRIC);
  const detailsBefore = await dailyOverrideValue(token, DETAILS_METRIC);
  let restoreNeeded = false;
  const restore = async () => {
    if (!restoreNeeded) return;
    await restoreQuotasUntilVerified({ attempts: 3, expectedSearch: String(searchBefore), expectedDetails: String(detailsBefore),
      attempt: async () => {
        const fresh = accessToken();
        await setDailyOverrides(fresh, searchBefore, detailsBefore, REASON);
        return { search: String(await effectiveDailyLimit(fresh, SEARCH_METRIC)), details: String(await effectiveDailyLimit(fresh, DETAILS_METRIC)) };
      } });
    restoreNeeded = false;
    console.log("Original daily quota overrides restored and verified");
  };
  const controller = new AbortController();
  const onSignal = () => { process.exitCode = 130; controller.abort(); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    restoreNeeded = true;
    await setDailyOverrides(token, searchBefore, Math.max(Number(detailsBefore), monthUsage + budget.calls), REASON);
    await checkHours({ venues: pending, maxCalls: budget.calls, apiKey, save, signal: controller.signal,
      pace: () => new Promise((resolve) => setTimeout(resolve, 150)) });
  } finally {
    await restore();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode ||= 1; });
