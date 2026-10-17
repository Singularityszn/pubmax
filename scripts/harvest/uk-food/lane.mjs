// The London pub FOOD lane: one host at a time, every page asked about first.
//
// This module is the crawl and nothing else. It takes its pages' transports as
// arguments (a served fetch, a rendered fetch, a PDF reader, a robots checker),
// so the CLI in ./run.mjs wires the real ones and the tests wire fixtures, and
// the rules below are the same in both.
//
// PERMISSION IS ASKED THREE TIMES and no ask stands in for another:
//   1. `isHarvestableOperatorUrl` about every URL before it is requested,
//   2. the host's own robots.txt, live, about every path,
//   3. `harvestRedirectLanding` about the page we LANDED on, served or
//      rendered, because a permitted site that redirects to a refused one would
//      otherwise be read in full and stamped with the URL we asked for.
//
// A PAGE IS READ SERVED FIRST, and rendered only when the served document
// states no menu, because a browser session costs money and most of a pub
// site's text is already in its HTML. A page that states fewer dishes than a
// menu (`pageStatesAFoodMenu`) yields no row, and the ledger says so.
//
// ATTRIBUTION: a curated pub's own menu URL speaks for that pub. Any other page
// on a host that serves several pubs must name the pub in its own path
// (`pageMayPriceThisPub`), or one estate banner becomes hundreds of wrong rows.

import { harvestRedirectLanding, isHarvestableOperatorUrl } from "../../../lib/harvest/sourcePolicy.ts";
import { pageMayPriceThisPub } from "../../../lib/harvest/ukPriceCrawl.ts";
import {
  foodMenuUrlsFrom,
  htmlLinks,
  pageStatesAFoodMenu,
  readVenueFoodPrices,
} from "../../../lib/harvest/ukFoodCrawl.ts";

/** What every row this lane writes may and may not be used for. */
export const FIRST_PARTY_FOOD_LICENCE =
  "All rights reserved — first-party publisher of its own pub menu/prices; attributed use only. No republishing of the source's own copy, only the price fact + observedAt + link back.";

export const DEFAULT_FOOD_PAGES_PER_HOST = 6;

/** Every outcome a host can end a run with. A skip is a finding. */
export const FOOD_HOST_OUTCOMES = [
  "priced",
  "no-menu-found",
  "refused-by-policy",
  "robots-disallowed",
  "robots-unreadable",
  "robots-unreachable",
  "failed",
  "budget-exhausted",
];

