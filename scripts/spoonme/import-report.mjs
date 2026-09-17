#!/usr/bin/env node
// Import the SpoonMe units-per-£10 report into a committed data pack.
//
// WHY THIS IS AN IMPORT AND NOT A COMPUTATION. The firstmate brief asked for
// our own figure first and a third-party figure only where our packs cannot
// answer. Measured on this tree (the numbers are in data/spoonme/README.md):
// our Wetherspoon directory carries ZERO drink prices by construction - the
// chain publishes none on the web, which lib/wetherspoons.ts records at length
// - and the UK price bundle carries no drink name, no serving size and no ABV
// on any of its 4,355 rows. Units per £10 needs all three. So the brief's
// fallback branch covers every row, and the honest thing is to say so rather
// than to model a figure and let it wear somebody else's authority.
//
// WHAT WE STILL DO OURSELVES. Every imported row is RE-DERIVED here before it
// is written: the basket is re-costed from its own lines, the units are
// re-added from its own lines, the budget ceiling is re-checked, and the rank
// order is recomputed from the units. A row whose own arithmetic disagrees with
// its stated totals is QUARANTINED, never repaired. That is what stops us
// publishing a number nobody can check.
//
// ONE FETCH, NO CRAWL. This reads exactly one URL. The report inlines its data
// in the page's own React flight payload, so there is nothing else to ask for.
//
// Usage:
//   node scripts/spoonme/import-report.mjs [--dry-run]
//   node scripts/spoonme/import-report.mjs --from-file <path> --retrieved-at <ISO>
//
// `--from-file` replays bytes already fetched, so it REQUIRES the instant they
// were really retrieved: a pack that dated itself to the replay would claim a
// freshness nobody measured.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { haversineMeters } from "../lib/geo.mjs";
import { CONTACT_EMAIL } from "../../lib/siteContact.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SPOONME_REPORT_URL = "https://spoonme.vercel.app/report";

/**
 * A CREDIT URL IS AN https URL, and this is where that is first said.
 *
 * Three surfaces render the pack's `sourceUrl` as an `href`, so a value that is
 * not an https address is not a credit: it is a link we would ask a reader to
 * follow on our word. The reader half of this check lives in
 * `lib/spoonsValue.ts` (`parseCredit`), because the pack is a committed file
 * and a file can be older than the rule that wrote it. Neither check replaces
 * the other.
 */
