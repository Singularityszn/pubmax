// Scheduled What's-On refresh scaffold (Task B1). Reads sibling scraper outputs
// from scripts/whatson/*.json (sport + quiz agents write rows to the B1 row
// contract), validates every candidate with a JS mirror of isValidWhatsOnRow,
// drops + counts bad rows, and writes a versioned file + latest.json envelope.
// With --open-pr it opens a review PR via `gh` (never pushes to main). NO
// GitHub workflow file (Actions billing-dead).
//
// SAFE NO-OP: if scripts/whatson/ has no candidate .json row files or yields
// zero valid rows, the script logs and returns without writing anything.
//
// Run:  node scripts/refresh_whats_on.mjs [--open-pr]

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IN_DIR = join(ROOT, "scripts", "whatson");
const OUT_DIR = join(ROOT, "public", "data", "whats_on");

const WHATS_ON_KINDS = new Set(["sport", "quiz", "deal", "music"]);
const WHATS_ON_CONFIDENCES = new Set(["confirmed", "listed"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isHttpUrl(v) {
  if (!isNonEmptyString(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function isValidIso(v) {
  return isNonEmptyString(v) && Number.isFinite(Date.parse(v));
}

// Mirror of lib/whatsOn.ts isValidWhatsOnRow.
function isValidWhatsOnRow(row, now) {
  if (typeof row !== "object" || row === null) return false;
  if (!isNonEmptyString(row.id)) return false;
  if (!isNonEmptyString(row.placeName)) return false;
  if (!isNonEmptyString(row.kind) || !WHATS_ON_KINDS.has(row.kind)) return false;
  if (!isValidIso(row.startsAt)) return false;
  if (!isNonEmptyString(row.title)) return false;
  const s = row.source;
  if (typeof s !== "object" || s === null) return false;
  if (!isNonEmptyString(s.label) || !isHttpUrl(s.url)) return false;
  if (!isNonEmptyString(row.observedAt)) return false;
  const ms = Date.parse(row.observedAt);
  if (!Number.isFinite(ms) || ms > now) return false;
  if (!isNonEmptyString(row.confidence) || !WHATS_ON_CONFIDENCES.has(row.confidence)) return false;
  if (row.venueId !== undefined && row.venueId !== null && !isNonEmptyString(row.venueId)) return false;
  if (row.lat !== undefined && row.lat !== null && !isFiniteNumber(row.lat)) return false;
  if (row.lng !== undefined && row.lng !== null && !isFiniteNumber(row.lng)) return false;
  if (row.endsAt !== undefined && row.endsAt !== null && !isValidIso(row.endsAt)) return false;
  if (row.priceGbp !== undefined && row.priceGbp !== null) {
    if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) return false;
  }
  return true;
}

function loadCandidateRows() {
  if (!existsSync(IN_DIR)) {
    console.log("No scripts/whatson/ directory — nothing to refresh (safe no-op).");
    return [];
  }
  const files = readdirSync(IN_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("scripts/whatson/ has no .json files — nothing to refresh (safe no-op).");
    return [];
  }
  const rows = [];
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(IN_DIR, file), "utf8"));
    } catch (err) {
      console.warn(`  SKIP ${file}: not valid JSON (${err.message})`);
      continue;
    }
    const fileRows = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray(data.rows)
        ? data.rows
        : [];
    console.log(`  ${file}: ${fileRows.length} candidate row(s)`);
    rows.push(...fileRows);
  }
  return rows;
}

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function main() {
  const openPr = process.argv.includes("--open-pr");
  const now = Date.now();

  const raw = loadCandidateRows();
  if (raw.length === 0) return;

  let dropped = 0;
  const valid = [];
  for (const row of raw) {
    if (isValidWhatsOnRow(row, now)) valid.push(row);
    else dropped += 1;
  }
  if (dropped > 0) console.warn(`Dropped ${dropped} invalid row(s).`);
  if (valid.length === 0) {
    console.log("No valid rows this run — nothing to write.");
    return;
  }

  const stamp = todayStamp();
  const body = { version: 1, generatedAt: new Date().toISOString(), rows: valid };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `whats_on_${stamp}.json`);
  writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  const latestPath = join(OUT_DIR, "latest.json");
  writeFileSync(latestPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  console.log(`Wrote ${valid.length} row(s) to ${outPath} (+ latest.json).`);

  // A bad file must never leave this machine, even on a review branch.
  try {
    execFileSync("node", [join(ROOT, "scripts", "validate-data.mjs")], { stdio: "inherit" });
  } catch (err) {
    console.error("validate-data failed on the freshly written file — aborting before any PR.");
    throw err;
  }

  if (!openPr) {
    console.log("Run with --open-pr to open a review PR.");
    return;
  }

  const branch = `whats-on-refresh/${stamp}`;
  execFileSync("git", ["checkout", "-b", branch], { stdio: "inherit" });
  execFileSync("git", ["add", outPath, latestPath], { stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(whats-on): refresh ${stamp} (${valid.length} rows)`], {
    stdio: "inherit",
  });
  execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });
  execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `What's-On refresh ${stamp}`,
      "--body",
      "Automated What's-On refresh. Every row carries a source {label,url} + a non-future observedAt. Review before merge.",
    ],
    { stdio: "inherit" },
  );
  console.log("Opened review PR.");
}

main();
