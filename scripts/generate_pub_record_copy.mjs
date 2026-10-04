#!/usr/bin/env node
// Generate copy from stored pub fields. No page, Places or search request is made.
// Default is a dry run. --generate spends the printed budget through Vertex AI.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { FLASH_LITE_SKU, spendFromTokenCounts } from "../lib/harvest/pubWebsiteAmenities.ts";
import { COPY_CONNECTIVE_WORDS, copyFactsForVenue, copyWordsForTag, validateVenueRecordCopy } from "../lib/venueRecordCopy.ts";
import { VENUE_RECORD_COPY_TRACING_INCLUDE } from "../lib/venueRecordCopyFile.mjs";
import { groupVenuePrices } from "../lib/venues.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const JOB_CAP_USD = 15;
const BATCH_SIZE = 10;
const OUTPUT_TOKENS = 4096;
const INSUFFICIENT = "insufficient-stored-facts";
const INVALID = "invalid-copy-after-retry";
const PROMPT = [
  "Write one short description and choose vibe tags for each London pub using ONLY its supplied stored facts.",
  "Return JSON {rows:[{venueId:string,description:string,vibeTags:string[]}]}, one row per supplied venue.",
  "description: ONE plain sentence of 20 to 140 characters, starting with a capital letter and ending with a full stop.",
  "Make the pub, or the local, the subject: the facts belong to it, never to the borough. Name the supplied facts, each once. You may name the supplied borough or London, spelt and capitalised exactly. Add nothing else: no filler, no repetition.",
  "Write like a Londoner telling a mate: dry and direct, never salesy. Vary the sentence shape between venues.",
  `Use no word except these, the words of the venue's borough and the words listed for its facts: ${COPY_CONNECTIVE_WORDS.join(", ")}.`,
  "Use no digits, apostrophes or punctuation other than commas, hyphens and the final full stop.",
  "vibeTags: one to three of the venue's fact tags, copied exactly, most distinctive first.",
  "Never mention the pub name, food, beer gardens, sport, prices, hours, history, mood or clientele.",
  "No external knowledge, Google Places, tools or web searches.",
  "VENUES:",
].join("\n");

function options() {
  const opts = { generate: false, check: false, dryRun: false, cap: JOB_CAP_USD,
    dataset: path.join(ROOT, "public/data/pint_prices_app_dataset.json"),
    out: path.join(ROOT, VENUE_RECORD_COPY_TRACING_INCLUDE),
    checkpoint: path.join(ROOT, "data-harvest/pub-record-copy/checkpoint.json") };
  const values = { "--dataset": "dataset", "--out": "out", "--checkpoint": "checkpoint", "--cap-usd": "cap" };
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === "--generate") opts.generate = true;
    else if (flag === "--check") opts.check = true;
    else if (flag === "--dry-run") opts.dryRun = true;
    else if (values[flag]) {
      const value = process.argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
      opts[values[flag]] = values[flag] === "cap" ? Number(value) : path.resolve(value);
    } else throw new Error(`unknown argument ${flag}`);
  }
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
const textFor = (batch) => `${PROMPT}\n${JSON.stringify(batch.map(({ venueId, borough, supportedTags }) =>
  ({ venueId, borough, facts: supportedTags.map((tag) => ({ tag, words: copyWordsForTag(tag) })) })))}`;
