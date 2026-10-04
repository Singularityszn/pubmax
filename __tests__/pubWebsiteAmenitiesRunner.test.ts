import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUNNER = "scripts/harvest/pub-website-amenities/run.mjs";
const DATASET = "public/data/pint_prices_app_dataset.json";
const EVIDENCE = "data/amenities/london_pub_website_evidence.json";
const SPORTS_QUOTE = "We show live sport on our TV screens.";
const WELCOME = "Welcome to Synthetic Example Pub. A friendly public house for all visitors.";
const HOME = "https://first.example/";
const EXTRA = "https://first.example/sports";
const LANDING = "https://landing.example/pub";
const MODEL = "https://aiplatform.googleapis.com/v1/projects/pubmaxx/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent";
const OBSERVED_AT = "2026-10-01";
const PRICE_ROW = {
  pub_name: "Synthetic Example Pub",
  address: "",
  latitude: 51.5,
  longitude: -0.1,
  live_sports: "",
  price_gbp: 5.75,
  price_observed_at: "2026-09-20",
  scraped_at_values: "2026-09-20T12:00:00Z",
};

type Page = { body: string; url?: string; type?: string };
type Call = { kind: string; url?: string; page?: string };
type EvidenceRow = {
  osmId: string;
  sourceUrl: string;
  verifiedAt: string;
  amenities: Record<string, string>;
};

// Only external process, fetch and clock boundaries are replaced. The copied
// runner executes the real robots, source policy, classifier and venue gates.
const PRELOAD = String.raw`
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const config = JSON.parse(fs.readFileSync("fixture.json", "utf8"));
const calls = [];
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
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ amenities: config.amenities }) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
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
afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runCli(pages: Record<string, Page>) {
  const scratchParent = path.join(ROOT, ".audit/runner-recovery/tests");
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
  write("tsconfig.json", { compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } });
  // An unrelated venues import reads this table. No project data enters scratch.
  write("public/data/price_bands/thresholds.json", { minSample: 30, all: null, cities: {} });
  write(DATASET, [PRICE_ROW]);
  write("data/osm/uk/uk_osm_pubs.json", {
    pubs: [{ osmId: "node/synthetic-1", name: PRICE_ROW.pub_name, lat: 51.5, lng: -0.1, website: HOME }],
  });
  write("fixture.json", {
    pages,
    modelUrl: MODEL,
    now: `${OBSERVED_AT}T12:00:00Z`,
    amenities: { liveSports: { value: true, evidence: SPORTS_QUOTE } },
  });
  write("preload.mjs", PRELOAD);
  const result = spawnSync(process.execPath, [
    "--import", path.join(root, "preload.mjs"),
    "--import", path.join(ROOT, "node_modules/tsx/dist/loader.mjs"),
    path.join(root, RUNNER), "--limit", "1",
  ], {
    cwd: root,
    // Deliberate allowlist: no ambient credentials, HOME, NODE_OPTIONS or cloud config.
    env: { PATH: path.dirname(process.execPath), TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json") },
    encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const calls = JSON.parse(readFileSync(path.join(root, "calls.json"), "utf8")) as Call[];
  expect(calls.filter((call) => call.kind === "unexpected")).toEqual([]);
  const dataset = JSON.parse(readFileSync(path.join(root, DATASET), "utf8"));
  expect(dataset[0]).toMatchObject({
    price_gbp: 5.75,
    price_observed_at: "2026-09-20",
    scraped_at_values: "2026-09-20T12:00:00Z",
  });
  const evidence = JSON.parse(readFileSync(path.join(root, EVIDENCE), "utf8")) as { rows: EvidenceRow[] };
  return { calls, dataset, evidence };
}

function pagesWithLinkedLanding(landing = LANDING, rules = "Allow: /"): Record<string, Page> {
  return {
    "https://first.example/robots.txt": { body: "User-agent: *\nAllow: /", type: "text/plain" },
    "https://landing.example/robots.txt": { body: `User-agent: *\n${rules}`, type: "text/plain" },
    [HOME]: { body: `<p>${WELCOME}</p><a href="/sports">Sport</a>` },
    [EXTRA]: { body: `<p>${SPORTS_QUOTE}</p>`, url: landing },
  };
}

describe("pub website amenities CLI redirect permission", () => {
  it("excludes a linked landing denied by robots from model input and publication", () => {
    const { calls, dataset, evidence } = runCli(pagesWithLinkedLanding(LANDING, "Disallow: /"));
    const modelCalls = calls.filter((call) => call.kind === "model");
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0].page).not.toContain(SPORTS_QUOTE);
    expect(calls).toContainEqual({ kind: "fetch", url: "https://landing.example/robots.txt" });
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });

  it("retains affirmative linked-page evidence when landing robots allows it", () => {
    const { calls, dataset, evidence } = runCli(pagesWithLinkedLanding());
    expect(calls.filter((call) => call.kind === "model")).toHaveLength(1);
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({ verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } });
    expect(dataset[0].live_sports).toBe("y");
  });

  it("retains affirmative homepage evidence when its landing robots allows it", () => {
    const pages = pagesWithLinkedLanding();
    pages[HOME] = { body: `<p>${WELCOME} ${SPORTS_QUOTE}</p>` };
    const { calls, dataset, evidence } = runCli(pages);
    expect(calls.filter((call) => call.kind === "model")).toHaveLength(1);
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({ sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } });
    expect(dataset[0].live_sports).toBe("y");
  });

  it("refuses a homepage landing denied by robots before calling the model", () => {
    const pages = pagesWithLinkedLanding(LANDING, "Disallow: /");
    pages[HOME] = { body: `<p>${WELCOME} ${SPORTS_QUOTE}</p>`, url: LANDING };
    const { calls, dataset, evidence } = runCli(pages);
    expect(calls.filter((call) => call.kind === "model")).toEqual([]);
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });

  it("excludes a linked landing refused by shared source policy", () => {
    const { calls, dataset, evidence } = runCli(pagesWithLinkedLanding("https://127.0.0.1/sports"));
    expect(calls.filter((call) => call.kind === "model")).toHaveLength(1);
    expect(calls.find((call) => call.kind === "model")?.page).not.toContain(SPORTS_QUOTE);
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });
});
