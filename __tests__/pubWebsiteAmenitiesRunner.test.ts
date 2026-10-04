import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUNNER = "scripts/harvest/pub-website-amenities/run.mjs";
const DATASET = "public/data/pint_prices_app_dataset.json";
const EVIDENCE = "data/amenities/london_pub_website_evidence.json";
const CHECKPOINT = "data-harvest/pub-website-amenities/checkpoint.json";
const SPORTS_QUOTE = "We show live sport on our TV screens.";
const FOOD_QUOTE = "We serve freshly cooked meals every day.";
const POOL_QUOTE = "Play on our pool table every evening.";
const WELCOME = "Welcome to Synthetic Example Pub. A friendly public house for all visitors.";
const HOME = "https://first.example/";
const EXTRA = "https://first.example/sports";
const SECOND_PUB = "https://first.example/pub-two";
const LANDING = "https://landing.example/pub";
const MODEL = "https://aiplatform.googleapis.com/v1/projects/pubmaxx/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent";
const OBSERVED_AT = "2026-10-01";
const PRICE_ROW = {
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
type EvidenceRow = {
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

function createCli(
  pages: Record<string, Page>,
  amenities: ModelAmenities = { liveSports: { value: true, evidence: SPORTS_QUOTE } },
  options: { secondPub?: boolean } = {},
) {
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
    env: { PATH: path.dirname(process.execPath), TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json") },
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

function runCli(
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

function pagesWithLinkedLanding(landing = LANDING, rules = "Allow: /"): Record<string, Page> {
  return {
    "https://first.example/robots.txt": { body: "User-agent: *\nAllow: /", type: "text/plain" },
    "https://landing.example/robots.txt": { body: `User-agent: *\n${rules}`, type: "text/plain" },
    [HOME]: { body: `<p>${WELCOME}</p><a href="/sports">Sport</a>` },
    [EXTRA]: { body: `<p>${SPORTS_QUOTE}</p>`, url: landing },
  };
}

describe("pub website amenities CLI permission and page citations", () => {
  it("rejects a quote assembled across separate pages", () => {
    const { dataset, evidence } = runCli(pagesWithLinkedLanding(EXTRA), {
      liveSports: { value: true, evidence: `for all visitors. ${SPORTS_QUOTE}` },
    });
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });

  it("rejects navigation text while retaining genuine linked-page evidence", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    const navigation = "Food and drinks Hotels About us Contact us Careers";
    pages[HOME].body = `<p>${WELCOME}</p><nav>${navigation}</nav><a href="/sports">Sport</a>`;
    const { dataset, evidence } = runCli(pages, {
      food: { value: true, evidence: navigation },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    });
    expect(evidence.rows).toEqual([expect.objectContaining({ sourceUrl: EXTRA, amenities: { liveSports: SPORTS_QUOTE } })]);
    expect(dataset[0]).toMatchObject({ food: "", live_sports: "y" });
  });

  it("restamps both permitted pages without network calls or changing prices and observation dates", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pages[HOME].body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    const { calls, dataset, evidence } = runCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    }, { restamp: true });
    expect(calls).toEqual([]);
    expect(evidence.rows).toEqual([
      expect.objectContaining({ sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { food: FOOD_QUOTE } }),
      expect.objectContaining({ sourceUrl: EXTRA, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } }),
    ]);
    expect(evidence).toMatchObject({ stampedVenues: 1, stampedRows: 1 });
    expect(dataset[0]).toMatchObject({ food: "y", live_sports: "y" });
  });

  it("rejects identical quotes on distinct pages belonging to different pubs sharing a host", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pages[SECOND_PUB] = { body: `<p>Welcome to Synthetic Second Pub. ${SPORTS_QUOTE}</p>` };
    const { dataset, evidence } = runCli(pages, undefined, { secondPub: true });
    expect(evidence.rows).toEqual([]);
    expect(dataset.map((row: typeof PRICE_ROW) => row.live_sports)).toEqual(["", ""]);
  });

  it("keeps unique pub-page quotes but rejects a homepage shared by different pubs", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pages[HOME].body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    pages[SECOND_PUB] = { body: `<p>Welcome to Synthetic Second Pub. ${POOL_QUOTE}</p>` };
    const { dataset, evidence } = runCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
      pool: { value: true, evidence: POOL_QUOTE },
    }, { secondPub: true });
    expect(evidence.rows).toEqual([
      expect.objectContaining({ osmId: "node/synthetic-1", sourceUrl: EXTRA, amenities: { liveSports: SPORTS_QUOTE } }),
      expect.objectContaining({ osmId: "node/synthetic-2", sourceUrl: SECOND_PUB, amenities: { pool: POOL_QUOTE } }),
    ]);
    expect(dataset[0]).toMatchObject({ food: "", live_sports: "y" });
    expect(dataset[1]).toMatchObject({ food: "", live_sports: "", pool: "y" });
  });

  it("retains homepage and linked-page quotes for one pub with their actual citations", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pages[HOME].body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    const { dataset, evidence } = runCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    });
    expect(evidence.rows).toEqual([
      expect.objectContaining({ sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { food: FOOD_QUOTE } }),
      expect.objectContaining({ sourceUrl: EXTRA, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } }),
    ]);
    expect(dataset[0]).toMatchObject({ food: "y", live_sports: "y" });
  });

  it("cites the permitted linked landing that contains the retained quote", () => {
    const { dataset, evidence } = runCli(pagesWithLinkedLanding());
    expect(evidence.rows).toEqual([expect.objectContaining({
      sourceUrl: LANDING,
      verifiedAt: OBSERVED_AT,
      amenities: { liveSports: SPORTS_QUOTE },
    })]);
    expect(dataset[0].live_sports).toBe("y");
  });

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


