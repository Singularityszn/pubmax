import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
  const root = mkdtempSync(join(tmpdir(), "pubmax-outer-discovery-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts/harvest_outer_london_prices.mjs"),
    join(root, "scripts/harvest_outer_london_prices.mjs"),
  );

  write(
    root,
    "scripts/harvest/uk-prices/readPrices.mjs",
    `export const CATEGORY_PRICE_BANDS = { beer: { minGbp: 3, maxGbp: 9.5 } };
`,
  );
  write(
    root,
    "scripts/lib/tavilyPubEnrichment.mjs",
    `export const extractVenueDrinkPricesMaybeJudged = async () => ({ drinks: [], reading: {} });
`,
  );
  write(
    root,
    "scripts/lib/localRefreshProviders.mjs",
    `export class RefreshProviderError extends Error {
  constructor(provider, message) { super(message); this.provider = provider; }
}
export const assertProviderCredentials = () => {};
let discoveryCalls = 0;
export const discoverRefreshPages = async ({ includeDomains }) => {
  discoveryCalls += 1;
  if (discoveryCalls === 1) {
    throw new RefreshProviderError("exa", "exa refused request: HTTP 429 Too Many Requests");
  }
  return [{ url: "https://" + includeDomains[0] + "/drinks" }];
};
export const fetchRefreshPage = async ({ url }) => ({
  markdown: "Welcome to our pub",
  links: [],
  finalUrl: url,
});
`,
  );
  write(
    root,
    "public/data/pint_prices_app_dataset.json",
    `${JSON.stringify([
      {
        pub_name: "First Independent",
        address: "1 First Road",
        latitude: 51.4,
        longitude: -0.3,
        primary_borough: "Alpha",
        source_datasets: "outer_london_osm",
        price_gbp: null,
        website: "https://first-independent.example/",
        comment: "",
        data_quality_notes: "",
      },
      {
        pub_name: "Second Independent",
        address: "2 Second Road",
        latitude: 51.5,
        longitude: -0.2,
        primary_borough: "Beta",
        source_datasets: "outer_london_osm",
        price_gbp: null,
        website: "https://second-independent.example/",
        comment: "",
        data_quality_notes: "",
      },
    ])}\n`,
  );
  mkdirSync(join(root, "data/osm"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("outer London optional discovery failures", () => {
  it("records the failed venue, continues the queue, and writes the final log", () => {
    const root = makeFixture();
    const script = realpathSync(join(root, "scripts/harvest_outer_london_prices.mjs"));
    const logPath = join(root, "data/osm/test-log.json");
    const run = spawnSync(
      process.execPath,
      [script, "--dry-run", "--limit", "2", "--budget", "4", "--log", "data/osm/test-log.json"],
      { cwd: root, encoding: "utf8", env: process.env },
    );

    expect(run.status, run.stderr).toBe(0);
    expect(
      existsSync(logPath),
      JSON.stringify({ status: run.status, stdout: run.stdout, stderr: run.stderr }),
    ).toBe(true);
    const written = JSON.parse(readFileSync(logPath, "utf8"));
    expect(written.log).toEqual([
      expect.objectContaining({
        pub: "First Independent",
        result: "blocked",
        reason: "exa refused request: HTTP 429 Too Many Requests",
      }),
      expect.objectContaining({
        pub: "Second Independent",
        result: "no-price-published",
      }),
    ]);
    expect(run.stdout).toContain("SUMMARY");
    expect(run.stdout).toContain("Wrote log to ");
    expect(run.stdout).toContain("data/osm/test-log.json");
  });
});
