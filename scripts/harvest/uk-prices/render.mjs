#!/usr/bin/env node
// The RENDERED half of the UK price crawl: read the permitted chain menu pages
// that state their prices in the browser rather than in the document.
//
//   npm run harvest:uk-prices-rendered                  # every permitted chain
//   npm run harvest:uk-prices-rendered -- --limit 50    # bounded run
//   npm run harvest:uk-prices-rendered -- --only greeneking.co.uk
//
// WHY A SECOND LANE. scripts/harvest/uk-prices/run.mjs reads what a page STATES
// in the document it serves. That is the right default and it is cheap. It also
// finds nothing on a Sitecore or Wix app whose menu is assembled in the
// browser, which is how "Greene King publishes no web price" came to be written
// down: the served HTML of a per-pub menu carries 150 KB and no figure. Read the
// SAME page with a real browser and it states 102 of them.
//
// WHAT THIS DOES NOT CHANGE.
//
//   * CONDUCT. Rendering is FORCED (`--render-js=always`) and that is not
//     stealth: it tells the renderer to do the thing this lane exists to do,
//     while stealth, TLS shaping and challenge waiting all stay off. A blocked
//     page is still counted and left alone.
//   * PERMISSION. RESPECT_ROBOTS_TXT is passed to the renderer and
//     lib/harvest/robots.ts is asked here as well, so a host is refused twice
//     over rather than once. A page behind a challenge is a REFUSAL to record:
//     the renderer is run with stealth off, TLS shaping off and no challenge
//     wait, and a blocked page is counted, never worked around.
//   * IDENTITY. The renderer is asked to identify as PUBMAXX, the same user
//     agent the document lane sends.
//   * WHAT COUNTS AS A PRICE. The rendered text goes through the SAME
//     lib/harvest/ukPriceCrawl.ts rules as a served document: verbatim on the
//     page, a drink word beside it, no food word, no offer wording, and a page
//     that states a list rather than a banner.
//
// The renderer is wigolo (AGPL, local, https://github.com/KnockOutEZ/wigolo),
// adopted on the captain's instruction of 2026-09-04. It is invoked as a plain
// subprocess and its absence is a SKIP with a reason, never a crash: this lane
// is an addition to the document lane and never a replacement for it.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import { harvestSourcesOfKind, isHarvestSourceAllowed } from "../../../lib/harvest/sourcePolicy.ts";
import {
  cheapestPerCategory,
  pageStatesADrinksList,
  readVenueDrinkPrices,
  renderLooksEmpty,
} from "../../../lib/harvest/ukPriceCrawl.ts";

const ROOT = process.cwd();
const OSM_PUBS = path.join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const OUT_DIR = path.join(ROOT, "data-harvest/uk_prices");
const LEDGER_PATH = path.join(OUT_DIR, "rendered.json");
const ROWS_PATH = path.join(OUT_DIR, "rows.jsonl");
const REPORT_PATH = path.join(ROOT, "data/uk_prices/rendered_report.json");

const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";
const RENDER_TIMEOUT_MS = 90_000;
/**
 * How many pages are in flight at once.
 *
 * What this lane spends is not bandwidth, it is BROWSER TIME: a forced render of
 * one Greene King menu page takes about five seconds whatever else is running,
 * so three workers read about one page every two seconds and a 1,121-page estate
 * takes most of a working day. Six workers behind the per-page gap below hold
 * the sustained rate near one page a second, which is a gentler load on a chain
 * estate than the rate a single-threaded reader of a fast site would make.
 */
const DEFAULT_CONCURRENCY = 6;
/**
 * The polite gap between two pages on the SAME chain host. A chain's estate is
 * a thousand pages behind one hostname, so this lane is the one place a per-host
 * budget matters more than throughput does.
 */
const CHAIN_HOST_DELAY_MS = 500;
/**
 * How many times a page that renders EMPTY is asked again.
 *
 * An empty render is a fact about US and not about the pub: the app did not
 * finish assembling itself before the renderer read it. Measured on 2026-09-04
 * over ten Greene King menus the first run called no-price, three of which state
 * a full drinks list on a second read and four of which render nothing at all.
 * A page that renders and simply STATES no price is never retried, because
 * asking a pub the same question twice does not change its answer.
 */
const RENDER_RETRIES_ON_EMPTY = 2;
/**
 * WHY THE RENDERER IS TOLD TO RENDER.
 *
 * Its default routes a page over plain HTTP first and decides for itself whether
 * to open a browser. That decision is wrong for this lane by construction: every
 * page here is one whose prices exist only after its own script has run, which is
 * the whole reason the lane exists. Left on the default, a Chef & Brewer menu
 * page came back three times out of three as 538 characters saying `Content is
 * loading...`, and the same URL with rendering forced states 58 prices. Measured
 * over six Greene King pages the first run recorded as stating no price, forcing
 * it turned one of them into a Wine and Cocktails list.
 */
