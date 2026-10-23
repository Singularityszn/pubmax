#!/usr/bin/env node
// Generate copy from stored pub fields. No page, Places or search request is made.
// Default is a dry run. --generate spends the printed budget through Vertex AI.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { FLASH_LITE_SKU, spendFromTokenCounts } from "../lib/harvest/pubWebsiteAmenities.ts";
import { copyFactsForVenue, validateVenueRecordCopy, validateVenueRecordCopyDraft } from "../lib/venueRecordCopy.ts";
import { VENUE_RECORD_COPY_TRACING_INCLUDE } from "../lib/venueRecordCopyFile.mjs";
import { groupVenuePrices } from "../lib/venues.ts";

import { GROUNDING_VERSION, JUDGE_SKU, JUDGE_BATCH_SIZE, JUDGE_THINKING_TOKENS, judgeOutputTokens, JUDGE_PROMPT, judgeText, judgeResults, judgeSchema, scoreJudgeProbe } from "./lib/pubCopyGrounding.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
// Each run may spend at most this much, projected and metered. Lifetime spend
// is reported beside it and never reset.
const RUN_CAP_USD = 15;
const BATCH_SIZE = 10;
const OUTPUT_TOKENS = 4096;
const INSUFFICIENT = "insufficient-stored-facts";
const INVALID = "invalid-copy-after-retry";
// Quota responses on the global endpoint for this long move the run to one region.
const QUOTA_FALLBACK_MS = 15 * 60 * 1000;
const FALLBACK_LOCATION = "europe-west2";
const PROMPT = [
  "Write one short description and choose vibe tags for each London pub using ONLY its supplied stored facts.",
  "Return JSON {rows:[{venueId:string,description:string,vibeTags:string[]}]}, one row per supplied venue.",
  "description: natural prose in your own words, one or two sentences, 20 to 180 characters, ending with a full stop.",
  "Write like a Londoner telling a mate: dry, direct and grammatical, never salesy.",
  "Vary the opening from venue to venue: lead with a fact, a question or \"you\", and do not start every description with \"This\".",
  "The pub is what the sentence is about. Never open with the borough or London. Naming the borough is optional; use it in at most half the descriptions, and only after the pub, never as the subject.",
  "Mention only the venue's supplied facts, each at most once, with a verb that fits. The pub has, does, serves, pours, hosts or runs things; people catch live music, play darts or pool, sing karaoke and get cocktails. The pub itself never catches, plays, sings or gets anything.",
  "Never mention any other feature: no food, beer gardens, sport, screens, drinks brands, music genres, games, rooms or events.",
  "Never deny a feature or say it has changed, and make no claim about mood, quality, reputation, age, history, crowd, prices, deals, amounts or when or how often anything happens.",
  "Put no adjective, number or price before a feature and no verdict after it: write \"cocktails\" or \"a pool table\", never \"strong cocktails\" or \"two pool tables\". Do not tie one feature to another.",
  "Name no person, brand, street or place except the supplied borough and London. No digits or exclamation marks.",
  "vibeTags: one to three of the venue's facts, copied exactly, most distinctive first.",
  "No external knowledge, Google Places, tools or web searches.",
  "VENUES:",
].join("\n");

function options() {
  const opts = { generate: false, check: false, evaluateJudge: false,
    dataset: path.join(ROOT, "public/data/pint_prices_app_dataset.json"),
    out: path.join(ROOT, VENUE_RECORD_COPY_TRACING_INCLUDE),
    checkpoint: path.join(ROOT, "data-harvest/pub-record-copy/checkpoint.json") };
  const values = { "--dataset": "dataset", "--out": "out", "--checkpoint": "checkpoint" };
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === "--evaluate-judge") opts.evaluateJudge = true;
    else if (flag === "--generate") opts.generate = true;
    else if (flag === "--check") opts.check = true;
    else if (values[flag]) {
      const value = process.argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
      opts[values[flag]] = path.resolve(value);
    } else throw new Error(`unknown argument ${flag}`);
  }
  if (opts.check && opts.generate) throw new Error("--check cannot generate");
  return opts;
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT" && fallback !== undefined) return fallback; throw error; }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const cost = (inputTokens, outputTokens, sku = FLASH_LITE_SKU) => spendFromTokenCounts({ inputTokens, outputTokens,
  inputUsdPerMillion: sku.inputUsdPerMillion, outputUsdPerMillion: sku.outputUsdPerMillion });
