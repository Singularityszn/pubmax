import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateFreshness } from "../scripts/check_freshness.mjs";
import {
  reviewHistoricPublication,
  // @ts-expect-error -- untyped .mjs module (resolves fine at runtime under vitest)
} from "../scripts/build_historic_index.mjs";

// The publication contract of `node scripts/build_historic_index.mjs`, driven
// through the real executable in a disposable copy of the tree. The generator
// resolves every path from its own location, so a sandbox holding a copy of the
// script, the lib modules it imports, fixture inputs and a fixture registry is
// the whole world it can see: nothing here can touch the committed data.

const REPO = path.resolve(__dirname, "..");
const INDEX = "public/data/historic_pubs.json";
const RECEIPT = "data/historic_pubs_receipt.json";
const REGISTRY = "data/freshness_registry.json";
const CACHE = "public/data/heritage_cache.json";
const DATASET = "public/data/pint_prices_app_dataset.json";
const ALIASES = "public/data/venue_id_aliases.json";

const PRIOR_STAMP = "2026-01-01T00:00:00Z";

const FIXTURE_CACHE = {
  "the old bell": [
    { source: "wikipedia", fact: "The Old Bell is a Grade II listed pub rebuilt in 1670.", sourceRef: "https://ex/1" },
  ],
  "the new inn": [{ source: "osm", fact: "A coaching inn on the green.", sourceRef: "https://ex/2" }],
  // Joined to a Camden venue, so a fact placing it in Southwark is withheld.
  "the wheatsheaf": [
    { source: "wikipedia", fact: "A Victorian corner house.", sourceRef: "https://ex/3" },
    { source: "wikipedia", fact: "The Wheatsheaf is a pub in Southwark.", sourceRef: "https://ex/4" },
  ],
};

const FIXTURE_DATASET = [
  { pub_name: "The Old Bell", address: "1 High St", latitude: 51.5, longitude: -0.1, primary_borough: "Westminster" },
  { pub_name: "The New Inn", address: "2 Green Rd", latitude: 51.51, longitude: -0.11, primary_borough: "Hackney" },
  { pub_name: "The Wheatsheaf", address: "3 Corner St", latitude: 51.52, longitude: -0.12, primary_borough: "Camden" },
];

const FIXTURE_ALIASES = { aliases: {} };

// An unrelated row rides in the same registry, so a publication that touches
// anything but its own stamp shows up as a byte change here.
const OTHER_ROW = {
  id: "heritage_listings",
  label: "Listed-building heritage facts",
  class: "episodic",
  artifact: "public/data/heritage_listings.json",
  stamp: { kind: "literal", value: "2026-07-18T00:00:00Z", consumedBy: "committed dataset" },
  cadence: "episodic",
  stalenessBudgetHours: 8760,
  refreshWorkflow: "manual",
  gate: "none",
};

const HISTORIC_ROW = {
  id: "historic_pubs",
  label: "Historic pubs index",
  class: "episodic",
  artifact: INDEX,
  pack: true,
  stamp: { kind: "literal", value: PRIOR_STAMP, consumedBy: "prior wording" },
  cadence: "episodic — node scripts/build_historic_index.mjs",
  stalenessBudgetHours: 2160,
  refreshWorkflow: "manual (node scripts/build_historic_index.mjs)",
  gate: "none",
};

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const sandboxes: string[] = [];

