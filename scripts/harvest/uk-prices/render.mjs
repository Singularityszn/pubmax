#!/usr/bin/env node
// The RENDERED half of the UK price crawl: read the permitted chain menu pages
// that state their prices in the browser rather than in the document.
//
//   npm run harvest:uk-prices-rendered                  # every permitted chain
//   npm run harvest:uk-prices-rendered -- --limit 50    # bounded run
//   npm run harvest:uk-prices-rendered -- --only greeneking.co.uk
//   npm run harvest:uk-prices-rendered -- --pub-sites --only tapeast.co.uk,lvls.london
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
// PUB SITES. `--pub-sites` renders a pub's OWN website instead: the same
// snapshot `website` the document lane reads, permitted by the same rule
// (pubSites.mjs), and only where that site serves exactly one pub, so a price on
// it has no attribution question. It renders the home page, then up to
// PUB_SITE_MENU_PAGES of the drinks links that page states, each asked of
// robots first. It exists because a pub whose menu is drawn by script reads as
// "no price" to the document lane.
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
  OVERLAY_MENU_URL_INPUT_PATH,
  crawlableOverlayMenuUrls,
  readOverlayMenuUrlInput,
} from "./menu-urls.mjs";
import {
  cheapestPerCategory,
  pageNamesAnotherBranch,
  pageStatesADrinksList,
  readVenueDrinkPrices,
  renderLooksEmpty,
  siteHarvestPriceKey,
} from "../../../lib/harvest/ukPriceCrawl.ts";
import { renderedMenuLinks, singlePubSiteTargets } from "./pubSites.mjs";

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
  // The renderer strips *_PROXY from its browser's environment and takes a
  // proxy only through its own settings, so an environment that reaches the
  // web through one has to say so here or the browser cannot connect at all.
  ...(process.env.HTTPS_PROXY ? { USE_PROXY: "true", PROXY_URL: process.env.HTTPS_PROXY } : {}),
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
/** `--only` names one host or a comma-separated list of them. */
const ONLY_HOSTS = ONLY
  ? ONLY.split(",").map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0)
  : null;
const PUB_SITES = flag("--pub-sites");
const CONCURRENCY = Math.max(1, Number(option("--concurrency", DEFAULT_CONCURRENCY)));
const RENDERER = option("--renderer", "npx");
/**
 * The committed overlay menu-url input, read by scripts/harvest/uk-prices/menu-urls.mjs
 * out of `harvest_venue_overlays.menu_url`. `--menu-urls none` leaves the lane
 * reading permitted chain estates alone.
 */
const MENU_URL_INPUT = option("--menu-urls", OVERLAY_MENU_URL_INPUT_PATH);
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
        // A renderer that could not reach the page answers with an error and no
        // words. That is a failure to record, not a page that states nothing.
        if (parsed.error && !parsed.markdown) {
          resolve({ ok: false, reason: "render-failed" });
          return;
        }
        resolve({
          ok: true,
          markdown: String(parsed.markdown ?? ""),
          links: Array.isArray(parsed.links) ? parsed.links : [],
          status: parsed.http_status ?? null,
          // The renderer follows redirects and reports where it landed.
          landedUrl: typeof parsed.url === "string" && parsed.url ? parsed.url : url,
        });
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

/**
 * The menu pages the fold recorded per pub, joined back to the pub the snapshot
 * knows. Overlay identity IS the OSM id, so the join is exact and a row the
 * snapshot does not carry is dropped rather than rendered under a guessed name.
 *
 * These are per-pub pages on a pub's OWN site, so like the chain lane's targets
 * they name exactly one pub and have no attribution question to answer.
 */
function overlayMenuTargets(pubsByOsmId) {
  const input = readOverlayMenuUrlInput(MENU_URL_INPUT);
  if (!input) return { targets: [], read: false, held: 0 };
  const targets = [];
  for (const target of crawlableOverlayMenuUrls(input)) {
    const venueId = target.venueId ?? ukBaseVenueId(target.osmId);
    if (!venueId) continue;
    const pub = pubsByOsmId.get(target.osmId) ?? null;
    targets.push({
      venueId,
      osmId: target.osmId ?? null,
      name: pub?.name ?? null,
      postcode: pub?.postcode ?? null,
      lat: pub?.lat ?? null,
      lng: pub?.lng ?? null,
      host: target.host ?? hostOf(target.menuUrl),
      sourceId: "harvest-overlay-menu",
      menuUrl: target.menuUrl,
    });
  }
  return { targets, read: true, held: input.urls.length };
}

