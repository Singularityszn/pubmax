#!/usr/bin/env node
// Read the menu pages the UK harvest fold recorded per pub, and write them out
// as a committed input the price crawl lanes can be pointed at.
//
//   npm run harvest:uk-menu-urls                 # read production, write the input
//   npm run harvest:uk-menu-urls -- --dry-run    # print the answer, write nothing
//
// WHY THIS EXISTS. `harvest_venue_overlays.menu_url` (migration 0123) is the one
// price-adjacent source in the tree that nothing reads. The fold records, per
// OSM pub, the https menu page that pub's own site states. That is a first-party
// page for a pub we can already name, which is exactly the kind of page the
// price crawl exists to read, and until now no lane could be pointed at it.
//
// FIVE RULES.
//
// 1. THIS SCRIPT ONLY EVER READS. It issues one GET per page of rows and holds
//    no write path at all. The captain's law is that production data is never
//    written by an agent lane, and the way that law is kept here is that the
//    code to break it does not exist.
//
// 2. A CREDENTIAL IS NEVER TYPED, PASSED OR PRINTED. The key comes from
//    SUPABASE_SERVICE_ROLE_KEY in the environment, the same pair lib/supabase.ts
//    requires, and nothing echoes it.
//
// 3. "WE COULD NOT LOOK" AND "THERE IS NOTHING THERE" ARE TWO FINDINGS, and the
//    freshness law in lib/freshness.ts is the reason they may never merge. With
//    no credentials, or on a failed read, this script REFUSES to write: an empty
//    input file that meant "unmeasured" would be read for ever after as a
//    measured empty answer, and the crawl would report full coverage of nothing.
//
// 4. THE GATE IS THE GATE. Every menu URL is put through
//    `isHarvestableOperatorUrl` here, so a URL on a host the source table refuses
//    on permission never reaches an input file, let alone a fetch. That is the
//    FIRST of two asks: the crawl lanes still ask the host's own robots.txt live
//    before reading a page. Neither ask substitutes for the other.
//
// 5. A SKIP IS A FINDING. Every row that yields no URL is counted under the
//    reason it yielded none, because "we found N menu pages" is only honest
//    beside what happened to the rest.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { isHarvestableOperatorUrl } from "../../../lib/harvest/sourcePolicy.ts";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "data/uk_prices/overlay_menu_urls.json");

const TABLE = "harvest_venue_overlays";
/** One page of rows. PostgREST caps a response, so the read pages rather than asking for everything. */
const PAGE_SIZE = 1000;
/** A read may never become an unbounded scan of a table that grew unexpectedly. */
const MAX_PAGES = 200;

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Every reason an overlay row produced no crawlable menu URL. Each is its own
 * name for the same reason the crawl's host outcomes are: folding "the source
 * table refuses this host" into "the fold recorded no menu" would turn a
 * permission finding into a supply finding, and nobody would go and ask.
 */
const ROW_OUTCOMES = ["usable", "no-menu-url", "policy-refused-host", "unparseable-url"];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The salted id the UK base layer gives one OSM pub, derived the one way
 * lib/ukBasePubs.ts derives it. A row whose ref is not the shape the shards use
 * gets no id rather than a plausible-looking one.
 */
function ukBaseVenueId(osmRef) {
  if (typeof osmRef !== "string") return null;
  return /^[nwr]\d+$/.test(osmRef.trim()) ? `venue-uk-${osmRef.trim()}` : null;
}

