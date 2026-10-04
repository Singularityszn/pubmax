#!/usr/bin/env node
/** Copy four venue fields from verified Places ids. Dry run is default. */
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PLACES_REFRESH_DAYS, placesEnrichmentRecord, placesRecordObservedAt, planPlacesEnrichment } from "../lib/placesEnrichment.ts";
import { restoreQuotasUntilVerified } from "../lib/placesVerification.ts";
import { accessToken, dailyOverrideValue, effectiveDailyLimit, setDailyOverrides,
  monthPlacesRequests, SEARCH_METRIC, DETAILS_METRIC } from "./lib/googlePlacesQuota.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/places_enrichment.json");
const CHECKPOINT = join(ROOT, "data/places_verification/enrichment_progress.json");
const CAP_USD = 85;
const MASK = "regularOpeningHours.periods,regularOpeningHours.weekdayDescriptions,formattedAddress,nationalPhoneNumber,websiteUri";
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
function write(file, value) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

function runOptions() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--write", "--dry-run", "--usage", "--exclusive", "--refresh"].includes(arg))
    || (args.includes("--write") && args.includes("--dry-run"))) throw new Error("Use --dry-run [--usage] [--refresh] or --write --exclusive [--refresh]");
  const live = args.includes("--write");
  if (live && !args.includes("--exclusive")) throw new Error("Confirm other shared-key jobs finished before --write --exclusive");
  return { live, usage: args.includes("--usage"), refresh: args.includes("--refresh") };
}

/** The committed pack is the spend ledger in a fresh clone; the local checkpoint only journals ahead of it. */
function priorLedger() {
  const checkpoint = existsSync(CHECKPOINT) ? { priorAttempts: 0, runStartedAt: null, ...read(CHECKPOINT) } : null;
  const pack = existsSync(OUT) ? read(OUT) : null;
  const committed = pack && { inputHash: pack.inputHash, attempts: pack.spend.attemptedCalls, priorAttempts: pack.spend.priorAttemptedCalls,
    runStartedAt: pack.spend.runStartedAt, completed: Object.fromEntries(pack.venues.map((row) => [row.venueId, row])), errors: pack.errors };
  const total = (ledger) => ledger ? ledger.priorAttempts + ledger.attempts : -1;
  return total(committed) > total(checkpoint) ? committed : checkpoint;
}

/** Resume the current push, or with --refresh start a new one once a copied field is past its refresh window. */
function currentPush(rows, reportRows, inputHash, refresh) {
  let previous = priorLedger() ?? { inputHash, attempts: 0, priorAttempts: 0, runStartedAt: null, completed: {}, errors: [] };
  const plan = planPlacesEnrichment(rows, reportRows, CAP_USD, 0);
  const pendingIn = (ledger) => plan.rows.filter((row) => {
    const record = ledger.completed[row.venueId];
    if (!record) return true;
    const observedAt = placesRecordObservedAt(record);
    return Boolean(ledger.runStartedAt) && (!observedAt || Date.parse(observedAt) < Date.parse(ledger.runStartedAt));
  });
  const budgetFor = (ledger) => planPlacesEnrichment(pendingIn(ledger), reportRows, CAP_USD, ledger.attempts * 0.02);
  if (refresh) {
    const oldest = Object.values(previous.completed).map(placesRecordObservedAt).filter(Boolean).sort()[0];
    if (!oldest || Date.now() - Date.parse(oldest) <= PLACES_REFRESH_DAYS * 86_400_000)
      throw new Error(`No copied field is older than ${PLACES_REFRESH_DAYS} days; nothing to refresh`);
    if (previous.inputHash === inputHash && budgetFor(previous).rows.length)
      throw new Error("The current push still has budgeted rows; resume it without --refresh");
    const verifiedIds = new Map(rows.map((row) => [row.venueId, row.googlePlaceId]));
    previous = { ...previous, inputHash, priorAttempts: previous.priorAttempts + previous.attempts, attempts: 0, runStartedAt: new Date().toISOString(),
      completed: Object.fromEntries(Object.entries(previous.completed).filter(([venueId, record]) => verifiedIds.get(venueId) === record.googlePlaceId)) };
  } else if (previous.inputHash !== inputHash) throw new Error("Inputs changed; a resume needs the original inputs, and a new push needs a stale --refresh");
  return { previous, plan, pending: pendingIn(previous), budget: budgetFor(previous) };
}