// One UTF-8 byte per input token is deliberately conservative, with framing room.
const reserveFor = (batch) => cost(Buffer.byteLength(textFor(batch), "utf8") + 4096, OUTPUT_TOKENS);

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
  // A fresh checkpoint continues the metered spend the published pack records.
  const published = readJson(out, null);
  const checkpoint = readJson(file, { version: 1, actualSpendUsd: published?.actualSpendUsd ?? 0, reservedUsd: 0,
    requests: published?.requests ?? 0, entries: {} });
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
    const copy = matching.length === 1 ? validateVenueRecordCopy(fact, matching[0]) : null;
    if (copy) normalized.push({ ...fact, ...copy });
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
  const facts = groupVenuePrices(data).map(copyFactsForVenue).filter(Boolean)
    .sort((a, b) => a.venueId.localeCompare(b.venueId));
  if (!facts.length) throw new Error("no pub records to generate");
  if (opts.check) {
    checkPublishedCopy(facts, opts.out);
    return;
  }
  const checkpoint = loadSpendCheckpoint(opts.checkpoint, opts.out);
  // An earlier unknown outcome is released so it can never block a later run.
  const releasedReservationUsd = checkpoint.reservedUsd;
  checkpoint.reservedUsd = 0;
  const eligible = facts.filter((fact) => fact.supportedTags.length > 0);
  const pending = eligible.filter((fact) => {
    const entry = checkpoint.entries[fact.venueId];
    const inputHash = hash(JSON.stringify(fact));
    if (checkpoint.skipped[fact.venueId]?.inputHash === inputHash) return false;
    return entry?.inputHash !== inputHash || !validateVenueRecordCopy(fact, entry);
  });
  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE));
  // Allow HTTP retries for each batch and one single-pub grounding retry per pending pub.
  const projectedSpendUsd = checkpoint.actualSpendUsd +
    batches.reduce((sum, batch) => sum + reserveFor(batch) * 3, 0) +
    pending.reduce((sum, fact) => sum + reserveFor([fact]) * 3, 0);
  console.log(JSON.stringify({ model: FLASH_LITE_SKU.model, venues: facts.length, eligible: eligible.length,
    pending: pending.length, batches: batches.length, projectedSpendUsd, taskCapUsd: opts.cap,
    actualSpendUsd: checkpoint.actualSpendUsd, releasedReservationUsd, mode: opts.generate ? "generate" : "dry-run" }));
  if (projectedSpendUsd > opts.cap) throw new Error("projected spend exceeds task cap; no model call made");
  if (!opts.generate) return;
  let token = "";
  let tokenAt = 0;
  let nextCallAt = 0;
  let pacingMs = 3_000;
  const startedAt = new Date().toISOString();
  async function requestBatch(batch) {
    // Quota responses back off to the one-minute ceiling before giving up.
    for (let attempt = 0; attempt < 8; attempt++) {
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
        }
        if (response.status === 429 ? attempt < 7 : [401, 503].includes(response.status) && attempt < 2) {
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
  function retain(fact, entry) {
    const inputHash = hash(JSON.stringify(fact));
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
    const normalized = copyFrom(await requestBatch(batch), batch);
    const failed = [];
    for (const fact of batch) {
      const entry = normalized.find((row) => row.venueId === fact.venueId);
      if (entry) retain(fact, entry);
      else failed.push(fact);
    }
    for (const fact of failed) {
      const retried = copyFrom(await requestBatch([fact]), [fact]);
      retain(fact, retried[0]);
    }
    if ((batchIndex + 1) % 10 === 0 || batchIndex === batches.length - 1)
      console.log(JSON.stringify({ completedBatches: batchIndex + 1, totalBatches: batches.length, actualSpendUsd: checkpoint.actualSpendUsd }));
  }
  if (checkpoint.reservedUsd > 0.000000001) throw new Error("unresolved spend reservations; copy retained in checkpoint, publication refused");
  const venues = Object.fromEntries(eligible.filter((fact) => !checkpoint.skipped[fact.venueId]).map((fact) => {
    const { venueId, borough, supportedTags, description, vibeTags } = checkpoint.entries[fact.venueId];
    return [venueId, { venueId, borough, supportedTags, description, vibeTags }];
  }));
  writeJson(opts.out, { version: 2, model: FLASH_LITE_SKU.model, generatedAt: new Date().toISOString(),
    startedAt, sourceDataset: "public/data/pint_prices_app_dataset.json", sourceDatasetSha256: hash(raw),
    pricing: FLASH_LITE_SKU, taskCapUsd: opts.cap, projectedSpendUsd,
    actualSpendUsd: checkpoint.actualSpendUsd, requests: checkpoint.requests, venues,
    skipped: Object.fromEntries(facts.filter((fact) => !venues[fact.venueId]).map((fact) =>
      [fact.venueId, fact.supportedTags.length ? checkpoint.skipped[fact.venueId] : { reason: INSUFFICIENT }])) });
  console.log(JSON.stringify({ publishedVenues: Object.keys(venues).length, skippedVenues: facts.length - Object.keys(venues).length, actualSpendUsd: checkpoint.actualSpendUsd, requests: checkpoint.requests }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
