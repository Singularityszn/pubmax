#!/usr/bin/env node
// Generate copy from stored pub fields. No page, Places or search request is made.
// Default is a dry run. --generate spends the printed budget through Vertex AI.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { FLASH_LITE_SKU, spendFromTokenCounts } from "../lib/harvest/pubWebsiteAmenities.ts";
import { copyChoicesForVenue, validateVenueRecordCopy } from "../lib/venueRecordCopy.ts";
import { VENUE_RECORD_COPY_TRACING_INCLUDE } from "../lib/venueRecordCopyFile.mjs";
import { groupVenuePrices } from "../lib/venues.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const JOB_CAP_USD = 15;
const BATCH_SIZE = 10;
const OUTPUT_TOKENS = 4096;
const PROMPT = [
  "Write short pub descriptions and select up to three vibe tags using ONLY the supplied stored facts.",
  "Return JSON {rows:[{venueId:string,sentenceIndexes:number[],tagIndexes:number[]}]}, one row per supplied venue.",
  "Select offered sentences and tags by their zero-based array indexes. Never return text.",
  "sentenceIndexes must start with 0, followed by up to two other distinct offered sentence indexes.",
  "Select between one and three distinct tag indexes. Do not add, edit, combine or invent any fact.",
  "Pick the most distinctive supported amenities. Prefer specific tags over Pub when available.",
  "For a sparse record, return sentenceIndexes [0] and tagIndexes [0]. Never infer atmosphere from a name.",
  "No external knowledge, Google Places, tools, web searches, prices, hours or claims about clientele.",
  "VENUES:",
].join("\n");

function options() {
  const opts = { generate: false, check: false, dryRun: false, limit: Infinity, cap: JOB_CAP_USD,
    dataset: path.join(ROOT, "public/data/pint_prices_app_dataset.json"),
    out: path.join(ROOT, VENUE_RECORD_COPY_TRACING_INCLUDE),
    checkpoint: path.join(ROOT, "data-harvest/pub-record-copy/checkpoint.json") };
  const values = { "--dataset": "dataset", "--out": "out", "--checkpoint": "checkpoint", "--limit": "limit", "--cap-usd": "cap" };
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === "--generate") opts.generate = true;
    else if (flag === "--check") opts.check = true;
    else if (flag === "--dry-run") opts.dryRun = true;
    else if (values[flag]) {
      const value = process.argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
      opts[values[flag]] = ["limit", "cap"].includes(values[flag]) ? Number(value) : path.resolve(value);
    } else throw new Error(`unknown argument ${flag}`);
  }
  if (opts.limit !== Infinity && (!Number.isSafeInteger(opts.limit) || opts.limit < 1)) throw new Error("--limit must be a positive integer");
  if (!Number.isFinite(opts.cap) || opts.cap <= 0 || opts.cap > JOB_CAP_USD) throw new Error("--cap-usd must be positive and at most 15");
  if (opts.check && opts.generate) throw new Error("--check cannot generate");
  if (opts.dryRun && opts.generate) throw new Error("--dry-run cannot generate");
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
const cost = (inputTokens, outputTokens) => spendFromTokenCounts({ inputTokens, outputTokens,
  inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion, outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion });
const textFor = (batch) => `${PROMPT}\n${JSON.stringify(batch)}`;
// One UTF-8 byte per input token is deliberately conservative, with framing room.
const reserveFor = (batch) => cost(Buffer.byteLength(textFor(batch), "utf8") + 4096, OUTPUT_TOKENS);

function checkPublishedCopy(choices, out) {
  const pack = readJson(out);
  if (pack.version !== 1 || pack.model !== FLASH_LITE_SKU.model) throw new Error("invalid copy pack");
  const entries = pack.venues;
  if (!entries || typeof entries !== "object" || Object.keys(entries).length + Object.keys(pack.skipped ?? {}).length !== choices.length)
    throw new Error("copy coverage differs from the stored pub dataset");
  for (const choice of choices) {
    if (entries[choice.venueId]) {
      if (!validateVenueRecordCopy(choice, entries[choice.venueId])) throw new Error(`ungrounded copy for ${choice.venueId}`);
      if (pack.skipped?.[choice.venueId]) throw new Error("duplicate copy status");
    } else if (pack.skipped?.[choice.venueId]?.reason !== "invalid-selection-after-retry") {
      throw new Error(`undocumented missing copy for ${choice.venueId}`);
    }
  }
  console.log(JSON.stringify({ checkedVenues: Object.keys(entries).length, skippedVenues: Object.keys(pack.skipped ?? {}).length, actualSpendUsd: pack.actualSpendUsd }));
}

function loadSpendCheckpoint(file) {
  const checkpoint = readJson(file, { version: 1, actualSpendUsd: 0, reservedUsd: 0, requests: 0, entries: {} });
  if (checkpoint.version !== 1 || !checkpoint.entries ||
      ![checkpoint.actualSpendUsd, checkpoint.reservedUsd].every((n) => Number.isFinite(n) && n >= 0) ||
      !Number.isSafeInteger(checkpoint.requests) || checkpoint.requests < 0) throw new Error("invalid spend checkpoint");
  checkpoint.skipped ??= {};
  return checkpoint;
}