async function main() {
  if (!existsSync(OSM_PUBS)) {
    console.error(`missing ${path.relative(ROOT, OSM_PUBS)}; run npm run fetch:uk-pubs first`);
    process.exitCode = 1;
    return;
  }

  const { targets: chainTargets, allowedHosts } = chainMenuTargets();

  const snapshot = JSON.parse(readFileSync(OSM_PUBS, "utf8"));
  const pubsByOsmId = new Map(
    (Array.isArray(snapshot) ? snapshot : (snapshot.pubs ?? []))
      .filter((pub) => typeof pub?.osmId === "string")
      .map((pub) => [pub.osmId, pub]),
  );
  const overlay = overlayMenuTargets(pubsByOsmId);

  // A page named by BOTH lanes is read once. The chain lane derives its URL from
  // the source table's own suffix; the overlay states the page the pub's site
  // published. Where those agree there is one page, not two.
  const seenUrls = new Set(chainTargets.map((target) => target.menuUrl));
  const targets = [...chainTargets];
  for (const target of overlay.targets) {
    if (seenUrls.has(target.menuUrl)) continue;
    seenUrls.add(target.menuUrl);
    targets.push(target);
  }

  // A SKIP IS A FINDING, and the two absences are different ones: an input file
  // nobody has cut yet, and one cut from a table that held nothing.
  console.log(
    overlay.read
      ? `  overlay menu urls: ${overlay.held} in ${path.relative(ROOT, MENU_URL_INPUT)}, ${overlay.targets.length} crawlable`
      : `  overlay menu urls: no input at ${path.relative(ROOT, MENU_URL_INPUT)}; run npm run harvest:uk-menu-urls`,
  );

  if (PUB_SITES) {
    // Pub sites are read INSTEAD of chain and overlay pages, never beside them,
    // so one run answers one question.
    targets.length = 0;
    for (const target of singlePubSiteTargets([...pubsByOsmId.values()], { only: ONLY_HOSTS })) {
      targets.push({ ...target, kind: "pub-site", menuUrl: target.homeUrl });
    }
    console.log(`  pub sites: ${targets.length} single-pub site(s) permitted${ONLY_HOSTS ? ` within --only` : ""}`);
  }

  if (targets.length === 0) {
    console.log(
      PUB_SITES
        ? "rendered menu harvest: no permitted single-pub site matches"
        : "rendered menu harvest: no permitted chain or overlay page publishes a rendered menu today",
    );
    return;
  }

  const ledger =
    RESET || !existsSync(LEDGER_PATH)
      ? { version: 1, pages: {} }
      : JSON.parse(readFileSync(LEDGER_PATH, "utf8"));

  const pending = targets
    .filter((target) => (ONLY_HOSTS ? ONLY_HOSTS.some((name) => target.host.includes(name)) : true))
    .filter((target) => !ledger.pages[target.menuUrl])
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : targets.length);

  const robots = createRobotsChecker();
  const outcomes = {};
  let retries = 0;
  const started = Date.now();
  let index = 0;
  let done = 0;

  if (!DRY_RUN) mkdirSync(OUT_DIR, { recursive: true });


  /**
   * A REDIRECT IS ASKED ABOUT TOO. Permission was given for the page requested;
   * a landing on another host, or on a path its robots refuse, was never
   * permitted, so its words are refused rather than read.
   */
  async function landingRefusal(requestedUrl, rendered) {
    if (rendered.landedUrl === requestedUrl) return null;
    if (hostOf(rendered.landedUrl) !== hostOf(requestedUrl)) return "redirected-off-site";
    const decision = await robots(rendered.landedUrl);
    return decision.allowed ? null : decision.reason;
  }

  /** One target's priced rows, written the one way both modes write them. */
  function appendPricedRows(target, priced, linesOnPage) {
    if (DRY_RUN || priced.length === 0) return;
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
            ...(row.drinkLabel ? { drinkLabel: row.drinkLabel } : {}),
            ...(row.servingSize ? { servingSize: row.servingSize } : {}),
            sourceUrl: row.url ?? target.menuUrl,
            observedAt,
            // A per-pub menu page, and a site serving one pub, name exactly
            // one pub, so this lane never has an attribution question to answer.
            pubsOnHost: 1,
            linesOnPage: row.linesOnPage ?? linesOnPage,
            renderer: "wigolo",
          }),
        )
        .join("\n")}\n`,
    );
  }

  /** A chain or overlay target: one named menu page. */
  async function readMenuPage(target) {
    const rendered = await render(target.menuUrl);
    if (rendered.retried) retries += 1;
    if (!rendered.ok) return rendered.reason;
    const refused = await landingRefusal(target.menuUrl, rendered);
    if (refused) return refused;
    const reading = readVenueDrinkPrices(rendered.markdown);
    if (!pageStatesADrinksList(reading)) return "menu-states-no-price";
    appendPricedRows(target, cheapestPerCategory(reading), reading.kept.length);
    return "priced";
  }

  /**
   * A pub's own site: its home page, then the drinks links that page states.
   * ONE ROW PER DRINK across the site, and the cheapest page wins, as in the
   * document lane.
   */
  async function readPubSite(target) {
    const home = await render(target.homeUrl);
    if (home.retried) retries += 1;
    if (!home.ok) return home.reason;
    const homeRefused = await landingRefusal(target.homeUrl, home);
    if (homeRefused) return homeRefused;
    const pages = [{ url: target.homeUrl, markdown: home.markdown }];
    // A drinks link that was refused or failed is remembered, so a site whose
    // only menu could not be read is never recorded as having no menu.
    let linkFailure = null;
    const identity = {
      name: target.name,
      locality: target.locality,
      address: target.address,
      website: target.homeUrl,
    };
    for (const link of renderedMenuLinks(home.links, target.homeUrl)) {
      // A pub's site can link to the chain's other branches, and every page
      // this lane reads is written as this pub's. A link that names another
      // branch is that branch's menu, so it is not opened.
      if (pageNamesAnotherBranch(link, identity)) continue;
      const decision = await robots(link);
      if (!decision.allowed) {
        linkFailure ??= decision.reason;
        continue;
      }
      await sleep(CHAIN_HOST_DELAY_MS);
      const page = await render(link);
      if (page.retried) retries += 1;
      if (!page.ok) {
        linkFailure ??= page.reason;
        continue;
      }
      const refused = await landingRefusal(link, page);
      if (refused) {
        linkFailure ??= refused;
        continue;
      }
      pages.push({ url: link, markdown: page.markdown });
    }
    const byKey = new Map();
    for (const page of pages) {
      const reading = readVenueDrinkPrices(page.markdown);
      if (!pageStatesADrinksList(reading)) continue;
      for (const row of cheapestPerCategory(reading)) {
        const key = siteHarvestPriceKey(row.category, row.drinkLabel, row.servingSize);
        const held = byKey.get(key);
        if (!held || row.priceGbp < held.priceGbp) {
          byKey.set(key, { ...row, url: page.url, linesOnPage: reading.kept.length });
        }
      }
    }
    if (byKey.size === 0) {
      return linkFailure ?? (pages.length > 1 ? "menu-states-no-price" : "no-menu-page-found");
    }
    appendPricedRows(target, [...byKey.values()], 0);
    return "priced";
  }

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
      const outcome = target.kind === "pub-site" ? await readPubSite(target) : await readMenuPage(target);
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
    overlayMenuPages: { inputRead: overlay.read, held: overlay.held, crawlable: overlay.targets.length },
    menuPagesReadThisRun: done,
    menuPagesInLedger: Object.keys(ledger.pages).length,
    outcomes,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  };
  if (!DRY_RUN) {
    mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(`rendered menu harvest: ${done} page(s) read`);
  for (const [name, count] of Object.entries(outcomes)) console.log(`  ${name}: ${count}`);
  if (!DRY_RUN) console.log(`  report → ${path.relative(ROOT, REPORT_PATH)}`);
}

await main();