function hostOf(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function bytesOf(body) {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return null;
}

/**
 * Group harvest targets by host. A target is one pub:
 *   { venueId, venueKey, name, website?, menuUrls?: string[] }
 * The host is the pub's own website, or failing that its first menu URL.
 */
export function groupFoodTargetsByHost(targets) {
  const hosts = new Map();
  for (const pub of targets) {
    const entry = pub.website || (pub.menuUrls ?? [])[0];
    if (!entry) continue;
    let origin;
    try {
      origin = new URL(entry).origin;
    } catch {
      continue;
    }
    const host = hostOf(origin);
    const row = hosts.get(host) ?? { host, origin, pubs: [] };
    row.pubs.push({ ...pub, menuUrls: [...new Set(pub.menuUrls ?? [])] });
    hosts.set(host, row);
  }
  return [...hosts.values()];
}

/**
 * Read one page: policy, robots, served fetch, landing, then (when the served
 * document states no menu and rendering is on) a rendered fetch and its landing.
 */
async function readPage(url, deps, counters) {
  if (!isHarvestableOperatorUrl(url)) return { url, outcome: "refused-by-policy" };
  const robots = await deps.robots(url);
  if (!robots.allowed) return { url, outcome: robots.reason, robots };

  const attempts = deps.renderMode === "always" ? ["rendered"] : deps.renderMode === "never" ? ["served"] : ["served", "rendered"];
  let last = { url, outcome: "no-menu-found", robots };
  for (const via of attempts) {
    if (via === "rendered" && !deps.renderPage) continue;
    // A browser session costs money, so it has its own cap beside the page budget.
    if (via === "rendered" && !counters.spendRender()) {
      counters.renderSkipped += 1;
      continue;
    }
    if (!counters.spend()) return { ...last, outcome: "budget-exhausted" };
    let text;
    let format;
    let landedAsked;
    let readVia = via;
    let links = [];
    try {
      if (via === "served") {
        const response = await deps.fetchServed(url);
        landedAsked = response.url || url;
        const bytes = bytesOf(response.body);
        if (bytes && /pdf/i.test(response.contentType ?? "")) {
          text = await deps.readPdf(bytes);
          if (text == null) {
            counters.pdfUnread += 1;
            last = { url, outcome: "no-menu-found", robots, readVia: "pdf", unreadablePdf: true };
            break;
          }
          format = "text";
          readVia = "pdf";
        } else {
          if (!response.ok) {
            last = { url, outcome: "failed", robots, readVia, status: response.status };
            continue;
          }
          text = typeof response.body === "string" ? response.body : new TextDecoder().decode(bytes ?? new Uint8Array());
          format = "html";
          links = htmlLinks(text);
        }
      } else {
        const rendered = await deps.renderPage(url);
        landedAsked = rendered.finalUrl || url;
        text = rendered.markdown;
        format = "text";
        links = rendered.links ?? [];
      }
    } catch (error) {
      last = { url, outcome: "failed", robots, readVia, error: error instanceof Error ? error.message : String(error) };
      continue;
    }

    const landing = harvestRedirectLanding(url, landedAsked);
    if (landing.outcome === "refused") {
      return { url, outcome: "refused-by-policy", robots, readVia, landedOn: landing.url };
    }
    const reading = readVenueFoodPrices(text, format);
    const page = {
      url,
      landedOn: landing.url,
      outcome: pageStatesAFoodMenu(reading) ? "priced" : "no-menu-found",
      robots,
      readVia,
      reading,
      links,
    };
    if (page.outcome === "priced") return page;
    last = page;
  }
  return last;
}

/**
 * Why a whole host is not read this run (`refusal`), or the robots answer that
 * admitted it. A disallowed
 * home page is not a host refusal: its menu path may still be open, so that
 * one is asked per page.
 */
async function hostGate(entry, deps, pagesLeft) {
  if (pagesLeft <= 0) return { refusal: { outcome: "budget-exhausted" } };
  if (!isHarvestableOperatorUrl(entry.origin)) return { refusal: { outcome: "refused-by-policy" } };
  const robots = await deps.robots(`${entry.origin}/`);
  if (!robots.allowed && robots.reason !== "robots-disallowed") {
    return { refusal: { outcome: robots.reason, robots: robots.robots, evidence: robots.evidence } };
  }
  return { refusal: null, robots };
}

/** The host's pages: every curated menu URL first, else the food links its home page names. */
async function readHostPages(entry, deps, counters, { pagesPerHost, sleep, delayMs }) {
  const queue = [...new Set(entry.pubs.flatMap((pub) => pub.menuUrls))];
  const pages = [];
  if (queue.length === 0) {
    const home = await readPage(`${entry.origin}/`, deps, counters);
    pages.push(home);
    queue.push(...foodMenuUrlsFrom(home.links ?? [], entry.origin, pagesPerHost - 1));
  }
  for (const url of queue.slice(0, pagesPerHost - pages.length)) {
    if (pages.length > 0) await sleep(delayMs);
    pages.push(await readPage(url, deps, counters));
  }
  return pages;
}

/**
 * The rows a host's priced pages give its pubs. A curated pub's own menu URL
 * speaks for that pub; any other page must name the pub in its path on an
 * estate host. A priced page that names no pub is marked and gives nothing.
 */
function attributedRows(entry, pages, observedAt) {
  const seeds = new Set(entry.pubs.flatMap((pub) => pub.menuUrls));
  const rows = [];
  for (const page of pages) {
    if (page.outcome !== "priced") continue;
    const owners = entry.pubs.filter((pub) =>
      seeds.has(page.url) ? pub.menuUrls.includes(page.url) : pageMayPriceThisPub(page.landedOn, pub, entry.pubs.length),
    );
    if (owners.length === 0) {
      page.outcome = "estate-page-names-no-pub";
      continue;
    }
    for (const pub of owners) {
      for (const dish of page.reading.kept) {
        rows.push({
          venueKey: pub.venueKey,
          venueId: pub.venueId,
          itemName: dish.itemName,
          category: dish.category,
          priceGbp: dish.priceGbp,
          source: { label: `${entry.host} — the pub's own website`, url: page.landedOn, licence: FIRST_PARTY_FOOD_LICENCE },
          observedAt,
          readVia: page.readVia,
          quote: dish.quote,
        });
      }
    }
  }
  return rows;
}

/** One outcome for a host that was read: priced, or the one reason every page shares. */
function hostOutcome(pages, rowCount) {
  if (rowCount > 0) return "priced";
  if (pages.some((page) => page.outcome === "budget-exhausted")) return "budget-exhausted";
  for (const shared of ["refused-by-policy", "robots-disallowed", "failed"]) {
    if (pages.length > 0 && pages.every((page) => page.outcome === shared)) return shared;
  }
  return "no-menu-found";
}

function ledgerPage(page) {
  return {
    url: page.url,
    ...(page.landedOn && page.landedOn !== page.url ? { landedOn: page.landedOn } : {}),
    outcome: page.outcome,
    ...(page.readVia ? { readVia: page.readVia } : {}),
    dishes: page.reading?.kept.length ?? 0,
  };
}

/**
 * Harvest every host. Returns the ledger rows, the candidate food rows and the
 * run's counts. Writes nothing: ./run.mjs owns the files.
 */
export async function harvestFood(hostEntries, deps) {
  const now = deps.now ?? (() => new Date());
  const pagesPerHost = deps.pagesPerHost ?? DEFAULT_FOOD_PAGES_PER_HOST;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const delayMs = deps.delayMs ?? 1_500;
  let remaining = deps.pageBudget ?? Number.POSITIVE_INFINITY;
  let rendersLeft = deps.renderBudget ?? Number.POSITIVE_INFINITY;
  const counters = {
    pdfUnread: 0,
    renders: 0,
    renderSkipped: 0,
    spendRender() {
      if (rendersLeft <= 0) return false;
      rendersLeft -= 1;
      this.renders += 1;
      return true;
    },
    spend() {
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    },
  };
  const ledger = {};
  const rows = [];
  const drops = {};

  for (const entry of hostEntries) {
    const checkedAt = now().toISOString();
    const base = { host: entry.host, origin: entry.origin, pubs: entry.pubs.length, checkedAt };
    const gate = await hostGate(entry, deps, remaining);
    if (gate.refusal) {
      ledger[entry.host] = { ...base, ...gate.refusal, pagesRead: 0 };
      continue;
    }
    const pages = await readHostPages(entry, deps, counters, { pagesPerHost, sleep, delayMs });
    const hostRows = attributedRows(entry, pages, now().toISOString());
    rows.push(...hostRows);
    for (const page of pages) {
      for (const [reason, count] of Object.entries(page.reading?.drops ?? {})) {
        drops[reason] = (drops[reason] ?? 0) + count;
      }
    }
    ledger[entry.host] = {
      ...base,
      outcome: hostOutcome(pages, hostRows.length),
      robots: gate.robots.robots,
      pagesRead: pages.length,
      rows: hostRows.length,
      pages: pages.map(ledgerPage),
    };
  }

  const outcomes = Object.fromEntries(FOOD_HOST_OUTCOMES.map((name) => [name, 0]));
  for (const row of Object.values(ledger)) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  return {
    ledger,
    rows,
    summary: {
      hosts: hostEntries.length,
      outcomes,
      rows: rows.length,
      venuesPriced: new Set(rows.map((row) => row.venueKey)).size,
      drops,
      pdfUnread: counters.pdfUnread,
      renders: counters.renders,
      rendersSkippedOverBudget: counters.renderSkipped,
      pageBudgetLeft: Number.isFinite(remaining) ? remaining : null,
    },
  };
}
