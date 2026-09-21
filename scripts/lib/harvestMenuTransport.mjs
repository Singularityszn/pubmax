/**
 * Menu page acquisition for chain drink harvesters.
 *
 * Tavily Extract and Browserbase are transports only: every URL is gated by
 * lib/harvest/sourcePolicy.ts before a provider call, and spacing honours the
 * chain source's crawl delay when recorded.
 */

import { harvestSourcesOfKind, isHarvestableOperatorUrl } from "../../lib/harvest/sourcePolicy.ts";
import { fetchRefreshPage, providerForJob } from "./localRefreshProviders.mjs";
import {
  tavilyHarvestExtractCap,
  tavilyHarvestExtractEnvName,
} from "../../lib/paidSpendBudget.ts";

export const MENU_TRANSPORTS = Object.freeze({
  browserbase: "rendered-menu",
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

export function parseMenuTransportArg(argv = process.argv) {
  const at = argv.indexOf("--transport");
  if (at === -1) return "browserbase";
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) {
    throw new HarvestMenuTransportError("invalid-transport", "--transport requires browserbase or tavily");
  }
  if (value !== "browserbase" && value !== "tavily") {
    throw new HarvestMenuTransportError(
      "invalid-transport",
      `--transport must be browserbase or tavily, not ${value}`,
    );
  }
  return value;
}

export function refreshJobForTransport(transport) {
  const job = MENU_TRANSPORTS[transport];
  if (!job) throw new HarvestMenuTransportError("invalid-transport", `Unknown menu transport: ${transport}`);
  return job;
}

export function assertTransportCredentials(transport, environment = process.env) {
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

function chainMenuCrawlDelayMs(sourceId = GREENE_KING_SOURCE_ID) {
  const source = harvestSourcesOfKind("chain-menu-prices").find((row) => row.id === sourceId);
  return (source?.crawlDelaySeconds ?? 1) * 1000;
}

export function createMenuPageHarvester({
  transport = "browserbase",
  sourceId = GREENE_KING_SOURCE_ID,
  environment = process.env,
  fetchImpl = fetch,
  renderBrowserPage,
  crawlDelayMs = chainMenuCrawlDelayMs(sourceId),
  extractBudget = tavilyHarvestExtractCap(environment),
} = {}) {
  const job = refreshJobForTransport(transport);
  let extractsSpent = 0;
  let lastRequestAt = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForCrawlSpacing() {
    if (!crawlDelayMs) return;
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < crawlDelayMs) await sleep(crawlDelayMs - elapsed);
  }

  async function fetchMenuMarkdown(url) {
    if (!isHarvestableOperatorUrl(url)) {
      throw new HarvestMenuTransportError("policy-refused", `sourcePolicy refused ${url}`);
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
    const page = await fetchRefreshPage({
      job,
      url,
      environment,
      fetchImpl,
      ...(renderBrowserPage ? { renderBrowserPage } : {}),
    });
    lastRequestAt = Date.now();
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
  };
}