const textFor = (batch) => `${PROMPT}\n${JSON.stringify(batch.map(({ venueId, borough, supportedTags }) =>
  ({ venueId, borough, facts: supportedTags })))}`;
// One UTF-8 byte per input token is deliberately conservative, with framing room.
const reserveText = (text, sku = FLASH_LITE_SKU, outputTokens = OUTPUT_TOKENS) => cost(Buffer.byteLength(text, "utf8") + 4096, outputTokens, sku);
const reserveFor = (batch) => reserveText(textFor(batch));
const judgeReserveFor = (batch) => reserveText(judgeText(batch.map((fact) => ({ ...fact,
  description: "X".repeat(180), vibeTags: fact.supportedTags.slice(0, 3) }))), JUDGE_SKU, judgeOutputTokens(batch.length) + JUDGE_THINKING_TOKENS);
const inputHashFor = (fact) => hash(JSON.stringify({ fact, groundingVersion: GROUNDING_VERSION }));

function checkPublishedCopy(facts, out) {
  const pack = readJson(out);
  if (pack.version !== 2 || pack.model !== FLASH_LITE_SKU.model) throw new Error("invalid copy pack");
  const entries = pack.venues;
  const skipped = pack.skipped ?? {};
  if (!entries || typeof entries !== "object" || Object.keys(entries).length + Object.keys(skipped).length !== facts.length)
    throw new Error("copy coverage differs from the stored pub dataset");
  for (const fact of facts) {
    if (entries[fact.venueId]) {
      if (!validateVenueRecordCopy(fact, entries[fact.venueId])) throw new Error(`ungrounded copy for ${fact.venueId}`);
      if (skipped[fact.venueId]) throw new Error("duplicate copy status");
    } else if (skipped[fact.venueId]?.reason !== (fact.supportedTags.length ? INVALID : INSUFFICIENT)) {
      throw new Error(`undocumented missing copy for ${fact.venueId}`);
    }
  }
  console.log(JSON.stringify({ checkedVenues: Object.keys(entries).length, skippedVenues: Object.keys(skipped).length, actualSpendUsd: pack.actualSpendUsd }));
}

function loadSpendCheckpoint(file, out) {
  // A fresh checkpoint continues the lifetime spend, entries and skips the
  // published pack records, and starts a new run. A resumed checkpoint keeps its
  // unfinished run's spend.
  const published = readJson(out, null);
  const entries = Object.fromEntries(Object.values(published?.venues ?? {}).map(({ venueId, borough, supportedTags, ...copy }) =>
    [venueId, { venueId, borough, supportedTags, ...copy, inputHash: inputHashFor({ venueId, borough, supportedTags }) }]));
  const checkpoint = readJson(file, { version: 1, actualSpendUsd: published?.actualSpendUsd ?? 0, runSpendUsd: 0,
    reservedUsd: 0, requests: published?.requests ?? 0, entries, skipped: published?.skipped ?? {} });
  checkpoint.runSpendUsd ??= 0;
  if (checkpoint.version !== 1 || !checkpoint.entries ||
      ![checkpoint.actualSpendUsd, checkpoint.runSpendUsd, checkpoint.reservedUsd].every((n) => Number.isFinite(n) && n >= 0) ||
      !Number.isSafeInteger(checkpoint.requests) || checkpoint.requests < 0) throw new Error("invalid spend checkpoint");
  checkpoint.actualSpendUsd = Math.max(checkpoint.actualSpendUsd, published?.actualSpendUsd ?? 0);
  checkpoint.requests = Math.max(checkpoint.requests, published?.requests ?? 0);
  checkpoint.skipped ??= {};
  for (const [venueId, publishedEntry] of Object.entries(entries)) {
    const fact = { venueId, borough: publishedEntry.borough, supportedTags: publishedEntry.supportedTags };
    if (!validateVenueRecordCopy(fact, publishedEntry)) continue;
    const existing = checkpoint.entries[venueId];
    // Preserve newer interrupted work, but recover published copy over a stale
    // missing or invalid entry and its same-input skip.
    if (!existing || !validateVenueRecordCopy(existing, existing)) {
      checkpoint.entries[venueId] = publishedEntry;
      if (checkpoint.skipped[venueId]?.inputHash === publishedEntry.inputHash)
        delete checkpoint.skipped[venueId];
    }
  }
  for (const [venueId, skipped] of Object.entries(published?.skipped ?? {})) {
    if (!checkpoint.entries[venueId] && !checkpoint.skipped[venueId]) checkpoint.skipped[venueId] = skipped;
  }
  return checkpoint;
}

