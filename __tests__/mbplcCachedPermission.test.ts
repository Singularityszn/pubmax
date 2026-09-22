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

const temporaryRoots: string[] = [];

function write(root: string, path: string, source: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pubmax-mbplc-cache-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts/firecrawl_mbplc_prices.mjs"),
    join(root, "scripts/firecrawl_mbplc_prices.mjs"),
  );

  write(
    root,
    "scripts/lib/venueMatch.mjs",
    `export const buildVenueIndexes = () => ({});
export const mergeDrinkUpdates = (existing, incoming) => [...existing, ...incoming];
export const resolveVenueKeyFromHints = () => null;
export const resolveVenueKeyFromPubName = () => "cached-nicholson|london";
export const slugFromMbplcDrinksUrl = () => "cached-nicholson";
`,
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
  fetchMenuMarkdown: async () => { throw new Error("provider must not be called for cached markdown"); },
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
    "https://www.nicholsonspubs.co.uk/restaurants/london/cached-nicholson/drinks\n",
  );
  write(root, "public/data/pint_prices_app_dataset.json", "[{}]\n");
  write(
    root,
    ".firecrawl/menus/nicholsons/cached-nicholson.md",
    "## Cached Nicholson\n\n### Draught Beer\n\n#### House Lager\n\n£6.20\n",
  );
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
    expect(latest.updates).toEqual([]);
    expect(run.stdout).toContain("refused=1");
  });
});