const RENDER_JS = "--render-js=always";

/**
 * The environment the renderer is given, and every entry is a promise about
 * conduct rather than a tuning knob. Robots are respected, stealth and TLS
 * shaping are off so we look like what we are, and a challenge is not waited
 * out.
 */
const RENDER_ENV = {
  RESPECT_ROBOTS_TXT: "true",
  WIGOLO_TLS_TIER: "off",
  WIGOLO_STEALTH: "off",
  WIGOLO_CHALLENGE_COMPLETION_MS: "0",
  WIGOLO_USER_AGENT: USER_AGENT,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const flag = (name) => process.argv.includes(name);
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const RESET = flag("--reset");
const DRY_RUN = flag("--dry-run");
const LIMIT = Number(option("--limit", Number.POSITIVE_INFINITY));
const ONLY = option("--only", null);
const CONCURRENCY = Math.max(1, Number(option("--concurrency", DEFAULT_CONCURRENCY)));
const RENDERER = option("--renderer", "npx");
const RENDERER_ARGS = RENDERER === "npx" ? ["--yes", "wigolo@latest"] : [];

function ukBaseVenueId(osmId) {
  if (typeof osmId !== "string") return null;
  const match = /^(node|way|relation)\/(\d+)$/.exec(osmId.trim());
  return match ? `venue-uk-${match[1][0]}${match[2]}` : null;
}

function hostOf(url) {
  try {
    return new URL(url.includes("//") ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Run the renderer once and hand back the markdown it read, or a refusal. */
function renderOnce(url) {
  return new Promise((resolve) => {
    const child = spawn(RENDERER, [...RENDERER_ARGS, "fetch", url, "--json", "--force-refresh", RENDER_JS], {
      env: { ...process.env, ...RENDER_ENV },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, reason: "render-timed-out" });
    }, RENDER_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: "renderer-unavailable" });
    });
    child.on("close", () => {
      clearTimeout(timer);
      // The answer is a JSON document on stdout, pretty-printed, with the
      // renderer's own log lines on stderr. Slicing from the first brace is what
      // survives a renderer that one day decides to print a banner first.
      const start = out.indexOf("{");
      if (start < 0) {
        resolve({ ok: false, reason: "renderer-answered-nothing" });
        return;
      }
      try {
        const parsed = JSON.parse(out.slice(start));
        // A challenge page is a refusal we RECORD. Nothing here waits one out.
        if (typeof parsed.http_status === "number" && parsed.http_status === 403) {
          resolve({ ok: false, reason: "blocked-by-challenge" });
          return;
        }
        resolve({ ok: true, markdown: String(parsed.markdown ?? ""), status: parsed.http_status ?? null });
      } catch {
        resolve({ ok: false, reason: "renderer-answered-nothing" });
      }
    });
  });
}

/**
 * Read one page, asking again only when it came back EMPTY.
 *
 * The retry is bounded and it is spent on one question: did the app finish
 * assembling itself. A page that answered with words keeps its answer, whatever
 * that answer was.
 */
async function render(url) {
  let last = await renderOnce(url);
  for (let attempt = 0; attempt < RENDER_RETRIES_ON_EMPTY; attempt += 1) {
    if (!last.ok || !renderLooksEmpty(last.markdown)) return last;
    await sleep(CHAIN_HOST_DELAY_MS);
    const again = await renderOnce(url);
    last = { ...again, retried: true };
  }
  return last;
}

/** The per-pub menu pages of every chain the source table allows. */
function chainMenuTargets() {
  const allowed = harvestSourcesOfKind("chain-menu-prices").filter(isHarvestSourceAllowed);
  const allowedHosts = new Map();
  for (const source of allowed) {
    const host = hostOf(source.url);
    if (host) allowedHosts.set(host, source);
    for (const extra of source.renderedMenuHosts ?? []) allowedHosts.set(extra, source);
  }
  if (allowedHosts.size === 0) return { targets: [], allowedHosts };

  const snapshot = JSON.parse(readFileSync(OSM_PUBS, "utf8"));
  const pubs = Array.isArray(snapshot) ? snapshot : (snapshot.pubs ?? []);
  const targets = [];
  for (const pub of pubs) {
    const website = typeof pub.website === "string" ? pub.website.trim() : "";
    if (website.length === 0) continue;
    const host = hostOf(website);
    if (!host) continue;
    const source = [...allowedHosts.entries()].find(
      ([known]) => host === known || host.endsWith(`.${known}`),
    )?.[1];
    if (!source) continue;
    const venueId = ukBaseVenueId(pub.osmId);
    if (!venueId) continue;
    let menuUrl;
    try {
      const base = new URL(website.includes("//") ? website : `https://${website}`);
      // A chain states its menu under the pub's own page. The suffix is the one
      // the source table records, so a chain that shapes its URLs differently
      // says so there rather than here.
      base.pathname = `${base.pathname.replace(/\/$/, "")}${source.menuPathSuffix ?? "/menu"}`;
      base.search = "";
      base.hash = "";
      menuUrl = base.toString();
    } catch {
      continue;
    }
    targets.push({
      venueId,
      osmId: pub.osmId ?? null,
      name: pub.name ?? null,
      postcode: pub.postcode ?? null,
      lat: pub.lat ?? null,
      lng: pub.lng ?? null,
      host,
      sourceId: source.id,
      menuUrl,
    });
  }
  return { targets, allowedHosts };
}