function settleUsage(checkpoint, body, reserve) {
  const usage = body?.usageMetadata;
  const input = usage?.promptTokenCount;
  const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const metered = Number.isSafeInteger(input) && input >= 0 &&
    Number.isSafeInteger(usage?.candidatesTokenCount) && usage.candidatesTokenCount >= 0 &&
    Number.isSafeInteger(output) && output >= 0;
  if (metered) {
    checkpoint.actualSpendUsd += cost(input, output);
    checkpoint.reservedUsd = Math.max(0, checkpoint.reservedUsd - reserve);
  }

  if (!metered) throw new Error("missing model usage; spend reservation retained, no venue copy published");
}

function selectionsFrom(body, batch) {
  const candidate = body.candidates?.[0];
  let rows;
  try {
    rows = JSON.parse(candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "").rows;
  } catch { rows = null; }
  const complete = candidate?.finishReason === "STOP" && Array.isArray(rows);
  const normalized = [];
  for (const choice of batch) {
    const matching = complete ? rows.filter((row) => row?.venueId === choice.venueId) : [];
    const entry = matching.length === 1 ? matching[0] : null;
    const indexes = (items, offered) => Array.isArray(items) && items.every((i) => Number.isSafeInteger(i) && i >= 0 && i < offered.length)
      ? items.map((i) => offered[i]) : null;
    const selection = { venueId: choice.venueId,
      sentences: indexes(entry?.sentenceIndexes, choice.sentences),
      vibeTags: indexes(entry?.tagIndexes, choice.vibeTags) };
    if (validateVenueRecordCopy(choice, selection)) normalized.push(selection);
  }
  return normalized;
}

function reportQuotaFailure(body) {
  const quota = {};
  for (const detail of body?.error?.details ?? []) {
    for (const key of ["quota_metric", "quota_limit", "quota_location", "quota_limit_value", "service"]) {
      const value = detail?.metadata?.[key];
      if (typeof value === "string" && /^[a-zA-Z0-9_./:-]{1,300}$/.test(value)) quota[key] = value;
    }
  }
  console.error(JSON.stringify({ httpStatus: 429, model: FLASH_LITE_SKU.model, region: "global",
    quota: Object.keys(quota).length ? quota : "not reported by provider" }));
}