afterEach(() => {
  for (const root of sandboxes.splice(0)) {
    chmodSync(path.join(root, "data"), 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

function makeSandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), "historic-publication-"));
  sandboxes.push(root);
  for (const dir of ["scripts", "lib", "public/data", "data"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  copyFileSync(
    path.join(REPO, "scripts/build_historic_index.mjs"),
    path.join(root, "scripts/build_historic_index.mjs"),
  );
  for (const name of readdirSync(path.join(REPO, "lib"))) {
    if (name.endsWith(".mjs")) copyFileSync(path.join(REPO, "lib", name), path.join(root, "lib", name));
  }
  writeFileSync(path.join(root, CACHE), json(FIXTURE_CACHE));
  writeFileSync(path.join(root, DATASET), json(FIXTURE_DATASET));
  writeFileSync(path.join(root, ALIASES), json(FIXTURE_ALIASES));
  writeFileSync(
    path.join(root, REGISTRY),
    json({ version: 1, datasets: [OTHER_ROW, HISTORIC_ROW] }),
  );
  return root;
}

function runGenerator(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [path.join(root, "scripts/build_historic_index.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function snapshot(root: string) {
  return {
    index: existsSync(path.join(root, INDEX)) ? read(root, INDEX) : null,
    receipt: existsSync(path.join(root, RECEIPT)) ? read(root, RECEIPT) : null,
    registry: read(root, REGISTRY),
  };
}

function historicStamp(root: string) {
  const registry = JSON.parse(read(root, REGISTRY));
  return registry.datasets.find((d: { id: string }) => d.id === "historic_pubs").stamp;
}

async function historicFreshness(root: string) {
  const { results } = await evaluateFreshness({ rootDir: root, now: new Date() });
  return results.find((r: { id: string }) => r.id === "historic_pubs");
}

// A first successful publication, so every failure case below starts from a
// previously ACCEPTED index, receipt and stamp that it must leave alone.
function acceptedSandbox(): string {
  const root = makeSandbox();
  const first = runGenerator(root);
  expect(first.status, first.stderr).toBe(0);
  return root;
}

describe("a successful historic-index generation", () => {
  it("publishes the index, a matching receipt and the registry stamp from one generation clock", async () => {
    const root = makeSandbox();
    const before = Date.now();
    const result = runGenerator(root);
    const after = Date.now();

    expect(result.status, result.stderr).toBe(0);

    const indexBytes = read(root, INDEX);
    const rows = JSON.parse(indexBytes);
    expect(rows.map((r: { name: string }) => r.name).sort()).toEqual([
      "The New Inn",
      "The Old Bell",
      "The Wheatsheaf",
    ]);

    const receipt = JSON.parse(read(root, RECEIPT));
    const generatedAt = Date.parse(receipt.generatedAt);
    // Second precision: the clock is truncated to whole seconds.
    expect(generatedAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(generatedAt).toBeLessThanOrEqual(after);
    expect(receipt.artifact).toBe(INDEX);
    expect(receipt.inputs).toEqual({
      [CACHE]: sha256(read(root, CACHE)),
      [DATASET]: sha256(read(root, DATASET)),
      [ALIASES]: sha256(read(root, ALIASES)),
    });
    expect(receipt.output).toEqual({ sha256: sha256(indexBytes), records: 3 });
    expect(receipt.quarantined).toHaveLength(1);
    expect(receipt.quarantined[0]).toMatchObject({
      cacheKey: "the wheatsheaf",
      fact: "The Wheatsheaf is a pub in Southwark.",
    });

    const stamp = historicStamp(root);
    expect(stamp.kind).toBe("literal");
    expect(stamp.value).toBe(receipt.generatedAt);
    // The stamp dates the published index, and says so, never an observation.
    expect(stamp.consumedBy).toMatch(/generated and published/);
    expect(stamp.consumedBy).toMatch(/never an observation/);

    // Every other registry row is byte-for-byte what it was.
    const registry = JSON.parse(read(root, REGISTRY));
    expect(registry.datasets[0]).toEqual(OTHER_ROW);
    expect(registry.datasets[1]).toEqual({ ...HISTORIC_ROW, stamp });

    const freshness = await historicFreshness(root);
    expect(freshness).toBeDefined();
    if (freshness === undefined) {
      throw new Error("historic_pubs freshness row is missing");
    }
    expect(freshness.status).toBe("fresh");
    expect(freshness.observedAt).toBe(receipt.generatedAt);
  });

  it("republishes byte-identical rows when its inputs have not changed", () => {
    const root = acceptedSandbox();
    const first = snapshot(root);
    const firstReceipt = JSON.parse(first.receipt ?? "null");

    const second = runGenerator(root);
    expect(second.status, second.stderr).toBe(0);

    expect(read(root, INDEX)).toBe(first.index);
    const receipt = JSON.parse(read(root, RECEIPT));
    expect(receipt.inputs).toEqual(firstReceipt.inputs);
    expect(receipt.output).toEqual(firstReceipt.output);
  });
});

describe("a refused historic-index generation", () => {
  it.each([
    ["an empty heritage cache", (root: string) => writeFileSync(path.join(root, CACHE), "{}\n")],
    [
      "a cache whose every fact is withheld",
      (root: string) =>
        writeFileSync(
          path.join(root, CACHE),
          json({ "the wheatsheaf": [{ source: "wikipedia", fact: "The Wheatsheaf is a pub in Southwark." }] }),
        ),
    ],
    ["a heritage cache that is not an object", (root: string) => writeFileSync(path.join(root, CACHE), "[]\n")],
    ["a missing heritage cache", (root: string) => rmSync(path.join(root, CACHE))],
    ["an unreadable venue dataset", (root: string) => writeFileSync(path.join(root, DATASET), "{not json")],
    [
      "a registry with no historic_pubs row",
      (root: string) => writeFileSync(path.join(root, REGISTRY), json({ version: 1, datasets: [OTHER_ROW] })),
    ],
  ])("refuses %s and keeps the accepted index, receipt and stamp", async (_label, breakInputs) => {
    const root = acceptedSandbox();
    breakInputs(root);
    const before = snapshot(root);
    const acceptedReceipt = before.receipt;
    const freshnessBefore = await historicFreshness(root);

    const result = runGenerator(root);

    expect(result.status).not.toBe(0);
    expect(snapshot(root)).toEqual(before);
    expect(read(root, RECEIPT)).toBe(acceptedReceipt);
    const freshnessAfter = await historicFreshness(root);
    expect(freshnessAfter?.observedAt).toBe(freshnessBefore?.observedAt);
  });

  // The command takes no arguments. One it does not read would otherwise run a
  // full publication and move the clock, so a mistyped flag, or a time the
  // generator never honours, must refuse before anything is written.
  it.each([
    ["an unknown option", "--unknown-option"],
    ["a time-looking option", "--now=2099-01-01T00:00:00Z"],
    ["a positional output path", "public/data/elsewhere.json"],
  ])("refuses %s on the command line and keeps the accepted index, receipt and stamp", (_label, arg) => {
    const root = acceptedSandbox();
    const before = snapshot(root);

    const result = runGenerator(root, [arg]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(arg);
    expect(result.stdout).not.toMatch(/wrote:|receipt:|stamped:/);
    expect(snapshot(root)).toEqual(before);
    expect(readdirSync(root).sort()).toEqual(["data", "lib", "public", "scripts"]);

    // The same copy still publishes when it is run as documented.
    const supported = runGenerator(root);
    expect(supported.status, supported.stderr).toBe(0);
    expect(read(root, INDEX)).toBe(before.index);
  });

  it("rolls the index back when a later publication step fails", async () => {
    const root = acceptedSandbox();
    const accepted = snapshot(root);
    // A changed input makes a different index, so a leak would be visible.
    writeFileSync(
      path.join(root, CACHE),
      json({ ...FIXTURE_CACHE, "the crown": [{ source: "osm", fact: "A riverside tavern." }] }),
    );
    // The index directory stays writable while data/ refuses the receipt.
    chmodSync(path.join(root, "data"), 0o555);

    const result = runGenerator(root);
    chmodSync(path.join(root, "data"), 0o755);

    expect(result.status).not.toBe(0);
    expect(read(root, INDEX)).toBe(accepted.index);
    expect(read(root, RECEIPT)).toBe(accepted.receipt);
    expect(read(root, REGISTRY)).toBe(accepted.registry);
    // No staging directory is left behind in the tree.
    expect(readdirSync(root).sort()).toEqual(["data", "lib", "public", "scripts"]);
    expect((await historicFreshness(root))?.observedAt).toBe(historicStamp(root).value);
  });
});

describe("reviewHistoricPublication", () => {
  const cache = {
    "the old bell": [{ source: "wikipedia", fact: "Rebuilt in 1670.", sourceRef: "https://ex/1" }],
    "the new inn": [{ source: "osm", fact: "A coaching inn." }],
  };
  const oldBell = { name: "The Old Bell", facts: [{ source: "wikipedia", fact: "Rebuilt in 1670.", sourceRef: "https://ex/1" }] };
  const newInn = { name: "The New Inn", facts: [{ source: "osm", fact: "A coaching inn." }] };

  it("accepts rows that follow the cache", () => {
    expect(
      reviewHistoricPublication({ heritageCache: cache, prior: [oldBell, newInn], records: [oldBell, newInn], quarantined: [] }),
    ).toEqual([]);
  });

  it("refuses to drop a prior row whose facts the cache still holds", () => {
    const problems = reviewHistoricPublication({
      heritageCache: cache,
      prior: [oldBell, newInn],
      records: [oldBell],
      quarantined: [],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/The New Inn/);
  });

  it("lets a row go when its facts were withheld or removed from the cache", () => {
    expect(
      reviewHistoricPublication({
        heritageCache: cache,
        prior: [oldBell, newInn],
        records: [oldBell],
        quarantined: [{ name: "The New Inn", fact: "A coaching inn." }],
      }),
    ).toEqual([]);
    expect(
      reviewHistoricPublication({
        heritageCache: { "the old bell": cache["the old bell"] },
        prior: [oldBell, newInn],
        records: [oldBell],
        quarantined: [],
      }),
    ).toEqual([]);
  });

  it("refuses a published fact or citation the cache does not hold", () => {
    const rewritten = { ...oldBell, facts: [{ source: "wikipedia", fact: "Rebuilt in 1670.", sourceRef: "https://ex/other" }] };
    const problems = reviewHistoricPublication({
      heritageCache: cache,
      prior: [],
      records: [rewritten, newInn],
      quarantined: [],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/The Old Bell/);
  });

  it("refuses an empty publication", () => {
    expect(
      reviewHistoricPublication({ heritageCache: {}, prior: [], records: [], quarantined: [] }),
    ).toHaveLength(1);
  });
});