async function main() {
  if (!existsSync(OSM_PUBS)) {
    console.error(`missing ${path.relative(ROOT, OSM_PUBS)}; run npm run fetch:uk-pubs first`);
    process.exitCode = 1;
    return;
  }

  const { targets, allowedHosts } = chainMenuTargets();
  if (targets.length === 0) {
    console.log("rendered chain menu harvest: no permitted chain publishes a rendered menu today");
    return;
  }

  const ledger =
    RESET || !existsSync(LEDGER_PATH)
      ? { version: 1, pages: {} }
      : JSON.parse(readFileSync(LEDGER_PATH, "utf8"));

  const pending = targets
    .filter((target) => (ONLY ? target.host.includes(ONLY) : true))
    .filter((target) => !ledger.pages[target.menuUrl])
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : targets.length);

  const robots = createRobotsChecker();
  const outcomes = {};
  let retries = 0;
  const started = Date.now();
  let index = 0;
  let done = 0;

  if (!DRY_RUN) mkdirSync(OUT_DIR, { recursive: true });

  async function worker() {
    for (;;) {
      const target = pending[index++];
      if (!target) return;

      // PERMISSION IS ASKED HERE TOO, not only inside the renderer.
      const decision = await robots(target.menuUrl);
      if (!decision.allowed) {
        ledger.pages[target.menuUrl] = { outcome: decision.reason, checkedAt: new Date().toISOString() };
        outcomes[decision.reason] = (outcomes[decision.reason] ?? 0) + 1;
        done += 1;
        continue;
      }

      await sleep(CHAIN_HOST_DELAY_MS);
      const rendered = await render(target.menuUrl);
      if (rendered.retried) retries += 1;
      let outcome;
      if (!rendered.ok) {
        outcome = rendered.reason;
      } else {
        const reading = readVenueDrinkPrices(rendered.markdown);
        if (!pageStatesADrinksList(reading)) {
          outcome = "menu-states-no-price";
        } else {
          const priced = cheapestPerCategory(reading);
          outcome = "priced";
          if (!DRY_RUN) {
            const observedAt = new Date().toISOString();
            appendFileSync(
              ROWS_PATH,
              `${priced
                .map((row) =>
                  JSON.stringify({
                    host: target.host,
                    venueId: target.venueId,
                    osmId: target.osmId,
                    name: target.name,
                    postcode: target.postcode,
                    lat: target.lat,
                    lng: target.lng,
                    category: row.category,
                    priceGbp: row.priceGbp,
                    sourceUrl: target.menuUrl,
                    observedAt,
                    // A per-pub menu page names exactly one pub, so this lane
                    // never has an attribution question to answer.
                    pubsOnHost: 1,
                    linesOnPage: reading.kept.length,
                    renderer: "wigolo",
                  }),
                )
                .join("\n")}\n`,
            );
          }
        }
      }
      ledger.pages[target.menuUrl] = { outcome, checkedAt: new Date().toISOString() };
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      done += 1;
      if (done % 20 === 0) {
        console.log(`  ${done}/${pending.length} menu page(s), ${JSON.stringify(outcomes)}`);
        if (!DRY_RUN) writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 0)}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (!DRY_RUN) writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 0)}\n`);

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    renderer: "wigolo",
    hostsPermitted: [...allowedHosts.keys()],
    pagesAskedAgainAfterAnEmptyRender: retries,
    menuPagesKnown: targets.length,
    menuPagesReadThisRun: done,
    menuPagesInLedger: Object.keys(ledger.pages).length,
    outcomes,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  };
  if (!DRY_RUN) {
    mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(`rendered chain menu harvest: ${done} page(s) read`);
  for (const [name, count] of Object.entries(outcomes)) console.log(`  ${name}: ${count}`);
  if (!DRY_RUN) console.log(`  report → ${path.relative(ROOT, REPORT_PATH)}`);
}

await main();
