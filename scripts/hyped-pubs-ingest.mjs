#!/usr/bin/env node
// Publish the pubs people are talking about.
//
//   node scripts/hyped-pubs-ingest.mjs [--in <file>] [--out <file>] [--check]
//
// The research file is written by a person (or an agent working like one):
// a pub, an area, one sentence about what is being said, and the links it was
// said in, each with the day it was read. This script is the fence between
// that file and the app. It reads no network, and it publishes nothing it
// cannot stand behind.
//
// WHAT IT REFUSES, and every refusal is counted in the report:
//
//   * a row with no name, no area or no sentence
//   * a sentence longer than one (a paragraph is a summary, not a claim)
//   * a row whose sources carry no http link or no readable day
//   * a source dated in the future, which is a typo rather than a reading
//
// WHAT IT REFUSES A CLAIM ON, rather than the whole row: a stated venue id no
// CURATED venue answers to. The scout's first file stated twelve `venue-uk-*`
// ids, which name rows in the UK base layer rather than the index the map
// opens by `?sel=`; the pub is real and so is the talk about it, so the row
// keeps its place and loses only its pin.
//
// Fill an absent venue id only when name and area match one curated venue.
// Neighbourhood or name aliases need a verified explicit curated id.
// A name alone cannot prove which pub the source describes.
//
// AN EMPTY PUBLISH IS REFUSED over a file that already carries rows, the rule
// `scripts/build_pint_index_snapshot.mjs` takes: a read that found nothing
// must never quietly replace a real answer. `--allow-empty` says it is meant.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = process.cwd();
const DEFAULT_IN = path.join(REPO_ROOT, "data", "hyped-pubs-research", "london.json");
const DEFAULT_OUT = path.join(REPO_ROOT, "public", "data", "hyped", "london.json");
const VENUES_SLIM = path.join(REPO_ROOT, "public", "data", "venues_slim.json");

const FILE_VERSION = 1;
const CITY = "london";
/**
 * One sentence, and the stop count below is what really holds the rule. This
 * ceiling is the backstop for a sentence nobody ended: a real one with a
 * quotation in it runs to about 210 characters.
 */
const MAX_WHY_LINE = 240;

export const DROP_REASONS = [
  "missing-name",
  "missing-area",
  "missing-why-line",
  "why-line-too-long",
  "no-dated-source",
  "future-observation",
];

