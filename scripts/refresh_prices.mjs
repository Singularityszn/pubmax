// Scheduled permissible-source price refresh.
//
// WHAT IS REAL in this scaffold:
//   - reads the permissible-source allowlist (data/price_sources.json) and
//     REFUSES to proceed on any source not marked first-party/open;
//   - validates every candidate price row with the SAME hand-rolled guard the
//     app uses (mirrors lib/priceUpdates.ts isValidPriceUpdate) — bad rows are
//     dropped, counted, and reported;
//   - writes a versioned file public/data/price_updates/prices_YYYYMMDD.json in
//     the documented schema;
//   - opens a pull request with the new file via the GitHub CLI (`gh`), so a
//     human reviews every price change before it ships. Never pushes to main.
//
// WHAT IS STUBBED (documented):
//   - fetchFromSource(): the actual network fetch + parse of each first-party
//     page/feed. It currently returns [] (no rows) so a scheduled run is a
//     safe no-op that opens no PR. Implement per-source parsers here, reading
//     ONLY the allowlisted URLs.
//
// GOVERNANCE (hard rules — do not remove):
//   - NO scraping of competitor price sites. Only first-party official pages
//     and open-data feeds listed in data/price_sources.json.
//   - Every emitted price carries { source: {label, url}, observedAt }.
//   - A refreshed price is "sourced" (attributed), never community.
//   - Never present stale as live — observedAt is required and validated.
//
// Run:  node scripts/refresh_prices.mjs [--open-pr]
//   --open-pr   also open a GitHub PR with the new file (needs `gh` auth).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ALLOWLIST_PATH = join(ROOT, "data", "price_sources.json");
const OUT_DIR = join(ROOT, "public", "data", "price_updates");

const PERMISSIBLE_KINDS = new Set(["first-party-official", "open-data"]);

// --- validation (mirror of lib/priceUpdates.ts isValidPriceUpdate) -----------

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
function isValidPriceUpdate(row, now) {
  if (typeof row !== "object" || row === null) return false;
  if (!isNonEmptyString(row.venueKey)) return false;
  if (!isFiniteNumber(row.price) || row.price < 0) return false;
  const s = row.source;
  if (typeof s !== "object" || s === null) return false;
  if (!isNonEmptyString(s.label)) return false;
  if (!isHttpUrl(s.url)) return false;
  if (!isNonEmptyString(row.observedAt)) return false;
  const ms = Date.parse(row.observedAt);
  return Number.isFinite(ms) && ms <= now;
}

// --- allowlist ----------------------------------------------------------------

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const sources = Array.isArray(raw.sources) ? raw.sources : [];
  const permissible = [];
  for (const src of sources) {
    if (!PERMISSIBLE_KINDS.has(src.kind)) {
      console.warn(`SKIP source "${src.id}": kind "${src.kind}" is not permissible`);
      continue;
    }
    if (!isHttpUrl(src.url)) {
      console.warn(`SKIP source "${src.id}": url is not an http(s) URL`);
      continue;
    }
    permissible.push(src);
  }
  return permissible;
}

// --- STUB: per-source fetch ---------------------------------------------------
//
// Implement real parsers here. Each must:
//   - fetch ONLY `source.url` (already allowlist-verified);
//   - map the venue to its canonical venueKey (lib/venues.ts venueGroupingKey);
//   - stamp { source: { label: source.label, url: source.url }, observedAt }.
// Return [] to contribute nothing (the default below) — a safe no-op.
async function fetchFromSource(source) {
  void source;
  // TODO: real first-party fetch + parse. Returning [] keeps the scheduled run
  // a no-op until real parsers land, so it never opens an empty/garbage PR.
  return [];
}

// --- main ---------------------------------------------------------------------

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

async function main() {
  const openPr = process.argv.includes("--open-pr");
  const now = Date.now();
  const sources = loadAllowlist();
  console.log(`Permissible sources: ${sources.length}`);

  const raw = [];
  for (const source of sources) {
    const rows = await fetchFromSource(source);
    console.log(`  ${source.id}: ${rows.length} candidate row(s)`);
    raw.push(...rows);
  }

  let dropped = 0;
  const valid = [];
  for (const row of raw) {
    if (isValidPriceUpdate(row, now)) valid.push(row);
    else dropped += 1;
  }
  if (dropped > 0) console.warn(`Dropped ${dropped} invalid row(s)`);

  if (valid.length === 0) {
    console.log("No valid updates this run — nothing to write. (Stub returns no rows.)");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = todayStamp();
  const outPath = join(OUT_DIR, `prices_${stamp}.json`);
  const body = {
    version: 1,
    generatedAt: new Date().toISOString(),
    updates: valid,
  };
  writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  // Stable alias the client fetches (404-tolerant) — always the newest file.
  const latestPath = join(OUT_DIR, "latest.json");
  writeFileSync(latestPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  console.log(`Wrote ${valid.length} update(s) to ${outPath} (+ latest.json)`);

  if (!openPr) {
    console.log("Run with --open-pr to open a review PR.");
    return;
  }

  // Open a PR so a human reviews every price change. Never push to main.
  const branch = `price-refresh/${stamp}`;
  execFileSync("git", ["checkout", "-b", branch], { stdio: "inherit" });
  execFileSync("git", ["add", outPath, latestPath], { stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(prices): refresh ${stamp} (${valid.length} sourced)`], {
    stdio: "inherit",
  });
  execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });
  execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `Price refresh ${stamp}`,
      "--body",
      "Automated permissible-source price refresh. Every price carries a first-party source + observedAt. Review before merge.",
    ],
    { stdio: "inherit" },
  );
  console.log("Opened review PR.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