async function main() {
  const opts = options();
  const raw = readFileSync(opts.dataset, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length === 0) throw new Error("expected a non-empty stored venue dataset");
  const choices = groupVenuePrices(data).map(copyChoicesForVenue).filter(Boolean)
    .sort((a, b) => a.venueId.localeCompare(b.venueId)).slice(0, opts.limit);
  if (!choices.length) throw new Error("no pub records to generate");
  if (opts.check) {
    checkPublishedCopy(choices, opts.out);
    return;
  }
  const checkpoint = loadSpendCheckpoint(opts.checkpoint);
  const pending = choices.filter((choice) => {
    const entry = checkpoint.entries[choice.venueId];
    const inputHash = hash(JSON.stringify(choice));
    if (checkpoint.skipped[choice.venueId]?.inputHash === inputHash) return false;
    return entry?.inputHash !== inputHash || !validateVenueRecordCopy(choice, entry);
  });
  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE));
  // Allow HTTP retries for each batch and one single-pub grounding retry per pending pub.
  const projectedSpendUsd = checkpoint.actualSpendUsd + checkpoint.reservedUsd +
    batches.reduce((sum, batch) => sum + reserveFor(batch) * 3, 0) +
    pending.reduce((sum, choice) => sum + reserveFor([choice]) * 3, 0);
  console.log(JSON.stringify({ model: FLASH_LITE_SKU.model, venues: choices.length, pending: pending.length,
    batches: batches.length, projectedSpendUsd, taskCapUsd: opts.cap, actualSpendUsd: checkpoint.actualSpendUsd,
    unresolvedReservedUsd: checkpoint.reservedUsd, mode: opts.generate ? "generate" : "dry-run" }));
  if (projectedSpendUsd > opts.cap) throw new Error("projected spend exceeds task cap; no model call made");
  if (!opts.generate) return;
  let token = "";
  let tokenAt = 0;
  let nextCallAt = 0;
  let pacingMs = 3_000;
  const startedAt = new Date().toISOString();
  async function requestBatch(batch) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!token || Date.now() - tokenAt > 20 * 60 * 1000) {
        token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        tokenAt = Date.now();
        if (!token) throw new Error("gcloud authentication unavailable");
      }
      const reserve = reserveFor(batch);
      if (checkpoint.actualSpendUsd + checkpoint.reservedUsd + reserve > opts.cap) throw new Error("spend cap reached");
      if (Date.now() < nextCallAt) await new Promise((resolve) => setTimeout(resolve, nextCallAt - Date.now()));
      nextCallAt = Date.now() + pacingMs;
      // Reserve durably BEFORE sending. An interrupted/unknown response keeps its reservation.
      checkpoint.reservedUsd += reserve;
      checkpoint.requests++;
      writeJson(opts.checkpoint, checkpoint);
      let response;
      let body;
      try {
        response = await fetch(`https://aiplatform.googleapis.com/v1/projects/pubmaxx/locations/global/publishers/google/models/${FLASH_LITE_SKU.model}:generateContent`, {
          method: "POST", signal: AbortSignal.timeout(90_000),
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: textFor(batch) }] }],
            generationConfig: { temperature: 0, maxOutputTokens: OUTPUT_TOKENS,
              thinkingConfig: { thinkingBudget: 0 }, responseMimeType: "application/json",
              responseSchema: { type: "OBJECT", required: ["rows"], properties: {
                rows: { type: "ARRAY", minItems: batch.length, maxItems: batch.length, items: { type: "OBJECT", required: ["venueId", "sentenceIndexes", "tagIndexes"], properties: {
                  venueId: { type: "STRING", enum: batch.map((choice) => choice.venueId) },
                  sentenceIndexes: { type: "ARRAY", minItems: 1, maxItems: 3, items: { type: "INTEGER", minimum: 0, maximum: 11 } },
                  tagIndexes: { type: "ARRAY", minItems: 1, maxItems: 3, items: { type: "INTEGER", minimum: 0, maximum: 11 } },
                } } },
              } },
            },
          }),
        });
        body = await response.json();
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
        }
        if ([401, 429, 503].includes(response.status) && attempt < 2) {
          if (response.status !== 429) await new Promise((resolve) => setTimeout(resolve, 30_000 * (attempt + 1)));
          continue;
        }
        if (response.status === 429) {
          reportQuotaFailure(body);
        }
        const quota = /quota/i.test(body?.error?.message ?? "") ? " quota exhausted" : "";
        throw new Error(`Gemini HTTP ${response.status}${quota}; no venue copy published`);
      }
      pacingMs = Math.max(3_000, Math.floor(pacingMs * 0.8));
      settleUsage(checkpoint, body, reserve);
      writeJson(opts.checkpoint, checkpoint);
      return body;
    }
    throw new Error("model request attempts exhausted");
  }
  function retain(choice, entry) {
    const inputHash = hash(JSON.stringify(choice));
    if (entry) {
      checkpoint.entries[choice.venueId] = { ...entry, inputHash };
      delete checkpoint.skipped[choice.venueId];
    } else {
      delete checkpoint.entries[choice.venueId];
      checkpoint.skipped[choice.venueId] = { inputHash, reason: "invalid-selection-after-retry" };
    }
    writeJson(opts.checkpoint, checkpoint);
  }
  for (const [batchIndex, batch] of batches.entries()) {
    const normalized = selectionsFrom(await requestBatch(batch), batch);
    const failed = [];
    for (const choice of batch) {
      const entry = normalized.find((row) => row.venueId === choice.venueId);
      if (entry) retain(choice, entry);
      else failed.push(choice);
    }
    for (const choice of failed) {
      const retried = selectionsFrom(await requestBatch([choice]), [choice]);
      retain(choice, retried[0]);
    }
    if ((batchIndex + 1) % 10 === 0 || batchIndex === batches.length - 1)
      console.log(JSON.stringify({ completedBatches: batchIndex + 1, totalBatches: batches.length, actualSpendUsd: checkpoint.actualSpendUsd }));
  }
  if (checkpoint.reservedUsd > 0.000000001) throw new Error("unresolved spend reservations; copy retained in checkpoint, publication refused");
  const venues = Object.fromEntries(choices.filter((choice) => !checkpoint.skipped[choice.venueId]).map((choice) => {
    const { venueId, sentences, vibeTags } = checkpoint.entries[choice.venueId];
    return [venueId, { venueId, sentences, vibeTags }];
  }));
  writeJson(opts.out, { version: 1, model: FLASH_LITE_SKU.model, generatedAt: new Date().toISOString(),
    startedAt, sourceDataset: "public/data/pint_prices_app_dataset.json", sourceDatasetSha256: hash(raw),
    pricing: FLASH_LITE_SKU, taskCapUsd: opts.cap, projectedSpendUsd,
    actualSpendUsd: checkpoint.actualSpendUsd, requests: checkpoint.requests, venues,
    skipped: Object.fromEntries(choices.filter((choice) => checkpoint.skipped[choice.venueId]).map((choice) =>
      [choice.venueId, checkpoint.skipped[choice.venueId]])) });
  console.log(JSON.stringify({ publishedVenues: Object.keys(venues).length, skippedVenues: choices.length - Object.keys(venues).length, actualSpendUsd: checkpoint.actualSpendUsd, requests: checkpoint.requests }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
