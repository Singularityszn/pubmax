import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("..", import.meta.url));
const directories: string[] = [];
const previous = `${JSON.stringify({ host: "earlier.co.uk", category: "wine", priceGbp: 8, observedAt: "2026-10-22T12:00:00Z" })}\n`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pubmax-price-categories-"));
  directories.push(root);
  for (const directory of ["data/osm/uk", "data/uk_prices", "public/data"]) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, "data/osm/uk/uk_osm_pubs.json"), JSON.stringify({ pubs: [
    { osmId: "node/123", name: "Category Test Pub", lat: 51.51, lng: -0.13, website: "https://category-test-pub.co.uk" },
  ] }));
  writeFileSync(join(root, "public/data/pint_prices_app_dataset.json"), "[]");
  writeFileSync(join(root, "data/uk_prices/site_harvest.jsonl"), previous);
  const fetchModule = join(root, "fetch.mjs");
  writeFileSync(fetchModule, `
    import { appendFileSync } from 'node:fs';
    globalThis.fetch = async (url) => {
      appendFileSync(${JSON.stringify(join(root, "requests.txt"))}, String(url) + '\\n');
      if (String(url).includes('robots.txt') || String(url).includes('sitemap')) return new Response('', { status: 404 });
      return new Response('<p>Guinness pint £6.50</p><p>Madri pint £6.70</p><p>House red wine 175ml £7.50</p><p>Negroni £12.00</p>', { headers: { 'content-type': 'text/html' } });
    };
  `);
  return { root, fetchModule };
}

async function run(root: string, fetchModule: string, options: string[]) {
  return exec(process.execPath, [
    "--import", fileURLToPath(import.meta.resolve("tsx")), "--import", fetchModule,
    join(repo, "scripts/harvest/uk-prices/run.mjs"),
    "--london", "--only", "category-test-pub.co.uk", "--hosts", "1", "--pages", "8", "--concurrency", "1",
    "--menu-enrichment", "none", "--menu-urls", "none", ...options,
  ], { cwd: root, env: { ...process.env, TYPESAFE_API_KEY: "", TSX_TSCONFIG_PATH: join(repo, "tsconfig.json") } });
}

function rows(root: string, relative: string) {
  return readFileSync(join(root, relative), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("document harvest publication categories", () => {
  it("keeps the default publication of every new category", async () => {
    const { root, fetchModule } = fixture();
    await run(root, fetchModule, []);
    const published = rows(root, "data/uk_prices/site_harvest.jsonl");
    expect(published.slice(1).map(({ category }) => category)).toEqual(["beer", "beer", "cocktail", "wine"]);
    expect(rows(root, "data-harvest/uk_prices/rows.jsonl")).toEqual(published);
    expect(readFileSync(join(root, "data/uk_prices/site_harvest.jsonl"), "utf8").startsWith(previous)).toBe(true);
  });

  it("accepts a deduplicated list of closed-vocabulary categories", async () => {
    const { root, fetchModule } = fixture();
    await run(root, fetchModule, ["--publish-categories", "beer, cocktail,beer"]);
    expect(rows(root, "data/uk_prices/site_harvest.jsonl").slice(1).map(({ category }) => category)).toEqual(["beer", "beer", "cocktail"]);
    expect(JSON.parse(readFileSync(join(root, "data/uk_prices/harvest_report.json"), "utf8")).publication).toEqual({
      categories: ["beer", "cocktail"], candidateRows: 4, selectedRows: 3, excludedRows: 1, writtenRows: 3,
    });
  });

  it("preserves history when no new row matches the publication categories", async () => {
    const { root, fetchModule } = fixture();
    await run(root, fetchModule, ["--publish-categories", "whisky"]);
    for (const file of ["data/uk_prices/site_harvest.jsonl", "data-harvest/uk_prices/rows.jsonl"]) {
      expect(readFileSync(join(root, file), "utf8")).toBe(previous);
    }
    expect(JSON.parse(readFileSync(join(root, "data/uk_prices/harvest_report.json"), "utf8")).publication).toEqual({
      categories: ["whisky"], candidateRows: 4, selectedRows: 0, excludedRows: 4, writtenRows: 0,
    });
  });

  it("reports a dry-run selection without writing either output", async () => {
    const { root, fetchModule } = fixture();
    const result = await run(root, fetchModule, ["--publish-categories", "beer", "--dry-run"]);
    expect(readFileSync(join(root, "data/uk_prices/site_harvest.jsonl"), "utf8")).toBe(previous);
    expect(existsSync(join(root, "data-harvest/uk_prices/rows.jsonl"))).toBe(false);
    expect(result.stdout).toContain("publication: 2 selected, 2 excluded, 0 written");
  });

  it.each([
    ["--publish-categories"],
    ["--publish-categories", ""],
    ["--publish-categories", "beer,unknown"],
    ["--publish-categories", "beer,"],
    ["--publish-categories", "beer,,wine"],
    ["--publish-categories", "Beer"],
    ["--publish-categories", "beer", "--publish-categories", "wine"],
    ["--publish-categories=beer"],
    ["--publish-categories", "beer", "--reset"],
  ])("refuses invalid category options before fetching: %j", async (...options) => {
    const { root, fetchModule } = fixture();
    await expect(run(root, fetchModule, options)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("--publish-categories") });
    expect(existsSync(join(root, "requests.txt"))).toBe(false);
    expect(readFileSync(join(root, "data/uk_prices/site_harvest.jsonl"), "utf8")).toBe(previous);
    expect(existsSync(join(root, "data-harvest/uk_prices/rows.jsonl"))).toBe(false);
  });

  it("appends only selected new categories to both outputs while preserving history", async () => {
    const { root, fetchModule } = fixture();
    await run(root, fetchModule, ["--publish-categories", "beer"]);
    for (const file of ["data/uk_prices/site_harvest.jsonl", "data-harvest/uk_prices/rows.jsonl"]) {
      expect(readFileSync(join(root, file), "utf8").startsWith(previous)).toBe(true);
      expect(rows(root, file).slice(1).map(({ category, priceGbp }) => ({ category, priceGbp }))).toEqual([
        { category: "beer", priceGbp: 6.5 }, { category: "beer", priceGbp: 6.7 },
      ]);
    }
    expect(JSON.parse(readFileSync(join(root, "data/uk_prices/harvest_report.json"), "utf8")).publication).toEqual({
      categories: ["beer"], candidateRows: 4, selectedRows: 2, excludedRows: 2, writtenRows: 2,
    });
  });
});
