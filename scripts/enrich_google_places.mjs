#!/usr/bin/env node
/** Copy four venue fields from verified Places ids. Dry run is default. */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PLACES_REFRESH_DAYS, placesEnrichmentRecord, planPlacesEnrichment } from "../lib/placesEnrichment.ts";
import { restoreQuotasUntilVerified } from "../lib/placesVerification.ts";
import { accessToken, dailyOverrideValue, effectiveDailyLimit, setDailyOverrides,
  monthPlacesRequests, SEARCH_METRIC, DETAILS_METRIC } from "./lib/googlePlacesQuota.mjs";
import { PLACES_ENRICHMENT_STAMP, placesEnrichmentStamp } from "./lib/placesEnrichmentStamp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/places_enrichment.json");
const CHECKPOINT = join(ROOT, "data/places_verification/enrichment_progress.json");
const CAP_USD = 85;
const REFRESH_MS = PLACES_REFRESH_DAYS * 86_400_000;
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
  const checkpoint = existsSync(CHECKPOINT) ? read(CHECKPOINT) : null;
  const pack = existsSync(OUT) ? read(OUT) : null;
  const committed = pack && { inputHash: pack.inputHash, attempts: pack.spend.attemptedCalls, month: pack.spend.month, monthAttempts: pack.spend.monthAttemptedCalls,
    runStartedAt: pack.spend.runStartedAt, completed: Object.fromEntries(pack.venues.map((row) => [row.venueId, row])), errors: pack.errors };
  const total = (ledger) => ledger ? ledger.attempts : -1;
  if (total(checkpoint) > total(committed)) return checkpoint;
  return committed && checkpoint ? { ...committed, quotaBefore: checkpoint.quotaBefore, quotaRestored: checkpoint.quotaRestored } : committed;
}

/** An error belongs to the current push when no refresh has started one or it is dated after that start. */
const inPush = (ledger, observedAt) => !ledger.runStartedAt || Date.parse(observedAt) >= Date.parse(ledger.runStartedAt);

/** A missing place, or a bad request that is not about the key, fails only its row; anything else stops the run. */
async function placeLevelFailure(response) {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = await response.json().catch(() => null);
  const reasons = Array.isArray(body?.error?.details) ? body.error.details.map((detail) => String(detail?.reason ?? "")) : [];
  return body?.error?.status === "INVALID_ARGUMENT" && !reasons.some((reason) => reason.startsWith("API_KEY"));
}

/** Count each paid attempt against the UTC calendar month it is reserved in. */
function rollMonth(ledger) {
  const month = new Date().toISOString().slice(0, 7);
  if (ledger.month !== month) Object.assign(ledger, { month, monthAttempts: 0 });
  return ledger;
}

/** Resume the current push, or with --refresh start a new one once a copied field is past its refresh window. The cap spans every push in a calendar month. */
function currentPush(rows, reportRows, inputHash, refresh) {
  let previous = rollMonth(priorLedger() ?? { inputHash, attempts: 0, month: null, monthAttempts: 0, runStartedAt: null, completed: {}, errors: [] });
  const plan = planPlacesEnrichment(rows, reportRows, CAP_USD, 0);
  const pendingIn = (ledger) => {
    const failed = new Set(ledger.errors.filter((row) => inPush(ledger, row.observedAt)).map((row) => row.venueId));
    return plan.rows.filter((row) => {
      const record = ledger.completed[row.venueId];
      if (failed.has(row.venueId)) return false;
      return !record || (Boolean(ledger.runStartedAt) && Date.parse(record.observedAt) < Date.parse(ledger.runStartedAt) - REFRESH_MS);
    });
  };
  const budgetFor = (ledger) => planPlacesEnrichment(pendingIn(ledger), reportRows, CAP_USD, ledger.monthAttempts * 0.02);
  if (refresh) {
    const oldest = Object.values(previous.completed).map((record) => record.observedAt).sort()[0];
    if (!oldest || Date.now() - Date.parse(oldest) <= REFRESH_MS)
      throw new Error(`No copied field is older than ${PLACES_REFRESH_DAYS} days; nothing to refresh`);
    if (previous.inputHash === inputHash && budgetFor(previous).rows.length)
      throw new Error("The current push still has budgeted rows; resume it without --refresh");
    const verifiedIds = new Map(rows.map((row) => [row.venueId, row.googlePlaceId]));
    previous = { ...previous, inputHash, runStartedAt: new Date().toISOString(),
      completed: Object.fromEntries(Object.entries(previous.completed).filter(([venueId, record]) => verifiedIds.get(venueId) === record.googlePlaceId)) };
  } else if (previous.inputHash !== inputHash) throw new Error("Inputs changed; a resume needs the original inputs, and a new push needs a stale --refresh");
  return { previous, plan, pending: pendingIn(previous), budget: budgetFor(previous) };
}