function settleUsage(checkpoint, body, reserve, sku) {
  const usage = body?.usageMetadata;
  const input = usage?.promptTokenCount;
  const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const metered = Number.isSafeInteger(input) && input >= 0 &&
    Number.isSafeInteger(usage?.candidatesTokenCount) && usage.candidatesTokenCount >= 0 &&
    Number.isSafeInteger(output) && output >= 0;
  if (metered) {
    const spend = cost(input, output, sku);
    checkpoint.actualSpendUsd += spend;
    checkpoint.runSpendUsd += spend;
    checkpoint.reservedUsd = Math.max(0, checkpoint.reservedUsd - reserve);
  }

  if (!metered) throw new Error("missing model usage; spend reservation retained, no venue copy published");
}

function copyFrom(body, batch) {
  const candidate = body.candidates?.[0];
  let rows;
  try {
    rows = JSON.parse(candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "").rows;
  } catch { rows = null; }
  const complete = candidate?.finishReason === "STOP" && Array.isArray(rows);
  const normalized = [];
  for (const fact of batch) {
    const matching = complete ? rows.filter((row) => row?.venueId === fact.venueId) : [];
    const copy = matching.length === 1 ? validateVenueRecordCopyDraft(fact, matching[0]) : null;
    if (copy) normalized.push({ ...fact, ...copy });
  }
  return normalized;
}

function reportQuotaFailure(body, location) {
  const quota = {};
  for (const detail of body?.error?.details ?? []) {
    for (const key of ["quota_metric", "quota_limit", "quota_location", "quota_limit_value", "service"]) {
      const value = detail?.metadata?.[key];
      if (typeof value === "string" && /^[a-zA-Z0-9_./:-]{1,300}$/.test(value)) quota[key] = value;
    }
  }
  console.error(JSON.stringify({ httpStatus: 429, model: FLASH_LITE_SKU.model, region: location,
    quota: Object.keys(quota).length ? quota : "not reported by provider" }));
}

async function evaluateJudge(probes, requestBatch, checkpoint) {
  const results = [];
  for (let i = 0; i < probes.length; i += JUDGE_BATCH_SIZE) {
    const batch = probes.slice(i, i + JUDGE_BATCH_SIZE);
    const body = await requestBatch(batch, true);
    // Evaluate the actual judge's verdict independently of deterministic draft heuristics.
    const candidate = body.candidates?.[0];
    let rows;
    try { rows = JSON.parse(candidate?.content?.parts?.map((part) => part.text ?? "").join("")).rows; } catch { rows = []; }
    for (const probe of batch) {
      const matches = Array.isArray(rows) ? rows.filter((row) => row.venueId === probe.venueId) : [];
      const row = matches.length === 1 ? matches[0] : null;
      const passed = scoreJudgeProbe(probe, row, candidate?.finishReason === "STOP");
      results.push({ venueId: probe.venueId, description: probe.description, expected: probe.expected, scoring: probe.scoring ?? "judge-and-quoted-phrase", passed, response: row });
    }
  }
  writeJson(path.join(ROOT, "docs/proof/pub-record-copy/judge-evaluation.json"), {
    evaluatedAt: new Date().toISOString(), model: JUDGE_SKU.model, groundingVersion: GROUNDING_VERSION,
    actualSpendUsd: checkpoint.actualSpendUsd, passed: results.filter((row) => row.passed).length, total: results.length, results });
  console.log(JSON.stringify({ judgeEvaluationPassed: results.filter((row) => row.passed).length, total: results.length,
    actualSpendUsd: checkpoint.actualSpendUsd }));
  if (results.some((row) => !row.passed)) throw new Error("grounding judge regression evaluation failed; no copy published");
}

