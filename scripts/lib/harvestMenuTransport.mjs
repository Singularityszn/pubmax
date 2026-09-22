/**
 * Menu page acquisition for chain drink harvesters.
 *
 * Tavily Extract and Browserbase are transports only: every URL is gated by
 * lib/harvest/sourcePolicy.ts before a provider call, and spacing honours the
 * chain source's crawl delay when recorded.
 */

import {
  harvestSourcesOfKind,
  isHarvestableChainMenuUrl,
} from "../../lib/harvest/sourcePolicy.ts";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";
import { fetchRefreshPage, providerForJob } from "./localRefreshProviders.mjs";
import {
  tavilyHarvestExtractCap,
  tavilyHarvestExtractEnvName,
} from "../../lib/paidSpendBudget.ts";

export const MENU_TRANSPORTS = Object.freeze({
  browserbase: "rendered-menu",
  playwright: "local-rendered-menu",
  tavily: "plain-page",
});

const GREENE_KING_SOURCE_ID = "greene-king-menu-prices";

export class HarvestMenuTransportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HarvestMenuTransportError";
    this.code = code;
  }
}

export function parseMenuTransportArg(argv = process.argv, defaultTransport = "browserbase") {
  const at = argv.indexOf("--transport");
  if (at === -1) return defaultTransport;
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) {
    throw new HarvestMenuTransportError("invalid-transport", "--transport requires browserbase or tavily");
  }
  if (value !== "browserbase" && value !== "tavily" && value !== "playwright") {
    throw new HarvestMenuTransportError(
      "invalid-transport",
      `--transport must be browserbase, playwright, or tavily, not ${value}`,
    );
  }
  return value;
}

export function refreshJobForTransport(transport) {
  const job = MENU_TRANSPORTS[transport];
  if (!job) throw new HarvestMenuTransportError("invalid-transport", `Unknown menu transport: ${transport}`);
  return job;
}

export function isKeylessMenuTransport(transport) {
  return transport === "playwright";
}

export function assertTransportCredentials(transport, environment = process.env) {
  if (transport === "playwright") return;
  const job = refreshJobForTransport(transport);
  providerForJob(job);
  const { key } = providerForJob(job);
  if (!environment?.[key]?.trim()) {
    const { provider } = providerForJob(job);
    throw new HarvestMenuTransportError(
      "missing-credential",
      `${provider} unavailable: missing ${key}`,
    );
  }
}

/** The soft-drinks lane needs per-request policy enforcement before each fetch. */
export function assertLocalPolicyEnforcedTransport(transport) {
  if (transport !== "playwright") {
    throw new HarvestMenuTransportError(
      "unsafe-transport",
      "soft-drinks harvest requires local Playwright so every browser request can be policy-checked",
    );
  }
}

function chainMenuCrawlDelayMs(sourceId = GREENE_KING_SOURCE_ID) {
  const source = harvestSourcesOfKind("chain-menu-prices").find((row) => row.id === sourceId);
  return (source?.crawlDelaySeconds ?? 1) * 1000;
}

export function createMenuPageHarvester({
  transport = "browserbase",
  sourceId = GREENE_KING_SOURCE_ID,
  associatedHosts = [],
  environment = process.env,
  fetchImpl = fetch,
  renderBrowserPage,
  fetchLocalPlaywrightMenuPage,
  robotsChecker = createRobotsChecker(),
  crawlDelayMs = chainMenuCrawlDelayMs(sourceId),
  extractBudget = tavilyHarvestExtractCap(environment),
} = {}) {
  const job = isKeylessMenuTransport(transport) ? null : refreshJobForTransport(transport);
  let extractsSpent = 0;
  let lastRequestAt = 0;
  let lastRobotsDisallowed = false;
  let lastFinalUrl = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForCrawlSpacing() {
    if (!crawlDelayMs) return;
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < crawlDelayMs) await sleep(crawlDelayMs - elapsed);
  }

  async function fetchMenuMarkdown(url) {
    lastFinalUrl = null;
    if (!isHarvestableChainMenuUrl(url, sourceId, associatedHosts)) {
      throw new HarvestMenuTransportError("policy-refused", `sourcePolicy refused ${url}`);
    }
    const robots = await robotsChecker(url);
    lastRobotsDisallowed = !robots.allowed;
    if (!robots.allowed) {
      throw new HarvestMenuTransportError(
        "robots-refused",
        `robots.txt refused ${url}: ${robots.evidence}`,
      );
    }
    if (transport === "tavily") {
      if (extractsSpent >= extractBudget) {
        throw new HarvestMenuTransportError(
          "tavily-budget-spent",
          `Tavily extract budget spent (${extractBudget} per run; override ${tavilyHarvestExtractEnvName()})`,
        );
      }
    }
    await waitForCrawlSpacing();
    let page;
    try {
      if (transport === "playwright") {
        const render =
          fetchLocalPlaywrightMenuPage ??
          (await import("./localPlaywrightMenuPage.mjs")).fetchLocalPlaywrightMenuPage;
        const rendered = await render(url, {
          sourceId,
          associatedHosts,
          robotsChecker,
          followMenuLink: sourceId === "youngs-menu-prices",
        });
        page = { markdown: rendered.markdown, links: rendered.links, finalUrl: rendered.finalUrl ?? rendered.url ?? url };
      } else {
        page = await fetchRefreshPage({
          job,
          url,
          environment,
          fetchImpl,
          ...(renderBrowserPage ? { renderBrowserPage } : {}),
        });
      }
    } finally {
      lastRequestAt = Date.now();
    }
    const finalUrl = page.finalUrl ?? page.url ?? url;
    if (!isHarvestableChainMenuUrl(finalUrl, sourceId, associatedHosts)) {
      throw new HarvestMenuTransportError("policy-refused", `redirect landed on refused URL ${finalUrl}`);
    }
    if (new URL(finalUrl).origin !== new URL(url).origin) {
      throw new HarvestMenuTransportError("redirect-refused", `cross-origin menu redirect refused: ${url}`);
    }
    lastFinalUrl = finalUrl;
    if (transport === "tavily") extractsSpent += 1;
    return page.markdown;
  }

  return {
    transport,
    job,
    crawlDelayMs,
    extractBudget,
    get extractsSpent() {
      return extractsSpent;
    },
    fetchMenuMarkdown,
    get lastRobotsDisallowed() {
      return lastRobotsDisallowed;
    },
    get lastFinalUrl() {
      return lastFinalUrl;
    },
    waitForCrawlSpacing,
    markRequestCompleted() {
      lastRequestAt = Date.now();
    },
  };
}
