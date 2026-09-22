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

const REQUESTED_URL =
  "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu";
const FINAL_URL = `${REQUESTED_URL}?canonical=1`;
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

  write(
    root,
    "scripts/lib/venueMatch.mjs",
    `export const GK_SLUG_HINTS = {};
export const buildVenueIndexes = () => ({
  idToKey: new Map([["venue-prospect", "prospect-of-whitby|london"]]),
  nameToKeys: new Map(),
});
export const menuUrlToVenueId = () => new Map([[${JSON.stringify(REQUESTED_URL)}, "venue-prospect"]]);
export const mergeDrinkUpdates = (existing, incoming) => [...existing, ...incoming];
export const normalisePubName = (value) => String(value ?? "").toLowerCase();
export const resolveVenueKeyFromHints = () => null;
`,
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
  validateResolvedMenuUrl: async (_requestedUrl, finalUrl) => finalUrl,
  fetchMenuPage: async () => ({
    markdown: ${JSON.stringify("### Soft Drinks\n\n#### Diet Coke\n\n£3.20\n")},
    finalUrl: ${JSON.stringify(FINAL_URL)},
  }),
});
`,
  );
  write(root, "data/greene_king_london_menu_urls.txt", `${REQUESTED_URL}\n`);
  write(root, "public/data/venue_menu_enrichment.json", '{"venues":{}}\n');
  write(root, "public/data/pint_prices_app_dataset.json", "[{}]\n");
  if (cached) {
    write(
      root,
      ".firecrawl/menus/browserbase/prospect-of-whitby.md",
      "### Soft Drinks\n\n#### Diet Coke\n\n£3.20\n",
    );
    write(
      root,
      ".firecrawl/menus/browserbase/prospect-of-whitby.md.source.json",
      `${JSON.stringify({ requestedUrl: REQUESTED_URL, finalUrl: FINAL_URL })}\n`,
    );
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
        [script, "--limit", "1", "--urls-file", join(root, "data/greene_king_london_menu_urls.txt")],
        { cwd: root, encoding: "utf8", env: process.env },
      );

      expect(run.status, run.stderr).toBe(0);
      const latest = JSON.parse(
        readFileSync(join(root, "public/data/drink_price_updates/latest.json"), "utf8"),
      );
      expect(latest.updates).toEqual([
        expect.objectContaining({
          venueKey: "prospect-of-whitby|london",
          source: expect.objectContaining({ url: FINAL_URL }),
        }),
      ]);
    },
  );
});
