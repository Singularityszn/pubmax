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
  "https://www.nicholsonspubs.co.uk/restaurants/london/cached-nicholson/drinks";
const FINAL_URL = `${REQUESTED_URL}?canonical=1`;
const VENUE_KEY = "cached nicholson|1 test street|51.50000|-0.10000";
const temporaryRoots: string[] = [];

function write(root: string, path: string, source: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pubmax-mbplc-cache-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts/firecrawl_mbplc_prices.mjs"),
    join(root, "scripts/firecrawl_mbplc_prices.mjs"),
  );
  copyFileSync(
    join(process.cwd(), "scripts/lib/harvestMenuCache.mjs"),
    join(root, "scripts/lib/harvestMenuCache.mjs"),
  );
  copyFileSync(
    join(process.cwd(), "scripts/lib/menuSectionCategory.mjs"),
    join(root, "scripts/lib/menuSectionCategory.mjs"),
  );

  copyFileSync(
    join(process.cwd(), "scripts/lib/venueMatch.mjs"),
    join(root, "scripts/lib/venueMatch.mjs"),
  );
  write(
    root,
    "scripts/lib/localRefreshProviders.mjs",
    `export const assertProviderCredentials = () => {};
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
  validateResolvedMenuUrl: async (_requestedUrl, finalUrl) => {
    if (process.env.TEST_REFUSE_LANDING === "1" && finalUrl === ${JSON.stringify(FINAL_URL)}) {
      throw new HarvestMenuTransportError("policy-refused", "redirect landing refused");
    }
    return finalUrl;
  },
  fetchMenuPage: async () => { throw new Error("provider must not be called for cached markdown"); },
});
`,
  );
  write(
    root,
    "lib/harvest/sourcePolicy.ts",
    `export const isHarvestableChainMenuUrl = () => process.env.TEST_SOURCE_ALLOWED === "1";
`,
  );
  write(
    root,
    "lib/harvest/robots.ts",
    `export const createRobotsChecker = () => async () => ({
  allowed: process.env.TEST_ROBOTS_ALLOWED === "1",
  evidence: "fixture robots decision",
});
`,
  );
  write(
    root,
    "data/nicholsons_london_drink_urls.txt",
    `${REQUESTED_URL}\n`,
  );
  write(
    root,
    "public/data/pint_prices_app_dataset.json",
    `${JSON.stringify([
      {
        pub_name: "Cached Nicholson",
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
          drinkName: "House Lager",
          category: "beer",
          priceGbp: 6.2,
          source: {
            label: "Nicholson's — official drinks menu",
            url: REQUESTED_URL,
          },
          observedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          venueKey: "other-pub|london",
          drinkName: "Other Lager",
          category: "beer",
          priceGbp: 5.9,
          source: {
            label: "Other pub — official menu",
            url: "https://other-pub.example/menu",
          },
          observedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    })}\n`,
  );
  const markdownPath = join(
    root,
    ".firecrawl/menus/nicholsons/cached-nicholson.md",
  );
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeMenuPageCache({
    requestedUrl: REQUESTED_URL,
    markdownPath,
    page: {
      markdown: "## Cached Nicholson\n\n### Draught Beer\n\n#### House Lager\n\n£6.20\n",
      finalUrl: FINAL_URL,
    },
  });
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("legacy Nicholson cache permission", () => {
  it.each([
    { sourceAllowed: false, robotsAllowed: true, refusal: "source policy" },
    { sourceAllowed: true, robotsAllowed: false, refusal: "robots" },
  ])("does not republish cached markdown refused by $refusal", ({ sourceAllowed, robotsAllowed }) => {
    const root = makeFixture();
    const script = join(root, "scripts/firecrawl_mbplc_prices.mjs");
    const run = spawnSync(process.execPath, [script, "--limit", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_SOURCE_ALLOWED: sourceAllowed ? "1" : "0",
        TEST_ROBOTS_ALLOWED: robotsAllowed ? "1" : "0",
      },
    });

    expect(run.status, run.stderr).toBe(0);
    const latest = JSON.parse(
      readFileSync(join(root, "public/data/drink_price_updates/latest.json"), "utf8"),
    );
    expect(latest.updates).toEqual([
      expect.objectContaining({
        venueKey: "other-pub|london",
        drinkName: "Other Lager",
      }),
    ]);
    expect(run.stdout).toContain("refused=1");
  });

  it("replaces the cached publisher row with one validated-final-URL row", () => {
    const root = makeFixture();
    const script = join(root, "scripts/firecrawl_mbplc_prices.mjs");
    const run = spawnSync(process.execPath, [script, "--limit", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_SOURCE_ALLOWED: "1",
        TEST_ROBOTS_ALLOWED: "1",
      },
    });

    expect(run.status, run.stderr).toBe(0);
    const latest = JSON.parse(
      readFileSync(join(root, "public/data/drink_price_updates/latest.json"), "utf8"),
    );
    const refreshed = latest.updates.filter(
      (row: { venueKey?: string; drinkName?: string; source?: { label?: string } }) =>
        row.venueKey === VENUE_KEY &&
        row.drinkName === "House Lager" &&
        row.source?.label === "Nicholson's — official drinks menu",
    );
    expect(refreshed).toEqual([
      expect.objectContaining({ source: expect.objectContaining({ url: FINAL_URL }) }),
    ]);
  });

  it("purges existing publisher rows when the resolved cache landing is refused", () => {
    const root = makeFixture();
    const script = join(root, "scripts/firecrawl_mbplc_prices.mjs");
    const run = spawnSync(process.execPath, [script, "--limit", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_SOURCE_ALLOWED: "1",
        TEST_ROBOTS_ALLOWED: "1",
        TEST_REFUSE_LANDING: "1",
      },
    });

    expect(run.status, run.stderr).toBe(0);
    const latest = JSON.parse(
      readFileSync(join(root, "public/data/drink_price_updates/latest.json"), "utf8"),
    );
    expect(
      latest.updates.filter(
        (row: { venueKey?: string; source?: { label?: string } }) =>
          row.venueKey === VENUE_KEY &&
          row.source?.label === "Nicholson's — official drinks menu",
      ),
    ).toEqual([]);
    expect(latest.updates).toContainEqual(
      expect.objectContaining({ drinkName: "Other Lager" }),
    );
  });
});
