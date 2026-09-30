import { describe, expect, it, vi } from "vitest";

import {
  CONTEXT_DEV_PRICE_LANE_FLAG,
  contextDevPriceLaneEnabled,
  createContextDevPriceReader,
  // @ts-expect-error - a plain-ESM harvest CLI module with no type sidecar.
} from "../scripts/harvest/uk-prices/context-dev.mjs";
import type { RobotsChecker } from "@/lib/harvest/robots";

const KEY = { CONTEXT_DEV_API_KEY: "ctx-key" } as unknown as NodeJS.ProcessEnv;
const MENU_URL = "https://www.some-free-house.co.uk/drinks";

function scrapeMarkdownResponse(markdown: string) {
  return new Response(JSON.stringify({
    url: MENU_URL,
    markdown: { requested: true, success: true, data: markdown },
  }), { headers: { "content-type": "application/json" } });
}

function allowRobots(): RobotsChecker {
  return async () => ({ allowed: true, reason: "allowed", evidence: "stub" });
}

function refuseRobots(): RobotsChecker {
  return async () => ({
    allowed: false,
    reason: "robots-disallowed",
    evidence: "/robots.txt disallows /drinks.",
  });
}

/**
 * A drinks list the shared price rules accept.
 *
 * It runs past EMPTY_RENDER_MAX_CHARS on purpose: a page shorter than that is
 * one that has not finished assembling itself, and this fixture is meant to be
 * a menu a reader could actually stand and read.
 */
const PRICED_MENU = [
  "# Drinks at The Free House",
  "",
  "Served from noon until close, seven days a week. Every keg line is listed",
  "below with the price of a pint. Halves are poured at half the listed price.",
  "",
  "## On tap",
  "",
  "Camden Hells Lager pint £5.40",
  "Guinness Draught pint £6.10",
  "Beavertown Neck Oil pint £5.80",
  "Timothy Taylor Landlord pint £5.20",
  "Thatchers Gold cider pint £5.60",
  "",
  "## Wine and spirits",
  "",
  "House red wine 175ml £6.50",
  "House white wine 175ml £6.50",
  "Gordon's gin single £4.80",
].join("\n");

describe("the flag", () => {
  it("needs BOTH the flag and a configured key", () => {
    expect(contextDevPriceLaneEnabled({ [CONTEXT_DEV_PRICE_LANE_FLAG]: "1", ...KEY })).toBe(true);
    expect(contextDevPriceLaneEnabled({ ...KEY })).toBe(false);
    expect(contextDevPriceLaneEnabled({ [CONTEXT_DEV_PRICE_LANE_FLAG]: "1" })).toBe(false);
    expect(contextDevPriceLaneEnabled({})).toBe(false);
  });
});

describe("readPricesFrom", () => {
  it("preserves distinct printed wine measures in output rows", async () => {
    const reader = createContextDevPriceReader({
      env: KEY,
      robots: allowRobots(),
      fetchImpl: async () => scrapeMarkdownResponse(
        `${PRICED_MENU}\n<p>Chardonnay, France<br />125ml £5.50 250ml £11.00</p>`,
      ),
    });
    const answer = await reader.readPricesFrom(MENU_URL);
    expect(answer.outcome).toBe("priced");
    expect(answer.rows.filter((row: { drinkLabel?: string }) => row.drinkLabel === "Chardonnay, France"))
      .toEqual([
        expect.objectContaining({ servingSize: "125ml", priceGbp: 5.5 }),
        expect.objectContaining({ servingSize: "250ml", priceGbp: 11 }),
      ]);
  });

  it("hands the markdown to the shared price rules and prices the page", async () => {
    const fetchImpl = vi.fn(async () =>
      scrapeMarkdownResponse(PRICED_MENU),
    );
    const reader = createContextDevPriceReader({
      env: KEY,
      robots: allowRobots(),
      fetchImpl,
    });
    const answer = await reader.readPricesFrom(MENU_URL);
    expect(answer.outcome).toBe("priced");
    expect(answer.rows.length).toBeGreaterThan(0);
    for (const row of answer.rows) {
      expect(row.sourceUrl).toBe(MENU_URL);
      expect(row.reader).toBe("context.dev");
      expect(typeof row.priceGbp).toBe("number");
    }
  });

  it("names a robots refusal a refusal, and spends no credit on it", async () => {
    const fetchImpl = vi.fn();
    const reader = createContextDevPriceReader({
      env: KEY,
      robots: refuseRobots(),
      fetchImpl,
    });
    const answer = await reader.readPricesFrom(MENU_URL);
    expect(answer.outcome).toBe("refused");
    expect(answer.reason).toBe("ROBOTS_REFUSED");
    expect(answer.rows).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reader.budget.spent()).toBe(0);
  });

  it("separates a page that renders empty from a page that states no price", async () => {
    const empty = createContextDevPriceReader({
      env: KEY,
      robots: allowRobots(),
      fetchImpl: vi.fn(async () =>
        scrapeMarkdownResponse("  "),
      ),
    });
    expect((await empty.readPricesFrom(MENU_URL)).outcome).toBe("render-empty");

    const wordy = createContextDevPriceReader({
      env: KEY,
      robots: allowRobots(),
      fetchImpl: vi.fn(async () =>
        scrapeMarkdownResponse(`# Our pub\n${"We have been pouring since 1897. ".repeat(40)}`),
      ),
    });
    expect((await wordy.readPricesFrom(MENU_URL)).outcome).toBe("menu-states-no-price");
  });

  it("answers not-configured rather than pricing anything without a key", async () => {
    const fetchImpl = vi.fn();
    const reader = createContextDevPriceReader({
      env: {} as unknown as NodeJS.ProcessEnv,
      robots: allowRobots(),
      fetchImpl,
    });
    const answer = await reader.readPricesFrom(MENU_URL);
    expect(answer.outcome).toBe("context-dev-not-configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