export function isCreditUrl(value) {
  if (typeof value !== "string" || value === "" || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}
export const SPOONME_AUTHOR = "Oliver Clegg";
export const SPOONME_PUBLISHED_AT = "2026-08-30";
export const SPOONME_TITLE =
  "I ranked all UK Wetherspoon pubs by where £10 gets you the most drunk";

const USER_AGENT = `PubMaxxingBot/1.0 (+https://pubmaxxing.com; spoons-value import; contact ${CONTACT_EMAIL})`;

const OUT_ROWS = join(ROOT, "public", "data", "spoonme", "rows.json");
const OUT_MAP = join(ROOT, "public", "data", "spoonme", "map.json");

// ---------------------------------------------------------------------------
// Fetch + extract
// ---------------------------------------------------------------------------

async function fetchReport() {
  const res = await fetch(SPOONME_REPORT_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`SpoonMe report answered ${res.status}`);
  return await res.text();
}

/**
 * The report is a prerendered Next.js document that pushes its data into the
 * React flight payload as a sequence of `self.__next_f.push([1, "<chunk>"])`
 * calls. Joining the JSON-decoded chunks reconstitutes the payload, and the
 * ranking object is the one carrying `"rows":[`.
 */
export function extractReportData(html) {
  const chunks = [];
  const push = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/gs;
  let match;
  while ((match = push.exec(html)) !== null) chunks.push(JSON.parse(match[1]));
  const flight = chunks.join("");
  const rowsAt = flight.indexOf('"rows":[');
  if (rowsAt < 0) throw new Error("No ranking rows in the report payload");

  let depth = 0;
  let start = -1;
  for (let i = rowsAt; i > 0; i -= 1) {
    const c = flight[i - 1];
    if (c === "}") depth += 1;
    else if (c === "{") {
      if (depth === 0) {
        start = i - 1;
        break;
      }
      depth -= 1;
    }
  }
  if (start < 0) throw new Error("No enclosing object for the ranking rows");

  let inString = false;
  let escaped = false;
  depth = 0;
  for (let i = start; i < flight.length; i += 1) {
    const c = flight[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(flight.slice(start, i + 1));
    }
  }
  throw new Error("Unterminated ranking object in the report payload");
}

// ---------------------------------------------------------------------------
// Our own arithmetic, re-run over every row
// ---------------------------------------------------------------------------

const NON_DIGIT = /[^A-Z0-9]/g;
const normalisePostcode = (value) => String(value ?? "").toUpperCase().replace(NON_DIGIT, "");

const STOP_WORDS = /\b(the|inn|pub|bar|hotel|jd|wetherspoon|wetherspoons)\b/g;
function nameTokens(value) {
  const cleaned = String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(STOP_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return new Set(cleaned.split(" ").filter((token) => token.length > 1));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Re-derive one row's totals from its own lines. Returns the reason it was
 * refused, or null when its own arithmetic holds.
 *
 * A refusal is never repaired: a basket whose lines do not add up to its stated
 * cost is a row we cannot vouch for, and publishing a corrected figure would be
 * publishing a number the source never stated.
 */
/**
 * The longest a text field on an imported row may be.
 *
 * A row's words are written verbatim from a third-party page into a COMMITTED
 * file, so an unbounded string is a diff nobody can read and a table cell
 * nobody can lay out. 120 characters clears the longest real pub name, town and
 * address line in the shipped edition several times over.
 */
export const MAX_ROW_TEXT = 120;

const ROW_TEXT_FIELDS = ["name", "town", "addressLine", "postcode", "county", "country"];

/** A refusal reason for a row whose words are too long, or null. The reason
 *  NAMES the field and never echoes the value: a quarantine note is a line in
 *  our own log. */
export function checkRowText(row) {
  for (const field of ROW_TEXT_FIELDS) {
    const value = row[field];
    if (typeof value === "string" && value.length > MAX_ROW_TEXT) {
      return `${field} is longer than ${MAX_ROW_TEXT} characters`;
    }
  }
  return null;
}

/** A field as a quarantine note may print it. */
function clip(value) {
  return typeof value === "string" && value.length > MAX_ROW_TEXT
    ? `${value.slice(0, MAX_ROW_TEXT)}...`
    : value;
}

export function checkRowArithmetic(row, budgetPence) {
  if (!Array.isArray(row.lines) || row.lines.length === 0) return "no basket lines";
  let pence = 0;
  let milliunits = 0;
  let glasses = 0;
  for (const line of row.lines) {
    if (!Number.isFinite(line.linePricePence) || line.linePricePence < 0) {
      return "a basket line states no price";
    }
    if (!Number.isFinite(line.lineMilliunits) || line.lineMilliunits <= 0) {
      return "a basket line states no units";
    }
    pence += line.linePricePence;
    milliunits += line.lineMilliunits;
    glasses += Number.isFinite(line.glasses) ? line.glasses : 0;
  }
  if (pence !== row.pence) return `basket costs ${pence}p, row states ${row.pence}p`;
  if (milliunits !== row.milliunits) {
    return `basket holds ${milliunits} milliunits, row states ${row.milliunits}`;
  }
  if (pence > budgetPence) return `basket costs ${pence}p, over the ${budgetPence}p budget`;
  if (glasses !== row.drinkCount) {
    return `basket holds ${glasses} glasses, row states ${row.drinkCount}`;
  }
  return null;
}

/**
 * The rank order our own arithmetic produces: most units first, ties sharing a
 * rank.
 *
 * THE TIE IS ON UNITS ALONE, and that is the whole rule rather than a
 * convention borrowed from the source. The question the ranking asks is what
 * £10 buys, so two pubs that hand over the same units both answer it equally,
 * and one having 3p left over is not a better answer. Cost orders a tie for
 * display and never splits it.
 */
export function rankByUnits(rows) {
  const ordered = [...rows].sort(
    (a, b) => b.milliunits - a.milliunits || a.pence - b.pence || a.id.localeCompare(b.id),
  );
  const out = new Map();
  let rank = 0;
  let seen = 0;
  let previous = null;
  for (const row of ordered) {
    seen += 1;
    if (row.milliunits !== previous) {
      rank = seen;
      previous = row.milliunits;
    }
    out.set(row.id, rank);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

// eslint-disable-next-line complexity
function buildPack(report, directory, basePubs, retrievedAt, sourceSha256) {
  const budgetPence = report.budgetPence;
  if (!Number.isInteger(budgetPence) || budgetPence <= 0) {
    throw new Error("The report states no budget");
  }

  const byPostcode = new Map();
  for (const pub of directory.pubs) {
    const key = normalisePostcode(pub.postcode);
    if (!key) continue;
    if (!byPostcode.has(key)) byPostcode.set(key, []);
    byPostcode.get(key).push(pub);
  }

  const cell = (lat, lng) => `${Math.round(lat * 100)}_${Math.round(lng * 100)}`;
  const grid = new Map();
  for (const pub of basePubs) {
    const key = cell(pub.lat, pub.lng);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(pub);
  }

  const refuse = (row) => checkRowText(row) ?? checkRowArithmetic(row, budgetPence);
  const ourRanks = rankByUnits(report.rows.filter((row) => !refuse(row)));

  const rows = [];
  const quarantined = [];
  let rankAgreements = 0;

  for (const row of report.rows) {
    const refusal = refuse(row);
    if (refusal) {
      quarantined.push({
        id: row.id,
        name: clip(row.name),
        town: clip(row.town),
        reason: refusal,
      });
      continue;
    }

    // Identity: postcode first, name similarity only to break a tie.
    let candidates = byPostcode.get(normalisePostcode(row.postcode)) ?? [];
    if (candidates.length > 1) {
      const tokens = nameTokens(row.name);
      candidates = [
        candidates
          .map((pub) => ({ pub, score: jaccard(tokens, nameTokens(pub.name)) }))
          .sort((a, b) => b.score - a.score)[0].pub,
      ];
    }
    const directoryPub = candidates.length === 1 ? candidates[0] : null;

    // Map pin: the nearest base pub inside 250 m that either shares the name or
    // is close enough that no other pub could be meant.
    let venueId = null;
    let venueMatch = null;
    if (directoryPub && directoryPub.latitude != null && directoryPub.longitude != null) {
      const tokens = nameTokens(row.name);
      const [baseLat, baseLng] = [
        Math.round(directoryPub.latitude * 100),
        Math.round(directoryPub.longitude * 100),
      ];
      let best = null;
      for (let dLat = -1; dLat <= 1; dLat += 1) {
        for (let dLng = -1; dLng <= 1; dLng += 1) {
          for (const pub of grid.get(`${baseLat + dLat}_${baseLng + dLng}`) ?? []) {
            const distance = haversineMeters(
              directoryPub.latitude,
              directoryPub.longitude,
              pub.lat,
              pub.lng,
            );
            if (distance > 250) continue;
            const score = jaccard(tokens, nameTokens(pub.name));
            const rankScore = score * 2 + (1 - distance / 250);
            if (!best || rankScore > best.rankScore) best = { pub, distance, score, rankScore };
          }
        }
      }
      if (best && (best.score >= 0.5 || best.distance <= 60)) {
        venueId = best.pub.curatedVenueId || `venue-uk-${best.pub.ref}`;
        venueMatch = { metres: Math.round(best.distance), nameScore: Number(best.score.toFixed(2)) };
      }
    }

    const ourRank = ourRanks.get(row.id) ?? null;
    if (ourRank === row.rankNumber) rankAgreements += 1;

    rows.push({
      spoonmeId: String(row.id),
      name: row.name,
      town: row.town,
      addressLine: row.addressLine,
      postcode: row.postcode,
      county: row.county,
      country: row.country,
      airport: Boolean(row.airport),
      londonZ12: Boolean(row.londonZ12),
      milliunits: row.milliunits,
      pence: row.pence,
      drinkCount: row.drinkCount,
      lines: row.lines.map((line) => ({
        name: line.name,
        servingLabel: line.servingLabel,
        quantity: line.quantity,
        glasses: line.glasses,
        linePricePence: line.linePricePence,
        lineMilliunits: line.lineMilliunits,
        ...(line.bundleLabel ? { bundleLabel: line.bundleLabel } : {}),
      })),
      rankNumber: ourRank,
      sourceRankNumber: row.rankNumber,
      venueId,
      ...(venueMatch ? { venueMatch } : {}),
      lat: directoryPub?.latitude ?? null,
      lng: directoryPub?.longitude ?? null,
      checkedAt: row.checkedAt,
    });
  }

  rows.sort((a, b) => a.rankNumber - b.rankNumber || a.spoonmeId.localeCompare(b.spoonmeId));

  return {
    version: 1,
    // Mirrored at the top level as well as inside the credit, because the
    // freshness registry reads a stamp by a flat field name and this lane's
    // whole claim is the day it was retrieved.
    retrievedAt,
    provenance: {
      kind: "third-party-analysis",
      title: SPOONME_TITLE,
      author: SPOONME_AUTHOR,
      publisher: "SpoonMe",
      sourceUrl: SPOONME_REPORT_URL,
      publishedAt: SPOONME_PUBLISHED_AT,
      retrievedAt,
      sourceSha256,
      sourceBuiltAt: report.builtAt,
      licence:
        "Unofficial analysis, no licence stated. Imported with credit and a link, " +
        "never presented as our own measurement or as a PUBMAXXING price.",
      notes: [
        "Not affiliated with J D Wetherspoon plc, and neither is SpoonMe.",
        "Every figure here is SpoonMe's observation of a Wetherspoon menu, not a PUBMAXXING price.",
        "No figure in this pack may enter pin price colour, the cheapest-pint buckets, a price band or the Pint Index.",
      ],
    },
    budgetPence,
    count: rows.length,
    quarantinedCount: quarantined.length,
    quarantined,
    rankAgreements,
    unranked: Array.isArray(report.unranked) ? report.unranked : [],
    rows,
  };
}

/** The slim lane the map fetches when the lens is switched on. */
function buildMapLane(pack) {
  return {
    version: 1,
    sourceUrl: pack.provenance.sourceUrl,
    retrievedAt: pack.provenance.retrievedAt,
    // [venueId, milliunits, pence, rankNumber]
    pubs: pack.rows
      .filter((row) => row.venueId)
      .map((row) => [row.venueId, row.milliunits, row.pence, row.rankNumber]),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const fromFileAt = args.indexOf("--from-file");
  const retrievedAtAt = args.indexOf("--retrieved-at");
  const dryRun = args.includes("--dry-run");

  let html;
  let retrievedAt;
  if (fromFileAt >= 0) {
    html = readFileSync(args[fromFileAt + 1], "utf8");
    const stated = retrievedAtAt >= 0 ? args[retrievedAtAt + 1] : null;
    if (!stated || Number.isNaN(Date.parse(stated))) {
      throw new Error("--from-file replays fetched bytes, so it needs --retrieved-at <ISO>");
    }
    retrievedAt = new Date(stated).toISOString();
  } else {
    html = await fetchReport();
    retrievedAt = new Date().toISOString();
  }
  const sourceSha256 = createHash("sha256").update(html).digest("hex");

  const report = extractReportData(html);
  const directory = JSON.parse(
    readFileSync(join(ROOT, "public", "data", "wetherspoons", "pubs.json"), "utf8"),
  );

  const manifest = JSON.parse(
    readFileSync(join(ROOT, "public", "data", "uk_base", "manifest.json"), "utf8"),
  );
  const packDir = join(ROOT, "public", manifest.urlPrefix);
  const basePubs = [];
  for (const shard of manifest.shards) {
    let body;
    try {
      body = JSON.parse(readFileSync(join(packDir, `${shard.id}.json`), "utf8"));
    } catch {
      continue;
    }
    for (const row of body.pubs) {
      basePubs.push({ ref: row[0], name: row[1], lat: row[3], lng: row[4], curatedVenueId: row[5] });
    }
  }

  const pack = buildPack(report, directory, basePubs, retrievedAt, sourceSha256);
  if (!isCreditUrl(pack.provenance.sourceUrl)) {
    throw new Error(
      `The credit needs an https source URL, and this one is ${JSON.stringify(pack.provenance.sourceUrl)}. Nothing was written.`,
    );
  }
  const mapLane = buildMapLane(pack);

  const pinned = pack.rows.filter((row) => row.venueId).length;
  console.log(`SpoonMe rows read      : ${report.rows.length}`);
  console.log(`Arithmetic held        : ${pack.count}`);
  console.log(`Quarantined            : ${pack.quarantinedCount}`);
  console.log(`Our rank agreed        : ${pack.rankAgreements}/${pack.count}`);
  console.log(`Joined to a map pin    : ${pinned}`);
  console.log(`Source sha256          : ${sourceSha256}`);

  if (dryRun) return;
  mkdirSync(dirname(OUT_ROWS), { recursive: true });
  writeFileSync(OUT_ROWS, `${JSON.stringify(pack, null, 1)}\n`);
  writeFileSync(OUT_MAP, `${JSON.stringify(mapLane)}\n`);
  console.log(`Wrote ${OUT_ROWS}`);
  console.log(`Wrote ${OUT_MAP}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