describe("pub website amenities CLI checkpoint publication", () => {
  it.each([
    { operation: "write", path: `${DATASET}.tmp` },
    { operation: "rename", path: DATASET },
    { operation: "rename", path: EVIDENCE },
    { operation: "write", path: `${CHECKPOINT}.tmp`, occurrence: 2 },
  ])("recovers both page citations across publication failure $operation $path", (failure) => {
    const pages = pagesWithLinkedLanding();
    pages[HOME].body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    const cli = createCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    });
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure });
    const interrupted = cli.run();
    expect(interrupted.status, interrupted.stderr).toBe(1);
    expect(interrupted.stderr).toContain("Synthetic publication interruption");
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-1"].status).toBe("ok");
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z" });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    const { calls, dataset, evidence } = cli.output();
    expect(calls).toEqual([]);
    expect(evidence.rows).toEqual([
      expect.objectContaining({ sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { food: FOOD_QUOTE } }),
      expect.objectContaining({ sourceUrl: LANDING, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } }),
    ]);
    expect(dataset[0]).toMatchObject({ food: "y", live_sports: "y" });
    const rerun = cli.run();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(cli.output()).toEqual({ calls, dataset, evidence });
  });

  it("keeps already published reruns byte-identical without external calls", () => {
    const cli = createCli(pagesWithLinkedLanding());
    expect(cli.run().status).toBe(0);
    const before = { dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) };
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {}, now: "2026-10-04T12:00:00Z" });
    const rerun = cli.run();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(cli.calls()).toEqual([]);
    expect({ dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) }).toEqual(before);
  });

  it.each(["published", "legacy"])("preserves deliberate evidence removal for %s checkpoint", (kind) => {
    const cli = createCli(pagesWithLinkedLanding());
    expect(cli.run().status).toBe(0);
    const checkpoint = cli.read(CHECKPOINT);
    if (kind === "legacy") delete checkpoint.byOsmId["node/synthetic-1"].publication;
    cli.write(CHECKPOINT, checkpoint);
    cli.write(EVIDENCE, { ...cli.read(EVIDENCE), rows: [] });
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {} });
    expect(cli.run().status).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "" }], evidence: { rows: [] } });
    // Once publication is known, even deleting the whole evidence file cannot revive it.
    cli.remove(EVIDENCE);
    expect(cli.run().status).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "" }], evidence: { rows: [] } });
  });

  it("retains valid older observation without inventing expiry or refreshing its date", () => {
    const cli = createCli(pagesWithLinkedLanding());
    expect(cli.run().status).toBe(0);
    const checkpoint = cli.read(CHECKPOINT);
    Object.assign(checkpoint.byOsmId["node/synthetic-1"], { publication: "pending", verifiedAt: "2015-01-10" });
    cli.write(CHECKPOINT, checkpoint);
    cli.remove(EVIDENCE);
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {} });
    expect(cli.run().status).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "y" }], evidence: { rows: [{ verifiedAt: "2015-01-10" }] } });
  });

  it("reapplies current semantic gates when recovering a checkpoint", () => {
    const cli = createCli(pagesWithLinkedLanding());
    expect(cli.run().status).toBe(0);
    const checkpoint = cli.read(CHECKPOINT);
    Object.assign(checkpoint.byOsmId["node/synthetic-1"], {
      publication: "pending", amenities: { food: "Food and drinks Hotels About us Contact us Careers" },
      pages: [{ sourceUrl: LANDING, amenities: { food: "Food and drinks Hotels About us Contact us Careers" } }],
    });
    cli.write(CHECKPOINT, checkpoint);
    cli.remove(EVIDENCE);
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {} });
    expect(cli.run().status).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "" }], evidence: { rows: [] } });
  });

  it("refuses a recovered checkpoint when current dataset no longer maps its pub", () => {
    const cli = createCli(pagesWithLinkedLanding());
    expect(cli.run().status).toBe(0);
    const checkpoint = cli.read(CHECKPOINT);
    checkpoint.byOsmId["node/synthetic-1"].publication = "pending";
    cli.write(CHECKPOINT, checkpoint);
    cli.write(DATASET, [{ ...PRICE_ROW, longitude: -0.3 }]);
    cli.remove(EVIDENCE);
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {} });
    expect(cli.run().status).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "" }], evidence: { rows: [] } });
  });

  it("refuses an obsolete OSM checkpoint entry without adding an unknown pub", () => {
    const cli = createCli(pagesWithLinkedLanding());
    expect(cli.run().status).toBe(0);
    const checkpoint = cli.read(CHECKPOINT);
    checkpoint.byOsmId["node/obsolete"] = { ...checkpoint.byOsmId["node/synthetic-1"], publication: "pending" };
    cli.write(CHECKPOINT, checkpoint);
    cli.remove(EVIDENCE);
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {} });
    expect(cli.run().status).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "" }], evidence: { rows: [] } });
  });

  it.each([null, [], "ok", 42])("refuses malformed checkpoint entry %j without retrying external work", (entry) => {
    const cli = createCli({});
    cli.write(CHECKPOINT, { spentUsd: 0, byOsmId: { "node/synthetic-1": entry } });
    const result = cli.run();
    expect(result.status, result.stderr).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "" }], evidence: { rows: [] } });
  });

  it.each([
    ["invalid calendar day", (entry: Record<string, unknown>) => { entry.verifiedAt = "2026-02-30"; }],
    ["future observation", (entry: Record<string, unknown>) => { entry.verifiedAt = "2099-01-01"; }],
    ["missing observation date", (entry: Record<string, unknown>) => { delete entry.verifiedAt; }],
    ["observation date object", (entry: Record<string, unknown>) => { entry.verifiedAt = { day: OBSERVED_AT }; }],
    ["wrong pub identity", (entry: Record<string, unknown>) => { entry.name = "Other Pub"; }],
    ["obsolete venue mapping", (entry: Record<string, unknown>) => { entry.venueId = "venue-obsolete"; }],
    ["changed pub website", (entry: Record<string, unknown>) => { entry.website = "https://obsolete.example/"; }],
    ["refused original source", (entry: Record<string, unknown>) => { entry.sourceUrl = "https://127.0.0.1/"; }],
    ["malformed pages", (entry: Record<string, unknown>) => { entry.pages = {}; }],
    ["null page", (entry: Record<string, unknown>) => { entry.pages = [null]; }],
    ["refused citation", (entry: Record<string, unknown>) => { entry.pages = [{ sourceUrl: "https://127.0.0.1/", amenities: { liveSports: SPORTS_QUOTE } }]; }],
    ["malformed quote", (entry: Record<string, unknown>) => { entry.pages = [{ sourceUrl: HOME, amenities: { liveSports: { evidence: SPORTS_QUOTE } } }]; }],
  ])("refuses pending checkpoint with %s without external calls", (_label, mutate) => {
    const cli = createCli(pagesWithLinkedLanding());
    expect(cli.run().status).toBe(0);
    const checkpoint = cli.read(CHECKPOINT);
    const entry = checkpoint.byOsmId["node/synthetic-1"];
    entry.publication = "pending";
    mutate(entry);
    cli.write(CHECKPOINT, checkpoint);
    cli.remove(EVIDENCE);
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {} });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    const { calls, dataset, evidence } = cli.output();
    expect(calls).toEqual([]);
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });

  it("recovers a dated legacy checkpoint only when published evidence file is absent", () => {
    const pages = pagesWithLinkedLanding();
    pages[HOME] = { body: `<p>${WELCOME} ${SPORTS_QUOTE}</p>` };
    const cli = createCli(pages);
    expect(cli.run().status).toBe(0);
    const checkpoint = cli.read(CHECKPOINT);
    const entry = checkpoint.byOsmId["node/synthetic-1"];
    delete entry.publication;
    delete entry.website;
    delete entry.pages;
    cli.write(CHECKPOINT, checkpoint);
    cli.remove(EVIDENCE);
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {}, now: "2026-10-04T12:00:00Z" });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    const { calls, dataset, evidence } = cli.output();
    expect(calls).toEqual([]);
    expect(evidence.rows).toEqual([expect.objectContaining({
      sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE },
    })]);
    expect(dataset[0].live_sports).toBe("y");
  });

  it("recovers original dated quotes without repeating fetch or model after evidence write interruption", () => {
    const cli = createCli(pagesWithLinkedLanding());
    cli.write("fixture.json", {
      ...cli.read("fixture.json"),
      failure: { operation: "write", path: `${EVIDENCE}.tmp` },
    });
    const interrupted = cli.run();
    expect(interrupted.status, interrupted.stderr).toBe(1);
    expect(interrupted.stderr).toContain("Synthetic publication interruption");
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-1"]).toMatchObject({
      status: "ok", verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE },
    });
    expect(cli.read(DATASET)[0].live_sports).toBe("y");
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z" });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    const { calls, dataset, evidence } = cli.output();
    expect(calls).toEqual([]);
    expect(evidence.rows).toEqual([expect.objectContaining({
      sourceUrl: LANDING, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE },
    })]);
    expect(dataset[0].live_sports).toBe("y");
  });
});