async function main() {
  const { live, usage, refresh } = runOptions();
  const dir = join(ROOT, "data/places_verification");
  const rows = (read(join(dir, "london.json")).pubs ?? []).map((row) => ({ venueId: row.venueId, googlePlaceId: row.googlePlaceId }));
  const report = read(join(dir, "pub_hours_london.json"));
  if (!rows.length || !Array.isArray(report.rows)) throw new Error("Verified ledger and hours verdict report required");
  const inputHash = createHash("sha256").update(JSON.stringify({ rows, report: report.rows })).digest("hex");
  const { previous, plan, pending, budget } = currentPush(rows, report.rows, inputHash, refresh);
  const token = live || usage ? accessToken() : null;
  const monthUsage = token ? await monthPlacesRequests(token) : null;
  const preview = { mode: live ? "live" : "dry-run", push: refresh ? "refresh" : "resume", verified: rows.length, priorityUnknown: report.rows.filter((row) => row.verdict === "unknown").length,
    priorityMismatch: report.rows.filter((row) => row.verdict === "mismatch").length, pending: pending.length,
    plannedCalls: budget.rows.length, projectedUsd: budget.projectedUsd, month: previous.month,
    monthReservedUsd: previous.monthAttempts * 0.02, totalReservedUsd: previous.attempts * 0.02,
    failedRows: previous.errors.filter((row) => inPush(previous, row.observedAt)),
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
    const pack = { version: 1, inputHash, observedAt: venues.map((row) => row.observedAt).sort()[0] ?? null,
    spend: { capUsd: CAP_USD, attemptedCalls: previous.attempts, usdPerThousand: 20, reservedUsd: previous.attempts * 2 / 100,
      month: previous.month, monthAttemptedCalls: previous.monthAttempts, monthReservedUsd: previous.monthAttempts * 2 / 100, runStartedAt: previous.runStartedAt,
      monthToDatePlacesRequestsBeforeRun: monthUsage, freeAllowanceAssumed: 0 },
    priority: { unknown: preview.priorityUnknown, mismatch: preview.priorityMismatch },
    summary: { venues: venues.length, hours: venues.filter((row) => row.regularOpeningHours).length,
      addresses: venues.filter((row) => row.formattedAddress).length, phones: venues.filter((row) => row.nationalPhoneNumber).length,
      websites: venues.filter((row) => row.websiteUri).length, errors: previous.errors.length }, errors: previous.errors, venues };
    write(OUT, pack);
    write(join(ROOT, PLACES_ENRICHMENT_STAMP), placesEnrichmentStamp(pack));
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
      if ((rollMonth(previous).monthAttempts + 1) * 2 > CAP_USD * 100) break;
      previous.attempts += 1;
      previous.monthAttempts += 1;
      write(CHECKPOINT, previous);
      const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(row.googlePlaceId)}`, {
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": MASK }, signal: AbortSignal.timeout(20_000),
      });
      const observedAt = new Date().toISOString();
      if (response.ok) previous.completed[row.venueId] = placesEnrichmentRecord(row.venueId, row.googlePlaceId, await response.json(), observedAt);
      else if (await placeLevelFailure(response)) previous.errors.push({ venueId: row.venueId, status: response.status, observedAt });
      else throw new Error(`Places request failed HTTP ${response.status}; run stopped, reserved attempt counted and row left pending, response content not logged`);
      if (previous.attempts % 10 === 0) { save(); console.log(JSON.stringify({ attemptedCalls: previous.attempts, monthReservedUsd: previous.monthAttempts * 2 / 100 })); }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } finally {
    try { save(); } finally {
      await restore();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      console.log(JSON.stringify({ completed: Object.keys(previous.completed).length, attemptedCalls: previous.attempts,
        monthReservedUsd: previous.monthAttempts * 2 / 100, failedRows: previous.errors.filter((row) => inPush(previous, row.observedAt)) }));
    }
  }
  if (interrupted) throw new Error("Interrupted; checkpoint saved and quotas restored");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