async function main() {
  const { live, usage, refresh } = runOptions();
  const dir = join(ROOT, "data/places_verification");
  const verified = new Map();
  for (const file of readdirSync(dir).sort((a, b) => (a === "london.json" ? -1 : b === "london.json" ? 1 : a.localeCompare(b)))) {
    if (!file.endsWith(".json") || /(?:progress|review|pub_hours|closed_pubs)/.test(file)) continue;
    const body = read(join(dir, file));
    for (const row of body.pubs ?? []) {
      const existing = verified.get(row.venueId);
      if (existing && existing.googlePlaceId !== row.googlePlaceId) throw new Error("Conflicting verified place ids");
      verified.set(row.venueId, { venueId: row.venueId, googlePlaceId: row.googlePlaceId });
    }
  }
  const report = read(join(dir, "pub_hours_london.json"));
  const rows = [...verified.values()];
  if (!rows.length || !Array.isArray(report.rows)) throw new Error("Verified ledger and hours verdict report required");
  const inputHash = createHash("sha256").update(JSON.stringify({ rows, report: report.rows })).digest("hex");
  const { previous, plan, pending, budget } = currentPush(rows, report.rows, inputHash, refresh);
  const token = live || usage ? accessToken() : null;
  const monthUsage = token ? await monthPlacesRequests(token) : null;
  const preview = { mode: live ? "live" : "dry-run", push: refresh ? "refresh" : "resume", verified: rows.length, priorityUnknown: report.rows.filter((row) => row.verdict === "unknown").length,
    priorityMismatch: report.rows.filter((row) => row.verdict === "mismatch").length, pending: pending.length,
    plannedCalls: budget.rows.length, projectedUsd: budget.projectedUsd, priorReservedUsd: previous.attempts * 0.02,
    earlierPushesReservedUsd: previous.priorAttempts * 0.02,
    omittedForBudget: plan.omittedForBudget + budget.omittedForBudget, capUsd: CAP_USD, monthToDatePlacesRequests: monthUsage, fieldMask: MASK };
  console.log(JSON.stringify(preview));
  if (!live || (!budget.rows.length && previous.quotaRestored !== false)) return;
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (budget.rows.length && !key) throw new Error("GOOGLE_PLACES_API_KEY required for live copy");
  const searchBefore = previous.quotaBefore && !previous.quotaRestored
    ? previous.quotaBefore.search : await dailyOverrideValue(token, SEARCH_METRIC);
  const detailsBefore = previous.quotaBefore && !previous.quotaRestored
    ? previous.quotaBefore.details : await dailyOverrideValue(token, DETAILS_METRIC);
  previous.quotaBefore = { search: searchBefore, details: detailsBefore };
  previous.quotaRestored = false;
  write(CHECKPOINT, previous);
  let restoreNeeded = true;
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const save = () => {
    write(CHECKPOINT, previous);
    const venues = Object.values(previous.completed);
    write(OUT, { version: 1, inputHash, observedAt: venues.map(placesRecordObservedAt).filter(Boolean).sort()[0] ?? null,
    spend: { capUsd: CAP_USD, attemptedCalls: previous.attempts, usdPerThousand: 20, reservedUsd: previous.attempts * 2 / 100,
      priorAttemptedCalls: previous.priorAttempts, priorReservedUsd: previous.priorAttempts * 2 / 100, runStartedAt: previous.runStartedAt,
      monthToDatePlacesRequestsBeforeRun: monthUsage, freeAllowanceAssumed: 0 },
    priority: { unknown: preview.priorityUnknown, mismatch: preview.priorityMismatch },
    summary: { venues: venues.length, hours: venues.filter((row) => row.regularOpeningHours).length,
      addresses: venues.filter((row) => row.formattedAddress).length, phones: venues.filter((row) => row.nationalPhoneNumber).length,
      websites: venues.filter((row) => row.websiteUri).length, errors: previous.errors.length }, errors: previous.errors, venues });
  };
  const restore = async () => {
    if (!restoreNeeded) return;
    const restored = await restoreQuotasUntilVerified({ attempts: 3, expectedSearch: String(searchBefore), expectedDetails: String(detailsBefore),
      attempt: async () => {
        const fresh = accessToken();
        await setDailyOverrides(fresh, searchBefore, detailsBefore);
        return { search: String(await effectiveDailyLimit(fresh, SEARCH_METRIC)), details: String(await effectiveDailyLimit(fresh, DETAILS_METRIC)) };
      } });
    restoreNeeded = false;
    previous.quotaRestored = true;
    write(CHECKPOINT, previous);
    console.log(JSON.stringify({ quotasRestored: restored }));
  };
  try {
    if (budget.rows.length) await setDailyOverrides(token, searchBefore, Math.max(Number(detailsBefore), monthUsage + budget.rows.length + 100));
    for (const row of budget.rows) {
      if (interrupted) break;
      if ((previous.attempts + 1) * 2 > CAP_USD * 100) break;
      previous.attempts += 1;
      write(CHECKPOINT, previous);
      const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(row.googlePlaceId)}`, {
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": MASK }, signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        previous.errors.push({ venueId: row.venueId, status: response.status, observedAt: new Date().toISOString() });
        save();
        throw new Error(`Places request failed HTTP ${response.status}; reserved attempt counted, response content not logged`);
      }
      const body = await response.json();
      previous.completed[row.venueId] = placesEnrichmentRecord(row.venueId, row.googlePlaceId, body, new Date().toISOString());
      if (previous.attempts % 10 === 0) { save(); console.log(JSON.stringify({ attemptedCalls: previous.attempts, reservedUsd: previous.attempts * 2 / 100 })); }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } finally {
    try { save(); } finally {
      await restore();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  }
  if (interrupted) throw new Error("Interrupted; checkpoint saved and quotas restored");
  console.log(JSON.stringify({ completed: Object.keys(previous.completed).length, attemptedCalls: previous.attempts, reservedUsd: previous.attempts * 2 / 100 }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
