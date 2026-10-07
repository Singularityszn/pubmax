#!/usr/bin/env node
// The Context.dev half of the UK price crawl, behind a flag.
//
//   PUBMAX_UK_PRICES_CONTEXT_DEV=1 npx tsx scripts/harvest/uk-prices/context-dev.mjs <url>
//
// WHY A THIRD READER. scripts/harvest/uk-prices/run.mjs reads what a page
// SERVES and scripts/harvest/uk-prices/render.mjs reads what a page SHOWS
// through a local browser. This one reads what a page shows through
// Context.dev, which is a hosted renderer with a cache. It exists so the crawl
// can take that lane later without a rewrite: the reader below hands its
// Markdown to the SAME lib/harvest/ukPriceCrawl.ts rules both other lanes use,
// and returns the same outcome vocabulary render.mjs already writes to its
// ledger.
//
// WHAT THIS DOES NOT CHANGE.
//
//   * PERMISSION. lib/harvest/sourcePolicy.ts and lib/harvest/robots.ts stay
//     the gate. Context.dev is a FETCH LAYER, NEVER A PERMISSION, so this lane
//     hands the wrapper a live robots checker and the wrapper refuses any host
//     the table refuses. A refusal is recorded and costs no credit.
//   * WHAT COUNTS AS A PRICE. Verbatim on the page, a drink word beside it, no
//     food word, no offer wording, and a page that states a list rather than a
//     banner. None of that is re-decided here.
//   * SPEND. One page is one credit. The run carries a shared budget, so a
//     retry storm spends the run rather than the account.
//
// IT IS OFF BY DEFAULT. `contextDevPriceLaneEnabled` must answer true, which
// takes both the flag and a configured key: a lane that silently turned itself
// on the day a key landed in the environment would spend credits nobody asked
// for.

import process from "node:process";

import {
  createContextDevBudget,
  isContextDevConfigured,
  scrapeMarkdown,
} from "../../../lib/contextDev.ts";
import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import {
  cheapestPerCategory,
  pageStatesADrinksList,
  readVenueDrinkPrices,
  renderLooksEmpty,
} from "../../../lib/harvest/ukPriceCrawl.ts";

/** The flag that turns this lane on. */
export const CONTEXT_DEV_PRICE_LANE_FLAG = "PUBMAX_UK_PRICES_CONTEXT_DEV";

/**
 * How old a cached page may be before Context.dev refetches it.
 *
 * A price is a claim about tonight, so a week is the most a menu read may be
 * and still be worth writing down with today's `observedAt`.
 */
const CONTEXT_DEV_PRICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/** Pages one run of this lane may read, so a bounded trial stays bounded. */
const CONTEXT_DEV_PRICE_PAGE_BUDGET = 25;

/**
 * True when this lane may run: the flag is set AND a key is configured.
 *
 * Both, deliberately. The flag alone would fail every page for want of a key,
 * and the key alone would start spending on a lane nobody switched on.
 */
export function contextDevPriceLaneEnabled(env = process.env) {
  return env[CONTEXT_DEV_PRICE_LANE_FLAG] === "1" && isContextDevConfigured(env);
}

/**
 * Build the reader. One robots checker and one budget for the whole run, so a
 * host is asked for its rules once and the ceiling is what this run may put on
 * the account.
 */
export function createContextDevPriceReader(options = {}) {
  const robots = options.robots ?? createRobotsChecker();
  const budget = options.budget ?? createContextDevBudget(options.pageBudget ?? CONTEXT_DEV_PRICE_PAGE_BUDGET);
  const maxAgeMs = options.maxAgeMs ?? CONTEXT_DEV_PRICE_MAX_AGE_MS;
  const env = options.env ?? process.env;
  // The transport seam, so a test never reaches the live API.
  const fetchImpl = options.fetchImpl;

  /**
   * Read one menu page and price it.
   *
   * Answers `{ outcome, rows }` in render.mjs's own vocabulary, so a ledger
   * written by either lane reads the same way. `rows` is empty for every
   * outcome but `priced`.
   */
  async function readPricesFrom(url) {
    const result = await scrapeMarkdown(url, {
      env,
      robots,
      budget,
      maxAgeMs,
      ...(fetchImpl ? { fetchImpl } : {}),
    });

    if (result.status === "not-configured") {
      return { outcome: "context-dev-not-configured", rows: [] };
    }
    if (result.status === "error") {
      // A refusal is a finding about PERMISSION and is named as one; everything
      // else is a fact about the fetch.
      const refusal =
        result.error.code === "SOURCE_REFUSED" ||
        result.error.code === "ROBOTS_REFUSED" ||
        result.error.code === "ROBOTS_UNCHECKED";
      return {
        outcome: refusal ? "refused" : "fetch-failed",
        rows: [],
        reason: result.error.code,
        // The batch lane reads this to tell a spent account from a bad page.
        ...(result.error.statusCode ? { statusCode: result.error.statusCode } : {}),
        evidence: result.error.message,
      };
    }
    // An empty render is a fact about US, not about the pub, so it is its own
    // outcome rather than a pub that states no price.
    if (renderLooksEmpty(result.markdown)) {
      return { outcome: "render-empty", rows: [] };
    }

    const reading = readVenueDrinkPrices(result.markdown);
    if (!pageStatesADrinksList(reading)) {
      return { outcome: "menu-states-no-price", rows: [] };
    }
    return {
      outcome: "priced",
      rows: cheapestPerCategory(reading).map((row) => ({
        category: row.category,
        priceGbp: row.priceGbp,
        ...(row.drinkLabel ? { drinkLabel: row.drinkLabel } : {}),
        ...(row.servingSize ? { servingSize: row.servingSize } : {}),
        sourceUrl: result.url || url,
        observedAt: new Date().toISOString(),
        linesOnPage: reading.kept.length,
        reader: "context.dev",
      })),
    };
  }

  return { readPricesFrom, budget };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: context-dev.mjs <url>");
    process.exitCode = 2;
    return;
  }
  if (!contextDevPriceLaneEnabled()) {
    console.error(
      `${CONTEXT_DEV_PRICE_LANE_FLAG}=1 and CONTEXT_DEV_API_KEY are both needed; this lane stayed off.`,
    );
    process.exitCode = 2;
    return;
  }
  const reader = createContextDevPriceReader();
  const answer = await reader.readPricesFrom(url);
  console.log(JSON.stringify({ url, ...answer, creditsSpent: reader.budget.spent() }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
