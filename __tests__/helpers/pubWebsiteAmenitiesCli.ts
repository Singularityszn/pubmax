import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { afterEach, expect } from "vitest";

// ONE SCRATCH CLI FOR EVERY PUB WEBSITE AMENITIES RUNNER SUITE.
//
// Each test copies the runner into a scratch tree and spawns it, so one test
// takes seconds. Vitest spreads files across workers, never the tests inside
// one file, so the runner tests are split by topic into several suites. They
// share this harness: the scratch copy, the preload and the fixture pages are
// written once. The suites are __tests__/pubWebsiteAmenitiesRunner*.test.ts.

const ROOT = path.resolve(import.meta.dirname, "../..");
const RUNNER = "scripts/harvest/pub-website-amenities/run.mjs";
export const DATASET = "public/data/pint_prices_app_dataset.json";
export const EVIDENCE = "data/amenities/london_pub_website_evidence.json";
const CHAIN_PAGES = "data/amenities/london_pub_website_chain_pages.json";
export const CHECKPOINT = "data-harvest/pub-website-amenities/checkpoint.json";
export const SPORTS_QUOTE = "We show live sport on our TV screens.";
export const FOOD_QUOTE = "We serve freshly cooked meals every day.";
export const POOL_QUOTE = "Play on our pool table every evening.";
export const WELCOME = "Welcome to Synthetic Example Pub. A friendly public house for all visitors.";
export const HOME = "https://first.example/";
export const EXTRA = "https://first.example/sports";
export const SECOND_PUB = "https://first.example/pub-two";
export const LANDING = "https://landing.example/pub";
const MODEL = "https://aiplatform.googleapis.com/v1/projects/pubmaxx/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent";
export const OBSERVED_AT = "2026-10-01";
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PRICE_ROW = {
  pub_name: "Synthetic Example Pub",
  address: "",
  latitude: 51.5,
  longitude: -0.1,
  live_sports: "",
  food: "",
  price_gbp: 5.75,
  price_observed_at: "2026-09-20",
  scraped_at_values: "2026-09-20T12:00:00Z",
};

type Page = { body: string; url?: string; type?: string };
type Call = { kind: string; url?: string; page?: string };
export type EvidenceRow = {
  osmId: string;
  sourceUrl: string;
  verifiedAt: string;
  amenities: Record<string, string>;
};
type ModelAmenities = Record<string, { value: boolean; evidence: string }>;

// Only external process, fetch and clock boundaries are replaced. The copied
// runner executes the real robots, source policy, classifier and venue gates.
const PRELOAD = String.raw`
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const config = JSON.parse(fs.readFileSync("fixture.json", "utf8"));
const calls = [];
let modelIndex = 0;
const blocked = (kind) => {
  calls.push({ kind: "unexpected", boundary: kind });
  process.exitCode = 91;
  throw new Error("Unexpected external boundary denied: " + kind);
};
for (const method of ["exec", "execSync", "execFile", "fork", "spawn", "spawnSync"]) {
  cp[method] = () => blocked("subprocess " + method);
}
cp.execFileSync = (command, args) => {
  if (command !== "gcloud" || JSON.stringify(args) !== JSON.stringify(["auth", "print-access-token"])) {
    return blocked("subprocess execFileSync");
  }
  calls.push({ kind: "synthetic-token" });
  return "offline-synthetic-token";
};
const realWrite = fs.writeFileSync;
const realRename = fs.renameSync;
let fileHits = 0;
const failFile = (file, operation) => {
  if (config.failure?.operation === operation && String(file).endsWith(config.failure.path)) {
    fileHits += 1;
    if (fileHits === (config.failure.occurrence ?? 1)) {
      calls.push({ kind: "injected-file-error" });
      throw new Error("Synthetic publication interruption");
    }
  }
};
fs.writeFileSync = (file, ...args) => {
  failFile(file, "write");
  return realWrite(file, ...args);
};
fs.renameSync = (from, to) => {
  failFile(to, "rename");
  return realRename(from, to);
};
syncBuiltinESMExports();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(config.now);
  }
  static now() { return new RealDate(config.now).getTime(); }
};
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (url === config.modelUrl) {
    const request = JSON.parse(options.body);
    calls.push({ kind: "model", page: request.contents[0].parts[0].text });
    const amenities = config.amenityResults
      ? config.amenityResults[modelIndex++] ?? blocked("unexpected model result")
      : config.amenities;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ amenities }) }] } }],
      usageMetadata: config.usageMetadata ?? { promptTokenCount: 100, candidatesTokenCount: 50 },
    }), { headers: { "content-type": "application/json" } });
  }
  calls.push({ kind: "fetch", url });
  const page = config.pages[url];
  if (!page) return blocked("fetch " + url);
  const response = new Response(page.body, { headers: { "content-type": page.type ?? "text/html" } });
  Object.defineProperty(response, "url", { value: page.url ?? url });
  return response;
};
process.on("exit", () => fs.writeFileSync("calls.json", JSON.stringify(calls)));
`;

const scratchRoots: string[] = [];