/** Read every overlay row, page by page. Answers a kind, never a throw. */
async function readOverlayRows() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { kind: "unconfigured" };

  const base = `${url.replace(/\/+$/, "")}/rest/v1/${TABLE}`;
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const query = `select=osm_id,osm_ref,menu_url,folded_at&order=osm_id.asc&offset=${from}&limit=${PAGE_SIZE}`;
    let response;
    try {
      response = await fetch(`${base}?${query}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
    } catch (error) {
      return { kind: "unreachable", error: error instanceof Error ? error.message : String(error) };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { kind: "unreachable", error: `${response.status} ${response.statusText}: ${body}`.trim() };
    }
    const batch = await response.json().catch(() => null);
    if (!Array.isArray(batch)) return { kind: "unreachable", error: "answer was not a row array" };
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { kind: "ok", rows };
  }
  // The ceiling was reached, so this is a TRUNCATED read and not a whole one.
  // Reporting it as ok would publish a partial input as a complete one.
  return { kind: "unreachable", error: `more than ${MAX_PAGES * PAGE_SIZE} rows; raise MAX_PAGES deliberately` };
}

/** Turn overlay rows into crawlable targets, counting every row that yields none. */
function selectMenuUrls(rows) {
  const outcomes = Object.fromEntries(ROW_OUTCOMES.map((name) => [name, 0]));
  const refusedHosts = {};
  const targets = [];
  const seen = new Set();

  for (const row of rows) {
    const menuUrl = typeof row?.menu_url === "string" ? row.menu_url.trim() : "";
    if (menuUrl.length === 0) {
      outcomes["no-menu-url"] += 1;
      continue;
    }
    const host = hostOf(menuUrl);
    if (!host) {
      outcomes["unparseable-url"] += 1;
      continue;
    }
    // THE FIRST OF TWO ASKS. The source table's own refusal, applied before a
    // URL is ever written down, let alone fetched.
    if (!isHarvestableOperatorUrl(menuUrl)) {
      outcomes["policy-refused-host"] += 1;
      refusedHosts[host] = (refusedHosts[host] ?? 0) + 1;
      continue;
    }
    if (seen.has(menuUrl)) continue;
    seen.add(menuUrl);
    outcomes.usable += 1;
    targets.push({
      venueId: ukBaseVenueId(row.osm_ref),
      osmId: typeof row.osm_id === "string" ? row.osm_id : null,
      osmRef: typeof row.osm_ref === "string" ? row.osm_ref : null,
      host,
      menuUrl,
    });
  }

  targets.sort((a, b) => a.menuUrl.localeCompare(b.menuUrl));
  return { targets, outcomes, refusedHosts };
}

async function main() {
  const read = await readOverlayRows();

  // RULE 3. A read we could not run writes NOTHING. The existing file, whatever
  // it says, keeps saying it, because it at least records a day somebody looked.
  if (read.kind !== "ok") {
    const why =
      read.kind === "unconfigured"
        ? "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set, so the overlay table could not be read"
        : `the overlay table could not be read: ${read.error}`;
    console.error(`overlay menu urls: ${why}`);
    console.error("  nothing written: an unmeasured file would be read as a measured empty answer");
    process.exitCode = 1;
    return;
  }

  const { targets, outcomes, refusedHosts } = selectMenuUrls(read.rows);
  const input = {
    version: 1,
    readAt: new Date().toISOString(),
    source: `public.${TABLE} (migration 0123)`,
    // HOW the answer was taken, because a file that records a day somebody
    // looked owes the reader the door they looked through. This lane writes
    // `service-role-rest`; a read taken through a session's Supabase MCP,
    // which is what happens on a machine with no service-role key on file,
    // is written down as `supabase-mcp-session` by the hand that took it.
    readVia: "service-role-rest",

    counts: {
      overlayRows: read.rows.length,
      ...outcomes,
      distinctHosts: new Set(targets.map((target) => target.host)).size,
    },
    refusedHosts,
    urls: targets,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(input, null, 2));
    return;
  }

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(input, null, 2)}\n`);

  console.log(`overlay menu urls: ${read.rows.length} overlay row(s) read`);
  for (const [name, count] of Object.entries(outcomes)) console.log(`  ${name}: ${count}`);
  for (const [host, count] of Object.entries(refusedHosts)) console.log(`  SKIP ${host}: ${count} refused on permission`);
  console.log(`  input → ${path.relative(ROOT, OUT_PATH)}`);
}

/**
 * The committed input, read by the crawl lanes. Answers `null` when the file is
 * absent so a lane can say the source was never read, rather than that it held
 * nothing.
 */
export function readOverlayMenuUrlInput(file = OUT_PATH) {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && Array.isArray(parsed.urls) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The targets a crawl lane may read, re-asking the permission gate on the way
 * out. The file is committed, so it may be older than the source table it was
 * cut from; a host refused since it was written is dropped here rather than
 * fetched on the strength of a stale answer.
 */
export function crawlableOverlayMenuUrls(input) {
  if (!input || !Array.isArray(input.urls)) return [];
  return input.urls.filter(
    (target) =>
      target &&
      typeof target.menuUrl === "string" &&
      isHarvestableOperatorUrl(target.menuUrl),
  );
}

export { OUT_PATH as OVERLAY_MENU_URL_INPUT_PATH, ROW_OUTCOMES, selectMenuUrls, ukBaseVenueId };

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
