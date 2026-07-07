// Scheduled permissible-source DRINK price refresh (E2 of docs/PRD_ALL_DRINKS.md).
//
// This is the per-drink counterpart to scripts/refresh_prices.mjs (which
// refreshes a venue's single cheapest-pint baseline). It targets the E1 drinks
// menu: named drinks, grouped by category, each with their own price.
//
// WHAT IS REAL in this scaffold:
//   - reads the permissible-source allowlist (data/price_sources.json
//     drinkSources) and REFUSES to proceed on any source whose `kind` is not
//     permissible or that is not explicitly marked `permissible: true`;
//   - validates every candidate row with the SAME hand-rolled guard the app
//     uses (mirrors lib/drinkPriceUpdates.ts isValidDrinkPriceUpdate) — bad
//     rows are dropped, counted, and reported;
//   - writes a versioned file
//     public/data/drink_price_updates/prices_YYYYMMDD.json (+ latest.json
//     alias) in the documented schema;
//   - opens a pull request with the new file via the GitHub CLI (`gh`), so a
//     human reviews every price change before it ships. Never pushes to main;
//   - runs `npm run validate-data` after writing, so a bad file never lands
//     even in the PR branch.
//
// WHAT IS STUBBED (documented):
//   - fetchFromDrinkSource(): the actual network fetch + parse of each
//     first-party page/app menu (Wetherspoons' own site, etc.). It currently
//     returns [] (no rows) so a scheduled run is a safe no-op that opens no
//     PR. See data/price_sources.json → drinkSources → "wetherspoons-official"
//     → notes for exactly what a real parser must respect before it can fetch
//     live: robots.txt, ToS, a stable per-pub parse target, rate limiting, and
//     per-row attribution.
//
// GOVERNANCE (hard rules — do not remove):
//   - NO scraping of competitor price/review sites (Vivino, Untappd, price
//     aggregators). Only first-party chain/venue sites and open-data feeds
//     listed in data/price_sources.json drinkSources, and only entries marked
//     `permissible: true`.
//   - Every emitted price carries { source: {label, url, licence}, observedAt }.
//   - A refreshed price is "sourced" (attributed), never community.
//   - Never present stale as live — observedAt is required and validated.
//
// Run:  node scripts/refresh_drink_prices.mjs [--open-pr]
//   --open-pr   also open a GitHub PR with the new file (needs `gh` auth).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ALLOWLIST_PATH = join(ROOT, "data", "price_sources.json");
const OUT_DIR = join(ROOT, "public", "data", "drink_price_updates");

const PERMISSIBLE_KINDS = new Set(["first-party-chain", "first-party-venue", "open-data"]);
const DRINK_CATEGORIES = new Set([
  "beer",
  "wine",
  "whisky",
  "gin",
  "vodka",
  "rum",
  "cocktail",
  "shot",
  "other",
]);

// --- validation (mirror of lib/drinkPriceUpdates.ts isValidDrinkPriceUpdate) --

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
function isValidDrinkPriceUpdate(row, now) {
  if (typeof row !== "object" || row === null) return false;
  if (!isNonEmptyString(row.venueKey)) return false;
  if (!isNonEmptyString(row.drinkName)) return false;
  if (!isNonEmptyString(row.category) || !DRINK_CATEGORIES.has(row.category)) return false;
  if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) return false;
  const s = row.source;
  if (typeof s !== "object" || s === null) return false;
  if (!isNonEmptyString(s.label)) return false;
  if (!isHttpUrl(s.url)) return false;
  if (!isNonEmptyString(s.licence)) return false;
  if (!isNonEmptyString(row.observedAt)) return false;
  const ms = Date.parse(row.observedAt);
  return Number.isFinite(ms) && ms <= now;
}

// --- allowlist ----------------------------------------------------------------

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const sources = Array.isArray(raw.drinkSources) ? raw.drinkSources : [];
  const permissible = [];
  for (const src of sources) {
    if (!PERMISSIBLE_KINDS.has(src.kind)) {
      console.warn(`SKIP source "${src.id}": kind "${src.kind}" is not permissible`);
      continue;
    }
    if (src.permissible !== true) {
      console.warn(`SKIP source "${src.id}": not marked permissible: true`);
      continue;
    }
    if (!isHttpUrl(src.url)) {
      console.warn(`SKIP source "${src.id}": url is not an http(s) URL`);
      continue;
    }
    if (!isNonEmptyString(src.licence)) {
      console.warn(`SKIP source "${src.id}": missing licence`);
      continue;
    }
    permissible.push(src);
  }
  return permissible;
}

// --- STUB: per-source fetch ---------------------------------------------------
//
// Implement real parsers here. Each must:
//   - respect robots.txt and the site's Terms of Use for `source.url` (already
//     allowlist-verified) BEFORE fetching anything;
//   - fetch ONLY `source.url` (or a stable per-pub path pattern documented
//     alongside the allowlist entry) — never a competitor aggregator;
//   - map each row to its venue's canonical venueKey (lib/venues.ts
//     venueGroupingKey) and to the specific drinkName/category on the E1 menu;
//   - stamp { source: { label: source.label, url: source.url, licence:
//     source.licence }, observedAt };
//   - rate-limit / cache so the refresh never behaves like abusive scraping.
// Return [] to contribute nothing (the default below) — a safe no-op.
async function fetchFromDrinkSource(source) {
  void source;
  // TODO: real first-party fetch + parse (see data/price_sources.json
  // drinkSources[].notes for the Wetherspoons pre-flight checklist). Returning
  // [] keeps the scheduled run a no-op until a real parser lands, so it never
  // opens an empty/garbage PR and never risks an unverified live fetch.
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
  console.log(`Permissible drink sources: ${sources.length}`);

  const raw = [];
  for (const source of sources) {
    const rows = await fetchFromDrinkSource(source);
    console.log(`  ${source.id}: ${rows.length} candidate row(s)`);
    raw.push(...rows);
  }

  let dropped = 0;
  const valid = [];
  for (const row of raw) {
    if (isValidDrinkPriceUpdate(row, now)) valid.push(row);
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

  // Validate before ever proposing a PR — a bad file must never leave this
  // machine, even on a review branch.
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

  // Open a PR so a human reviews every price change. Never push to main.
  const branch = `drink-price-refresh/${stamp}`;
  execFileSync("git", ["checkout", "-b", branch], { stdio: "inherit" });
  execFileSync("git", ["add", outPath, latestPath], { stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(drink-prices): refresh ${stamp} (${valid.length} sourced)`], {
    stdio: "inherit",
  });
  execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });
  execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `Drink price refresh ${stamp}`,
      "--body",
      "Automated permissible-source drink-price refresh. Every price carries a first-party source + licence + observedAt. Review before merge.",
    ],
    { stdio: "inherit" },
  );
  console.log("Opened review PR.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