/** Called once at the top of each suite: every scratch copy goes after its test. */
export function removeScratchCopiesAfterEach(): void {
  afterEach(() => {
    for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
}

export function createCli(
  pages: Record<string, Page>,
  amenities: ModelAmenities = { liveSports: { value: true, evidence: SPORTS_QUOTE } },
  options: { secondPub?: boolean } = {},
) {
  const scratchParent = path.join(ROOT, "test-results/runner-recovery");
  mkdirSync(scratchParent, { recursive: true });
  const root = mkdtempSync(path.join(scratchParent, "cli-"));
  scratchRoots.push(root);
  const write = (relative: string, value: unknown) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  mkdirSync(path.dirname(path.join(root, RUNNER)), { recursive: true });
  cpSync(path.join(ROOT, RUNNER), path.join(root, RUNNER));
  chmodSync(path.join(root, RUNNER), 0o444);
  cpSync(path.join(ROOT, "lib"), path.join(root, "lib"), { recursive: true });
  cpSync(path.join(ROOT, "scripts/lib"), path.join(root, "scripts/lib"), { recursive: true });
  // The committed chain list is read before any page is fetched; scratch starts with none proven.
  write(CHAIN_PAGES, { version: 1, pages: [], quotes: [], readers: {}, quoteReaders: [] });
  write("tsconfig.json", { compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } });
  // An unrelated venues import reads this table. No project data enters scratch.
  write("public/data/price_bands/thresholds.json", { minSample: 30, all: null, cities: {} });
  write(DATASET, [PRICE_ROW, ...(options.secondPub ? [{ ...PRICE_ROW, pub_name: "Synthetic Second Pub", longitude: -0.2 }] : [])]);
  write("data/osm/uk/uk_osm_pubs.json", {
    pubs: [
      { osmId: "node/synthetic-1", name: PRICE_ROW.pub_name, lat: 51.5, lng: -0.1, website: HOME },
      ...(options.secondPub ? [{ osmId: "node/synthetic-2", name: "Synthetic Second Pub", lat: 51.5, lng: -0.2, website: SECOND_PUB }] : []),
    ],
  });
  write("fixture.json", {
    pages,
    modelUrl: MODEL,
    now: `${OBSERVED_AT}T12:00:00Z`,
    amenities,
  });
  write("preload.mjs", PRELOAD);
  const execute = (args: string[]) => spawnSync(process.execPath, [
    "--import", path.join(root, "preload.mjs"),
    "--import", path.join(ROOT, "node_modules/tsx/dist/loader.mjs"),
    path.join(root, RUNNER), ...args,
  ], {
    cwd: root,
    // Deliberate allowlist: no ambient credentials, HOME, NODE_OPTIONS or cloud config.
    env: { PATH: path.dirname(process.execPath), TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json") } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  const readText = (relative: string) => readFileSync(path.join(root, relative), "utf8");
  const read = (relative: string) => JSON.parse(readText(relative));
  const calls = () => {
    const recorded = read("calls.json") as Call[];
    expect(recorded.filter((call) => call.kind === "unexpected")).toEqual([]);
    return recorded;
  };
  const run = (args = ["--limit", options.secondPub ? "2" : "1"]) => {
    const result = execute(args);
    expect(result.error).toBeUndefined();
    calls();
    return result;
  };
  const output = () => {
    const dataset = read(DATASET);
    expect(dataset[0]).toMatchObject({
      price_gbp: 5.75,
      price_observed_at: "2026-09-20",
      scraped_at_values: "2026-09-20T12:00:00Z",
    });
    const evidence = read(EVIDENCE) as {
      rows: EvidenceRow[]; stampedVenues: number; stampedRows: number;
    };
    return { calls: calls(), dataset, evidence };
  };
  return { run, output, read, readText, write, calls, remove: (relative: string) => rmSync(path.join(root, relative)) };
}

export function runCli(
  pages: Record<string, Page>,
  amenities: ModelAmenities = { liveSports: { value: true, evidence: SPORTS_QUOTE } },
  options: { secondPub?: boolean; restamp?: boolean } = {},
) {
  const cli = createCli(pages, amenities, options);
  const result = cli.run();
  expect(result.status, result.stderr).toBe(0);
  if (options.restamp) {
    const before = cli.readText(DATASET);
    const restamped = cli.run(["--restamp"]);
    expect(restamped.status, restamped.stderr).toBe(0);
    expect(cli.readText(DATASET)).toBe(before);
  }
  return cli.output();
}

/** A fixture page that must exist. */
export function pageAt(pages: Record<string, Page>, url: string): Page {
  const page = pages[url];
  if (!page) throw new Error(`no fixture page ${url}`);
  return page;
}

export function pagesWithLinkedLanding(landing = LANDING, rules = "Allow: /"): Record<string, Page> {
  return {
    "https://first.example/robots.txt": { body: "User-agent: *\nAllow: /", type: "text/plain" },
    "https://landing.example/robots.txt": { body: `User-agent: *\n${rules}`, type: "text/plain" },
    [HOME]: { body: `<p>${WELCOME}</p><a href="/sports">Sport</a>` },
    [EXTRA]: { body: `<p>${SPORTS_QUOTE}</p>`, url: landing },
  };
}

export function createSharedHomepageCli() {
  const cli = createCli({
    "https://first.example/robots.txt": { body: "User-agent: *\nAllow: /", type: "text/plain" },
    [HOME]: { body: `<p>${WELCOME} ${SPORTS_QUOTE}</p>` },
  }, undefined, { secondPub: true });
  const pubs = cli.read("data/osm/uk/uk_osm_pubs.json");
  pubs.pubs[1].website = HOME;
  cli.write("data/osm/uk/uk_osm_pubs.json", pubs);
  cli.write("fixture.json", {
    ...cli.read("fixture.json"),
    amenityResults: [{ liveSports: { value: true, evidence: SPORTS_QUOTE } }, {}],
  });
  return cli;
}