function readArg(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** One sentence, or none. A second full stop means a second claim. */
function isOneSentence(value) {
  const trimmed = value.trim();
  if (trimmed.length > MAX_WHY_LINE) return false;
  const stops = trimmed.match(/[.!?](\s|$)/g);
  return stops === null || stops.length <= 1;
}

export function normaliseVenueName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Every source a row can stand behind, and whether a refusal was a date in the
 * future. A future reading is a typo rather than a reading, and it is counted
 * apart from a row that cited nothing at all.
 */
function readSources(value, now) {
  const sources = [];
  let future = false;
  for (const source of Array.isArray(value) ? value : []) {
    if (!source || typeof source !== "object") continue;
    if (!isNonEmptyString(source.label)) continue;
    if (!isHttpUrl(source.url)) continue;
    const observed = Date.parse(source.observedAt);
    if (!Number.isFinite(observed)) continue;
    if (observed > now) {
      future = true;
      continue;
    }
    sources.push({
      label: source.label.trim(),
      url: source.url,
      observedAt: new Date(observed).toISOString(),
    });
  }
  return { sources, future };
}

/**
 * Validate and publish. Pure apart from the two file reads the caller does, so
 * the test can hand it fixtures rather than a tree.
 */
export function buildHypedPubsFile(input, venues, now = Date.now()) {
  const rows = Array.isArray(input?.rows) ? input.rows : Array.isArray(input) ? input : [];
  const byId = new Map();
  const byName = new Map();
  for (const venue of venues) {
    if (!venue || !isNonEmptyString(venue.id)) continue;
    byId.set(venue.id, venue);
    const key = normaliseVenueName(venue.name);
    if (!key) continue;
    const held = byName.get(key);
    if (held) held.push(venue);
    else byName.set(key, [venue]);
  }

  const drops = Object.fromEntries(DROP_REASONS.map((reason) => [reason, 0]));
  const published = [];
  let matched = 0;
  let unmatchedIds = 0;

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      drops["missing-name"] += 1;
      continue;
    }
    if (!isNonEmptyString(raw.name)) {
      drops["missing-name"] += 1;
      continue;
    }
    if (!isNonEmptyString(raw.area)) {
      drops["missing-area"] += 1;
      continue;
    }
    if (!isNonEmptyString(raw.whyLine)) {
      drops["missing-why-line"] += 1;
      continue;
    }
    if (!isOneSentence(raw.whyLine)) {
      drops["why-line-too-long"] += 1;
      continue;
    }
    const read = readSources(raw.sources, now);
    if (read.sources.length === 0) {
      if (read.future) drops["future-observation"] += 1;
      else drops["no-dated-source"] += 1;
      continue;
    }
    const sources = read.sources;

    let venueId = null;
    if (isNonEmptyString(raw.venueId)) {
      const stated = raw.venueId.trim();
      if (byId.has(stated)) venueId = stated;
      else unmatchedIds += 1;
    }
    if (!venueId) {
      const candidates = byName.get(normaliseVenueName(raw.name)) ?? [];
      const area = normaliseVenueName(raw.area);
      const inArea = candidates.filter(
        (venue) => area.length > 0 && normaliseVenueName(venue.borough) === area,
      );
      if (inArea.length === 1) venueId = inArea[0].id;
    }
    if (venueId) matched += 1;

    published.push({
      name: raw.name.trim(),
      area: raw.area.trim(),
      venueId,
      whyLine: raw.whyLine.trim(),
      sources,
      score: Number.isFinite(raw.score) ? raw.score : 0,
      mentions: Number.isFinite(raw.mentions)
        ? Math.max(1, Math.floor(raw.mentions))
        : sources.length,
    });
  }

  published.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.mentions !== left.mentions) return right.mentions - left.mentions;
    return left.name.localeCompare(right.name, "en-GB");
  });

  return {
    file: {
      version: FILE_VERSION,
      generatedAt: new Date(now).toISOString(),
      city: CITY,
      rows: published,
    },
    report: {
      read: rows.length,
      published: published.length,
      matched,
      unmatchedIds,
      drops,
    },
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const inFile = readArg(argv, "--in") ?? DEFAULT_IN;
  const outFile = readArg(argv, "--out") ?? DEFAULT_OUT;
  const check = argv.includes("--check");
  const allowEmpty = argv.includes("--allow-empty");

  const source = check ? outFile : inFile;
  let input;
  try {
    input = JSON.parse(await readFile(source, "utf8"));
  } catch (error) {
    console.error(`hyped-pubs-ingest: could not read ${path.relative(REPO_ROOT, source)}`);
    console.error(String(error));
    process.exitCode = 1;
    return;
  }

  const slim = await readJson(VENUES_SLIM, { rows: [] });
  const venues = Array.isArray(slim?.rows) ? slim.rows : [];
  if (venues.length === 0) {
    console.error("hyped-pubs-ingest: public/data/venues_slim.json carries no rows.");
    process.exitCode = 1;
    return;
  }

  const { file, report } = buildHypedPubsFile(input, venues);
  const droppedTotal = Object.values(report.drops).reduce((sum, count) => sum + count, 0);

  console.log(`read       ${report.read}`);
  console.log(`published  ${report.published}`);
  console.log(`matched    ${report.matched} of ${report.published} to a curated venue`);
  console.log(`no pin     ${report.unmatchedIds} stated an id no curated venue answers to`);
  console.log(`dropped    ${droppedTotal}`);
  for (const [reason, count] of Object.entries(report.drops)) {
    if (count > 0) console.log(`  ${reason}: ${count}`);
  }

  if (check) {
    if (droppedTotal > 0) {
      console.error("hyped-pubs-ingest: the published file carries rows the validator refuses.");
      process.exitCode = 1;
    }
    return;
  }

  const existing = await readJson(outFile, null);
  const held = Array.isArray(existing?.rows) ? existing.rows.length : 0;
  if (file.rows.length === 0 && held > 0 && !allowEmpty) {
    console.error(
      `hyped-pubs-ingest: refusing to publish 0 rows over ${held}. Pass --allow-empty if that is meant.`,
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  console.log(`wrote      ${path.relative(REPO_ROOT, outFile)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
