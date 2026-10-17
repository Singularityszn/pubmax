// scripts/refresh_drink_prices.mjs used to read robots.txt with a bespoke parser
// that failed OPEN (a 401, 403 or challenge page became "no rules"), read only
// the `*` group and never asked lib/harvest/sourcePolicy.ts. It also rewrote
// public/data/drink_price_updates/latest.json with this run's rows alone. These
// pins hold the replacement: the policy row first, lib/harvest/robots.ts second,
// and a merge that keeps every other lane's rows.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HarvestSource } from "@/lib/harvest/sourcePolicy";

const policy = vi.hoisted(() => ({ grants: new Map<string, unknown>() }));

// A test may GRANT a row that the table refuses, to prove what happens after
// permission. Nothing outside this file can do that.
vi.mock("@/lib/harvest/sourcePolicy.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harvest/sourcePolicy")>();
  return {
    ...actual,
    harvestSource: (id: string) => policy.grants.get(id) ?? actual.harvestSource(id),
  };
});

import { harvestSource } from "@/lib/harvest/sourcePolicy";
import {
  DRINK_SOURCE_POLICY_IDS,
  fetchFromDrinkSource,
  planLatestDrinkWrite,
  reviewBranchName,
  type DrinkSourceAllowlistRow,
} from "@/scripts/refresh_drink_prices.mjs";

const ROOT = join(__dirname, "..");
const WETHERSPOONS = (
  JSON.parse(readFileSync(join(ROOT, "data/price_sources.json"), "utf8")).drinkSources as DrinkSourceAllowlistRow[]
).find((row) => row.id === "wetherspoons-official") as DrinkSourceAllowlistRow;

const ROBOTS_URL = "https://www.jdwetherspoon.com/robots.txt";
const SITEMAP_URL = "https://www.jdwetherspoon.com/pub-menus-sitemap.xml";
const CHALLENGE = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>";

function grantWetherspoonMenuRow() {
  const real = harvestSource("wetherspoon-menu-prices") as HarvestSource;
  policy.grants.set("wetherspoon-menu-prices", {
    ...real,
    access: { allowed: true, evidence: "test grant", checkedOn: "2026-10-16" },
  });
}

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  });
}

const fetchedUrls = (mock: ReturnType<typeof fakeFetch>) => mock.mock.calls.map(([input]) => String(input));
const noSleep = async () => {};

afterEach(() => {
  policy.grants.clear();
  vi.restoreAllMocks();
});

describe("refresh_drink_prices: the policy row comes first", () => {
  it("maps the Wetherspoon drink source to its sourcePolicy row", () => {
    expect(DRINK_SOURCE_POLICY_IDS["wetherspoons-official"]).toBe("wetherspoon-menu-prices");
  });

  it("makes NO request at all while wetherspoon-menu-prices is refused", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = fakeFetch({});
    const result = await fetchFromDrinkSource(WETHERSPOONS, { fetchImpl, sleep: noSleep });
    expect(result.rows).toEqual([]);
    expect(result.refused).toMatch(/^REFUSED wetherspoon-menu-prices: .*publishes-no-web-price/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("refresh_drink_prices: robots.txt is read by lib/harvest/robots.ts", () => {
  const refusals: Array<[string, () => Response]> = [
    ["401", () => new Response("", { status: 401 })],
    ["403", () => new Response("Forbidden", { status: 403 })],
    ["a 200 challenge page", () => new Response(CHALLENGE, { status: 200 })],
    ["a 503", () => new Response("down", { status: 503 })],
    [
      "a Disallow naming the renderer class",
      () => new Response("User-agent: *\nDisallow:\n\nUser-agent: CloudflareBrowserRenderingCrawler\nDisallow: /\n"),
    ],
  ];

  for (const [label, robots] of refusals) {
    it(`refuses on ${label} and fetches no page`, async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      grantWetherspoonMenuRow();
      const fetchImpl = fakeFetch({ [ROBOTS_URL]: robots });
      const result = await fetchFromDrinkSource(WETHERSPOONS, { fetchImpl, sleep: noSleep });
      expect(result.refused).toMatch(/^REFUSED /);
      expect(result.rows).toEqual([]);
      expect(fetchedUrls(fetchImpl)).toEqual([ROBOTS_URL]);
    });
  }

  it("reads a robots.txt 404 as permission, and never follows an off-host <loc>", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    grantWetherspoonMenuRow();
    const fetchImpl = fakeFetch({
      [ROBOTS_URL]: () => new Response("", { status: 404 }),
      [SITEMAP_URL]: () =>
        new Response(
          "<urlset><url><loc>https://evil.example/pub-menus/the-moon-under-water-camden/</loc></url></urlset>",
        ),
    });
    const result = await fetchFromDrinkSource(WETHERSPOONS, { fetchImpl, sleep: noSleep });
    expect(result.refused).toBeNull();
    expect(fetchedUrls(fetchImpl)).toEqual([ROBOTS_URL, SITEMAP_URL]);
  });
});

describe("refresh_drink_prices: latest.json keeps every other lane", () => {
  const row = (label: string, drinkName: string) => ({
    venueKey: `venue|${drinkName}`,
    drinkName,
    category: "beer",
    priceGbp: 5,
    observedAt: "2026-10-01T00:00:00.000Z",
    source: { label, url: "https://example.co.uk/menu", licence: "test" },
  });

  it("replaces only this run's publisher and keeps the rest", () => {
    const greeneKing = Array.from({ length: 20 }, (_, i) => row("Greene King — official menu", `gk-${i}`));
    const oldSpoons = [row("J D Wetherspoon — official site (per-pub menus)", "old")];
    const incoming = [row("J D Wetherspoon — official site (per-pub menus)", "new")];
    const plan = planLatestDrinkWrite({ existing: [...greeneKing, ...oldSpoons], incoming });
    expect(plan.ok).toBe(true);
    expect(plan.replaced).toBe(1);
    expect(plan.merged).toHaveLength(21);
    expect(plan.merged).toEqual(expect.arrayContaining([...greeneKing, ...incoming]));
    expect(plan.merged).not.toContainEqual(oldSpoons[0]);
  });

  it("refuses a write that would drop a large share of the committed rows", () => {
    const existing = Array.from({ length: 10 }, (_, i) => row("J D Wetherspoon — official site (per-pub menus)", `d-${i}`));
    const plan = planLatestDrinkWrite({
      existing,
      incoming: [row("J D Wetherspoon — official site (per-pub menus)", "only")],
    });
    expect(plan.ok).toBe(false);
    expect(plan.message).toMatch(/^REFUSED write: the merge would leave 1 of 10 existing rows/);
  });

  it("names a review branch per run, so a same-day rerun does not collide", () => {
    const first = reviewBranchName(new Date("2026-10-16T07:30:00Z"));
    const second = reviewBranchName(new Date("2026-10-16T09:05:12Z"));
    expect(first).toBe("drink-price-refresh/20261016-073000");
    expect(second).not.toBe(first);
  });
});
