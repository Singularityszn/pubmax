import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { writeMenuPageCache } from "@/scripts/lib/harvestMenuCache.mjs";

const REQUESTED_URL =
  "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu";
const FINAL_URL = `${REQUESTED_URL}?canonical=1`;
const VENUE_KEY = "prospect of whitby|1 test street|51.50000|-0.10000";
const temporaryRoots: string[] = [];

function write(root: string, path: string, source: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function makeFixture({ cached = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pubmax-gk-final-url-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts/firecrawl_greene_king_prices.mjs"),
    join(root, "scripts/firecrawl_greene_king_prices.mjs"),
  );
  copyFileSync(
    join(process.cwd(), "scripts/lib/harvestMenuCache.mjs"),
    join(root, "scripts/lib/harvestMenuCache.mjs"),
  );
  copyFileSync(
    join(process.cwd(), "scripts/lib/venueMatch.mjs"),
    join(root, "scripts/lib/venueMatch.mjs"),
  );
  write(
    root,
    "scripts/lib/localRefreshProviders.mjs",
    `export class RefreshProviderError extends Error {}
export const assertProviderCredentials = () => {};
export const discoverRefreshPages = async () => [];
`,
  );
  write(
    root,
    "scripts/lib/harvestMenuTransport.mjs",
    `export class HarvestMenuTransportError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const assertTransportCredentials = () => {};
export const parseMenuTransportArg = () => "browserbase";
export const createMenuPageHarvester = () => ({
  extractBudget: 1,
  extractsSpent: 0,
  validateResolvedMenuUrl: async (_requestedUrl, finalUrl) => {
    if (process.env.TEST_REFUSE_EXISTING === "1" && String(finalUrl).includes("stale=1")) {
      throw new HarvestMenuTransportError("policy-refused", "existing source refused");
    }
    if (process.env.TEST_REFUSE_LANDING === "1" && finalUrl === ${JSON.stringify(FINAL_URL)}) {
      throw new HarvestMenuTransportError("redirect-refused", "redirect landing refused");
    }
    return finalUrl;
  },
  fetchMenuPage: async () => {
    if (process.env.TEST_CACHE_ONLY === "1") throw new Error("valid cache must be used");
    if (process.env.TEST_REFUSE_TARGET === "1") {
      throw new HarvestMenuTransportError("policy-refused", "requested source refused");
    }
    return {
      markdown: ${JSON.stringify("### Soft Drinks\n\n#### Diet Coke\n\n£3.20\n")},
      finalUrl: ${JSON.stringify(FINAL_URL)},
    };
  },
});
`,
  );
  write(root, "data/greene_king_london_menu_urls.txt", `${REQUESTED_URL}\n`);
  write(root, "public/data/venue_menu_enrichment.json", '{"venues":{}}\n');
  write(
    root,
    "public/data/pint_prices_app_dataset.json",
    `${JSON.stringify([
      {
        pub_name: "Prospect of Whitby",
        address: "1 Test Street",
        latitude: 51.5,
        longitude: -0.1,
      },
    ])}\n`,
  );
  write(
    root,
    "public/data/drink_price_updates/latest.json",
    `${JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      updates: [
        {
          venueKey: VENUE_KEY,
          drinkName: "Diet Coke",
          category: "soft-drink",
          priceGbp: 3,
          source: { label: "Greene King — official menu", url: REQUESTED_URL },
          observedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          venueKey: VENUE_KEY,
          drinkName: "Old Lager",
          category: "beer",
          priceGbp: 5,
          source: { label: "Greene King — official menu", url: `${REQUESTED_URL}?stale=1` },
          observedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          venueKey: VENUE_KEY,
          drinkName: "Guest Cola",
          category: "soft-drink",
          priceGbp: 2.5,
          source: { label: "Other publisher", url: "https://other.example/menu" },
          observedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    })}\n`,
  );
  if (cached) {
    const markdownPath = join(
      root,
      ".firecrawl/menus/browserbase/prospect-of-whitby.md",
    );
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeMenuPageCache({
      requestedUrl: REQUESTED_URL,
      markdownPath,
      page: {
        markdown: "### Soft Drinks\n\n#### Diet Coke\n\n£3.20\n",
        finalUrl: FINAL_URL,
      },
    });
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Greene King resolved menu provenance", () => {
  it.each([{ cached: false }, { cached: true }])(
    "publishes the validated final URL when cached=$cached",
    ({ cached }) => {
      const root = makeFixture({ cached });
      const script = join(root, "scripts/firecrawl_greene_king_prices.mjs");
      const run = spawnSync(
        process.execPath,
        [
          script,
          "--limit",
          "1",
          "--urls-file",
          join(root, "data/greene_king_london_menu_urls.txt"),
          "--merge",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, ...(cached ? { TEST_CACHE_ONLY: "1" } : {}) },
        },
      );

      expect(run.status, run.stderr).toBe(0);
      const latest = JSON.parse(
        readFileSync(join(root, "public/data/drink_price_updates/latest.json"), "utf8"),
      );
      const refreshed = latest.updates.filter(
        (row: { venueKey?: string; drinkName?: string; source?: { label?: string } }) =>
          row.venueKey === VENUE_KEY &&
          row.drinkName === "Diet Coke" &&
          row.source?.label === "Greene King — official menu",
      );
      expect(refreshed).toEqual([
        expect.objectContaining({ source: expect.objectContaining({ url: FINAL_URL }) }),
      ]);
    },
  );

  it.each([
    {
      refusal: "requested source",
      cached: false,
      environment: { TEST_REFUSE_TARGET: "1" },
    },
    {
      refusal: "resolved landing",
      cached: true,
      environment: { TEST_REFUSE_LANDING: "1", TEST_CACHE_ONLY: "1" },
    },
  ])(
    "purges existing publisher rows for a refused $refusal",
    ({ cached, environment }) => {
      const root = makeFixture({ cached });
      const script = join(root, "scripts/firecrawl_greene_king_prices.mjs");
      const run = spawnSync(
        process.execPath,
        [
          script,
          "--limit",
          "1",
          "--urls-file",
          join(root, "data/greene_king_london_menu_urls.txt"),
          "--merge",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, ...environment },
        },
      );

      expect(run.status, run.stderr).toBe(0);
      const latest = JSON.parse(
        readFileSync(join(root, "public/data/drink_price_updates/latest.json"), "utf8"),
      );
      expect(
        latest.updates.filter(
          (row: { venueKey?: string; source?: { label?: string } }) =>
            row.venueKey === VENUE_KEY &&
            row.source?.label === "Greene King — official menu",
        ),
      ).toEqual([]);
      expect(latest.updates).toContainEqual(
        expect.objectContaining({ drinkName: "Guest Cola" }),
      );
    },
  );

  it("drops an existing Greene King row refused by current policy", () => {
    const root = makeFixture();
    const script = join(root, "scripts/firecrawl_greene_king_prices.mjs");
    const run = spawnSync(
      process.execPath,
      [
        script,
        "--limit",
        "1",
        "--urls-file",
        join(root, "data/greene_king_london_menu_urls.txt"),
        "--merge",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TEST_REFUSE_EXISTING: "1" },
      },
    );

    expect(run.status, run.stderr).toBe(0);
    const latest = JSON.parse(
      readFileSync(join(root, "public/data/drink_price_updates/latest.json"), "utf8"),
    );
    expect(latest.updates).not.toContainEqual(
      expect.objectContaining({ drinkName: "Old Lager" }),
    );
  });
});