/** A run ends only when it completes; an interrupted run resumes with its spend. */
function endRun(checkpoint, file) {
  if (checkpoint.reservedUsd > 0.000000001) throw new Error("unresolved spend reservations; run remains unfinished");
  checkpoint.runSpendUsd = 0;
  writeJson(file, checkpoint);
}

async function main() {
  const opts = options();
  const raw = readFileSync(opts.dataset, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length === 0) throw new Error("expected a non-empty stored venue dataset");
  const facts = groupVenuePrices(data).map(copyFactsForVenue).filter(Boolean)
    .sort((a, b) => a.venueId.localeCompare(b.venueId));
  if (!facts.length) throw new Error("no pub records to generate");
  if (opts.check) {
    checkPublishedCopy(facts, opts.out);
    return;
  }
  const checkpoint = loadSpendCheckpoint(opts.checkpoint, opts.out);
  // Unknown outcomes remain charged against this unfinished run until reconciled.
  const probes = opts.evaluateJudge ? readJson(path.join(ROOT, "scripts/fixtures/pubCopyJudgeProbes.json")) : [];
  const eligible = facts.filter((fact) => fact.supportedTags.length > 0);
  const pending = eligible.filter((fact) => {
    const entry = checkpoint.entries[fact.venueId];
    const inputHash = inputHashFor(fact);
    if (checkpoint.skipped[fact.venueId]?.inputHash === inputHash) return false;
    return entry?.inputHash !== inputHash || !validateVenueRecordCopy(fact, entry);
  });
  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE));
  // Allow HTTP retries for each batch and one single-pub grounding retry per pending pub.
  // Non-200 HTTP retries are unbilled. Count one draft and judge pass plus one
  // individual retry per pub; transport uncertainty retains its reservation.
  const judgeBatches = [];
  for (let i = 0; i < pending.length; i += JUDGE_BATCH_SIZE) judgeBatches.push(pending.slice(i, i + JUDGE_BATCH_SIZE));
  const evaluationBatches = [];
  for (let i = 0; i < probes.length; i += JUDGE_BATCH_SIZE) evaluationBatches.push(probes.slice(i, i + JUDGE_BATCH_SIZE));
  const projectedSpendUsd = checkpoint.runSpendUsd + checkpoint.reservedUsd + (opts.evaluateJudge ?
    evaluationBatches.reduce((sum, batch) => sum + judgeReserveFor(batch), 0) :
    batches.reduce((sum, batch) => sum + reserveFor(batch), 0) +
    judgeBatches.reduce((sum, batch) => sum + judgeReserveFor(batch), 0) +
    pending.reduce((sum, fact) => sum + reserveFor([fact]) + judgeReserveFor([fact]), 0));
  console.log(JSON.stringify({ model: FLASH_LITE_SKU.model, judgeModel: JUDGE_SKU.model, venues: facts.length, eligible: eligible.length,
    pending: pending.length, batches: batches.length, projectedSpendUsd, runCapUsd: RUN_CAP_USD, runSpendUsd: checkpoint.runSpendUsd,
    actualSpendUsd: checkpoint.actualSpendUsd, reservedUsd: checkpoint.reservedUsd, mode: opts.generate ? "generate" : "dry-run" }));
  if (projectedSpendUsd > RUN_CAP_USD) throw new Error("projected spend exceeds run cap; no model call made");
  if (!opts.generate) return;
  let token = "";
  let tokenAt = 0;
  let nextCallAt = 0;
  let pacingMs = 3_000;
  let location = "global";
  let quotaSince = null;
  const startedAt = new Date().toISOString();
  async function requestBatch(batch, judging = false) {
    const text = judging ? judgeText(batch).slice(JUDGE_PROMPT.length - "DRAFTS:\n".length) : textFor(batch);
    let retries = 0;
    for (;;) {
      if (!token || Date.now() - tokenAt > 20 * 60 * 1000) {
        token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        tokenAt = Date.now();
        if (!token) throw new Error("gcloud authentication unavailable");
      }
      const sku = judging ? JUDGE_SKU : FLASH_LITE_SKU;
      const maxOutputTokens = judging ? judgeOutputTokens(batch.length) : OUTPUT_TOKENS;
      const reserve = reserveText((judging ? JUDGE_PROMPT : "") + text, sku, maxOutputTokens + (judging ? JUDGE_THINKING_TOKENS : 0));
      if (checkpoint.runSpendUsd + checkpoint.reservedUsd + reserve > RUN_CAP_USD) throw new Error("run spend cap reached");
      if (Date.now() < nextCallAt) await new Promise((resolve) => setTimeout(resolve, nextCallAt - Date.now()));
      nextCallAt = Date.now() + pacingMs;
      // Reserve durably BEFORE sending. An interrupted/unknown response keeps its reservation.
      checkpoint.reservedUsd += reserve;
      checkpoint.requests++;
      writeJson(opts.checkpoint, checkpoint);
      let response;
      let body;
      try {
        const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
        response = await fetch(`https://${host}/v1/projects/pubmaxx/locations/${location}/publishers/google/models/${sku.model}:generateContent`, {
          method: "POST", signal: AbortSignal.timeout(90_000),
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...(judging ? {systemInstruction: {parts: [{text: JUDGE_PROMPT}]}} : {}),
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { temperature: judging ? 0 : 0.7, maxOutputTokens,
              thinkingConfig: { thinkingBudget: judging ? JUDGE_THINKING_TOKENS : 0 }, responseMimeType: "application/json",
              responseSchema: judging ? judgeSchema(batch.map((fact) => fact.venueId)) : { type: "OBJECT", required: ["rows"], properties: {
                rows: { type: "ARRAY", minItems: batch.length, maxItems: batch.length, items: { type: "OBJECT", required: ["venueId", "description", "vibeTags"], properties: {
                  venueId: { type: "STRING", enum: batch.map((fact) => fact.venueId) },
                  description: { type: "STRING" },
                  vibeTags: { type: "ARRAY", minItems: 1, maxItems: 3, items: { type: "STRING", enum: [...new Set(batch.flatMap((fact) => fact.supportedTags))] } },
                } } },
              } },
            },
          }),
        });
        body = response.ok ? await response.json() : await response.json().catch(() => null);
      } catch {
        throw new Error("model response unavailable; worst-case spend reservation retained, resume from checkpoint");
      }

      if (!response.ok) {
        // Vertex does not bill non-200 responses. Never log provider error bodies.
        checkpoint.reservedUsd = Math.max(0, checkpoint.reservedUsd - reserve);
        writeJson(opts.checkpoint, checkpoint);
        if (response.status === 401) token = "";
        if (response.status === 429) {
          pacingMs = Math.min(60_000, pacingMs * 2);
          nextCallAt = Date.now() + pacingMs;
          quotaSince ??= Date.now();
          if (Date.now() - quotaSince <= QUOTA_FALLBACK_MS) continue;
          if (location === "global") {
            location = FALLBACK_LOCATION;
            quotaSince = Date.now();
            console.log(JSON.stringify({ quotaFallbackLocation: location }));
            continue;
          }
          reportQuotaFailure(body, location);
        } else if ([401, 503].includes(response.status) && retries < 2) {
          retries++;
          await new Promise((resolve) => setTimeout(resolve, 30_000 * retries));
          continue;
        }
        const quota = /quota/i.test(body?.error?.message ?? "") ? " quota exhausted" : "";
        throw new Error(`Gemini HTTP ${response.status}${quota}; no venue copy published`);
      }
      quotaSince = null;
      pacingMs = Math.max(3_000, Math.floor(pacingMs * 0.8));
      settleUsage(checkpoint, body, reserve, sku);
      writeJson(opts.checkpoint, checkpoint);
      return body;
    }
  }
  if (opts.evaluateJudge) {
    await evaluateJudge(probes, requestBatch, checkpoint);
    endRun(checkpoint, opts.checkpoint);
    return;
  }
  function retain(fact, entry) {
    const inputHash = inputHashFor(fact);
    if (entry) {
      checkpoint.entries[fact.venueId] = { ...entry, inputHash };
      delete checkpoint.skipped[fact.venueId];
    } else {
      delete checkpoint.entries[fact.venueId];
      checkpoint.skipped[fact.venueId] = { inputHash, reason: INVALID };
    }
    writeJson(opts.checkpoint, checkpoint);
  }
  for (const [batchIndex, batch] of batches.entries()) {
    const drafts = copyFrom(await requestBatch(batch), batch);
    const normalized = [];
    for (let i = 0; i < drafts.length; i += JUDGE_BATCH_SIZE) {
      const judgeBatch = drafts.slice(i, i + JUDGE_BATCH_SIZE);
      normalized.push(...judgeResults(await requestBatch(judgeBatch, true), judgeBatch));
    }
    const failed = [];
    for (const fact of batch) {
      const entry = normalized.find((row) => row.venueId === fact.venueId);
      if (entry) retain(fact, entry);
      else failed.push(fact);
    }
    for (const fact of failed) {
      const retryDrafts = copyFrom(await requestBatch([fact]), [fact]);
      const retried = retryDrafts.length ? judgeResults(await requestBatch(retryDrafts, true), retryDrafts) : [];
      retain(fact, retried[0]);
    }
    if ((batchIndex + 1) % 10 === 0 || batchIndex === batches.length - 1)
      console.log(JSON.stringify({ completedBatches: batchIndex + 1, totalBatches: batches.length, actualSpendUsd: checkpoint.actualSpendUsd }));
  }
  if (checkpoint.reservedUsd > 0.000000001) throw new Error("unresolved spend reservations; copy retained in checkpoint, publication refused");
  const venues = Object.fromEntries(eligible.filter((fact) => !checkpoint.skipped[fact.venueId]).map((fact) => {
    const { venueId, borough, supportedTags, description, vibeTags, grounding } = checkpoint.entries[fact.venueId];
    return [venueId, { venueId, borough, supportedTags, description, vibeTags, grounding }];
  }));
  writeJson(opts.out, { version: 2, model: FLASH_LITE_SKU.model, generatedAt: new Date().toISOString(),
    startedAt, sourceDataset: "public/data/pint_prices_app_dataset.json", sourceDatasetSha256: hash(raw),
    groundingVersion: GROUNDING_VERSION, judgePricing: JUDGE_SKU, pricing: FLASH_LITE_SKU, runCapUsd: RUN_CAP_USD, projectedSpendUsd,
    runSpendUsd: checkpoint.runSpendUsd, actualSpendUsd: checkpoint.actualSpendUsd, requests: checkpoint.requests, venues,
    skipped: Object.fromEntries(facts.filter((fact) => !venues[fact.venueId]).map((fact) =>
      [fact.venueId, fact.supportedTags.length ? checkpoint.skipped[fact.venueId] : { reason: INSUFFICIENT }])) });
  console.log(JSON.stringify({ publishedVenues: Object.keys(venues).length, skippedVenues: facts.length - Object.keys(venues).length,
    runSpendUsd: checkpoint.runSpendUsd, actualSpendUsd: checkpoint.actualSpendUsd, requests: checkpoint.requests }));
  endRun(checkpoint, opts.checkpoint);
}


main().catch((error) => { console.error(error.message); process.exitCode = 1; });
