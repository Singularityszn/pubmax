import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { defined } from "@/__tests__/helpers/defined";

import {
  committedCityPrices,
  newestMergedNight,
  parseArgs,
  pruneManagedCityPrices,
  readPriceUpdatesAt,
  readRejectedRows,
  rejectClosedPrRows,
  resumeCheckpoint,
  runCityPass,
} from "@/scripts/enrich_city_pubs_tavily.mjs";
import {
  MAX_TAVILY_CREDITS_PER_RUN,
  mergeCanonicalPrices,
  OFFICIAL_SITE_SOURCE_LICENCE,
  runCityEnrichment,
  TAVILY_CREDITS_PER_SEARCH,
  venueKeyForOsmPub,
} from "@/scripts/lib/tavilyPubEnrichment.mjs";

const OBSERVED_AT = "2026-10-06T02:30:00.000Z";

function londonPubs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    osmId: `node/${i + 1}`,
    name: `Independent Arms ${i + 1}`,
    lat: 51.5,
    lng: -0.12,
    address: `${i + 1} Example Street, London, SW1A 1AA`,
    postcode: "SW1A 1AA",
    website: `https://independentarms${i + 1}.co.uk/`,
    operator: null,
    brewery: null,
  }));
}

function billing(credits: number) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ results: [], usage: { credits } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("the nightly London Tavily pass spends a bounded amount", () => {
  it("holds the cost at 200 searches, 400 credits and $3.20", () => {
    expect(TAVILY_CREDITS_PER_SEARCH).toBe(2);
    expect(MAX_TAVILY_CREDITS_PER_RUN).toBe(400);
    expect(MAX_TAVILY_CREDITS_PER_RUN * 0.008).toBeCloseTo(3.2, 10);
  });

  it("stops at 200 searches even when more pubs are due", async () => {
    const fetchImpl = billing(2);
    const result = await runCityEnrichment({
      city: "london",
      pubs: londonPubs(300),
      apiKey: "test-key",
      maxQueries: 5_000,
      maxCredits: 5_000,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result.queriesSpent).toBe(200);
    expect(result.creditsSpent).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(200);
  });

  it("stops on credits before queries when the provider bills more per search", async () => {
    const fetchImpl = billing(5);
    const result = await runCityEnrichment({
      city: "london",
      pubs: londonPubs(300),
      apiKey: "test-key",
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result.creditsSpent).toBeLessThanOrEqual(MAX_TAVILY_CREDITS_PER_RUN);
    expect(result.queriesSpent).toBe(80);
  });

  it("lets a caller lower the credit ceiling and never raise it", async () => {
    const lowered = billing(2);
    const result = await runCityEnrichment({
      city: "london",
      pubs: londonPubs(50),
      apiKey: "test-key",
      maxCredits: 10,
      observedAt: OBSERVED_AT,
      fetchImpl: lowered,
    });

    expect(result.queriesSpent).toBe(5);
    expect(result.creditsSpent).toBe(10);
  });

  it("refuses a CLI ceiling above the code ceiling", () => {
    expect(parseArgs(["--city=london"])).toMatchObject({ maxQueries: 200, maxCredits: 400 });
    expect(() => parseArgs(["--city=london", "--max-credits=401"])).toThrow(/--max-credits/);
    expect(() => parseArgs(["--city=london", "--max-queries=201"])).toThrow(/--max-queries/);
    expect(parseArgs(["--city=london", "--max-credits=40"]).maxCredits).toBe(40);
  });
});

type London = ReturnType<typeof londonPubs>;

function officialPrice(pub: London[number], drinkName: string, priceGbp: number) {
  return {
    venueKey: venueKeyForOsmPub(pub),
    drinkName,
    category: "beer",
    priceGbp,
    servingSize: "pint",
    source: { label: `${pub.name} - official site`, url: pub.website, licence: OFFICIAL_SITE_SOURCE_LICENCE },
    observedAt: "2026-09-01T02:30:00.000Z",
  };
}

const cityKeys = (pubs: London) => new Set(pubs.map(venueKeyForOsmPub));

function freshLondon(pubs: London) {
  return resumeCheckpoint(null, {
    city: "london",
    totalPubs: pubs.length,
    cityVenueKeys: cityKeys(pubs),
    observedAt: OBSERVED_AT,
  });
}

/** The pub each search asked about, in the order the searches ran. */
function searchedPubs(fetchImpl: ReturnType<typeof billing>) {
  return fetchImpl.mock.calls.map(([, init]) => {
    const query = String(JSON.parse(String(init?.body)).query);
    return /"(Independent Arms \d+)"/.exec(query)?.[1];
  });
}

/** A search that finds each named pub's drinks page with the menu given for it. */
function menus(byPub: Record<string, string>) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const name = /"(Independent Arms \d+)"/.exec(String(JSON.parse(String(init?.body)).query))?.[1] ?? "";
    const n = name.replace("Independent Arms ", "");
    const results = byPub[name]
      ? [{ url: `https://independentarms${n}.co.uk/drinks`, raw_content: byPub[name] }]
      : [];
    return new Response(JSON.stringify({ results, usage: { credits: 2 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

type Checkpoint = Awaited<ReturnType<typeof runCityPass>>["state"];
type Price = ReturnType<typeof officialPrice>;

async function night(
  pubs: London,
  checkpoint: Checkpoint,
  options: {
    observedAt: string;
    committed?: Checkpoint["prices"];
    byPub?: Record<string, string>;
    rejectedRows?: Array<{ venueKey: string; sourceUrl: string }>;
    mergedThrough?: string;
  },
) {
  const { state } = await runCityPass({
    city: "london",
    checkpoint,
    pubs,
    apiKey: "test-key",
    observedAt: options.observedAt,
    committedPrices: committedCityPrices(options.committed ?? [], cityKeys(pubs)),
    rejectedRows: options.rejectedRows ?? [],
    mergedThrough: options.mergedThrough ?? null,
    fetchImpl: menus(options.byPub ?? {}),
  });
  return state;
}

const priceRows = (state: Checkpoint) =>
  state.prices.map((row) => [row.venueKey.split("|")[0], row.drinkName, row.priceGbp]);

describe("the nightly London pass keeps going and keeps what it found", () => {
  beforeEach(() => vi.stubEnv("TYPESAFE_API_KEY", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("writes back every committed London price when the checkpoint is empty", async () => {
    const pubs = londonPubs(3);
    const reviewed = [officialPrice(defined(pubs[0]), "Guinness", 6.2), officialPrice(defined(pubs[2]), "Pale Ale", 5.8)];
    const elsewhere = { ...officialPrice(defined(pubs[1]), "Bitter", 4.5), venueKey: "another city pub|x|53.00000|-2.00000" };
    const latest = [...reviewed, elsewhere];

    const state = await night(pubs, freshLondon(pubs), { observedAt: OBSERVED_AT, committed: latest });
    const written = mergeCanonicalPrices(pruneManagedCityPrices(latest, cityKeys(pubs)), state.prices);

    expect(state.prices).toEqual(reviewed);
    expect(written).toEqual(expect.arrayContaining(latest));
    expect(written).toHaveLength(latest.length);
  });

  it("restarts the walk rather than fails, and carries the prices found so far", () => {
    const pubs = londonPubs(3);
    const unmerged = officialPrice(defined(pubs[0]), "Neck Oil", 6.8);
    const leftThePack = { ...unmerged, venueKey: "closed pub|x|51.50000|-0.12000" };
    const options = { city: "london", totalPubs: pubs.length, cityVenueKeys: cityKeys(pubs), observedAt: OBSERVED_AT };
    const saved = {
      ...freshLondon(pubs),
      readAt: { "node/1": OBSERVED_AT },
      prices: [unmerged, leftThePack],
    };

    expect(resumeCheckpoint(saved, options)).toBe(saved);
    for (const restarted of [
      resumeCheckpoint({ ...saved, totalPubs: 4 }, options),
      resumeCheckpoint({ ...saved, version: 1 }, options),
      resumeCheckpoint({ ...saved, city: "leeds" }, options),
      resumeCheckpoint(saved, { ...options, reset: true }),
    ]) {
      expect(restarted).toMatchObject({ readAt: {}, prices: [unmerged] });
    }
  });

  const NIGHT_1 = "2026-10-06T02:30:00.000Z";
  const NIGHT_2 = "2026-10-07T02:30:00.000Z";
  const NIGHT_3 = "2026-10-08T02:30:00.000Z";

  it("keeps an unmerged night in every later PR, and holds the committed copy once it merges", async () => {
    const pubs = londonPubs(2);
    const first = await night(pubs, freshLondon(pubs), {
      observedAt: NIGHT_1,
      byPub: { "Independent Arms 1": "Neck Oil - Pint £6.80" },
    });
    const second = await night(pubs, first, { observedAt: NIGHT_2 });
    const merged = second.prices;
    const third = await night(pubs, second, { observedAt: NIGHT_3, committed: merged, mergedThrough: NIGHT_2 });

    expect(priceRows(second)).toEqual([["independent arms 1", "Neck Oil", 6.8]]);
    expect(third.prices).toEqual(merged);
  });

  it("keeps a later unmerged night when an earlier one merges", async () => {
    const pubs = londonPubs(2);
    const first = await night(pubs, freshLondon(pubs), {
      observedAt: NIGHT_1,
      byPub: { "Independent Arms 1": "Neck Oil - Pint £6.80" },
    });
    const second = await night(pubs, first, {
      observedAt: NIGHT_2,
      byPub: { "Independent Arms 2": "Guinness - Pint £6.10" },
    });
    const third = await night(pubs, second, { observedAt: NIGHT_3, committed: first.prices, mergedThrough: NIGHT_1 });

    expect(priceRows(third)).toEqual([
      ["independent arms 1", "Neck Oil", 6.8],
      ["independent arms 2", "Guinness", 6.1],
    ]);
  });

  it("does not re-add a row a reviewer removed, even when no night saw it merged", async () => {
    const pubs = londonPubs(2);
    const first = await night(pubs, freshLondon(pubs), {
      observedAt: NIGHT_1,
      byPub: { "Independent Arms 1": "Neck Oil - Pint £6.80" },
    });
    const removed = await night(pubs, first, { observedAt: NIGHT_2, committed: [], mergedThrough: NIGHT_1 });
    const later = await night(pubs, removed, { observedAt: NIGHT_3, committed: [], mergedThrough: NIGHT_1 });

    expect(removed.prices).toEqual([]);
    expect(later.prices).toEqual([]);
  });

  it("never overwrites a price a reviewer corrected with a stale checkpoint row", async () => {
    const pubs = londonPubs(2);
    const first = await night(pubs, freshLondon(pubs), {
      observedAt: NIGHT_1,
      byPub: { "Independent Arms 1": "Neck Oil - Pint £6.80" },
    });
    const corrected = first.prices.map((row) => ({ ...row, priceGbp: 6.5 })) as Price[];
    const next = await night(pubs, first, { observedAt: NIGHT_2, committed: corrected, mergedThrough: NIGHT_1 });

    expect(next.prices).toEqual(corrected);
  });

  it("dates the newest merged night from the committed run reports", () => {
    expect(newestMergedNight([])).toBeNull();
    expect(
      newestMergedNight([{ observedAt: NIGHT_1 }, { generatedAt: NIGHT_3 }, { observedAt: NIGHT_2 }]),
    ).toBe(NIGHT_2);
  });

  it("writes a newer reading over the committed one for review", async () => {
    const pubs = londonPubs(1);
    const committed = [{ ...officialPrice(defined(pubs[0]), "Neck Oil", 6.2), source: { ...officialPrice(defined(pubs[0]), "Neck Oil", 6.2).source, url: "https://independentarms1.co.uk/drinks" } }];
    const next = await night(pubs, freshLondon(pubs), {
      observedAt: OBSERVED_AT,
      committed,
      byPub: { "Independent Arms 1": "Neck Oil - Pint £6.80" },
      mergedThrough: "2026-09-01T02:30:00.000Z",
    });

    expect(priceRows(next)).toEqual([["independent arms 1", "Neck Oil", 6.8]]);
  });

  it("never writes a rejected page again, found tonight or held from an earlier night", async () => {
    const pubs = londonPubs(2);
    const byPub = { "Independent Arms 1": "Neck Oil - Pint £6.80", "Independent Arms 2": "Guinness - Pint £6.10" };
    const first = await night(pubs, freshLondon(pubs), { observedAt: "2026-10-06T02:30:00.000Z", byPub });
    const rejectedRows = [{ venueKey: venueKeyForOsmPub(defined(pubs[0])), sourceUrl: "https://independentarms1.co.uk/drinks" }];
    const held = await night(pubs, first, { observedAt: "2026-10-07T02:30:00.000Z", rejectedRows });
    const reread = await night(pubs, held, { observedAt: "2026-10-08T02:30:00.000Z", rejectedRows, byPub });

    expect(priceRows(first)).toHaveLength(2);
    expect(priceRows(held)).toEqual([["independent arms 2", "Guinness", 6.1]]);
    expect(priceRows(reread)).toEqual([["independent arms 2", "Guinness", 6.1]]);
  });

  it("records a closed PR's new pages as rejected, once each", () => {
    const pubs = londonPubs(3);
    const onMain = officialPrice(defined(pubs[0]), "Guinness", 6.2);
    const page = (pub: London[number], drinkName: string) => ({
      ...officialPrice(pub, drinkName, 6),
      source: { ...officialPrice(pub, drinkName, 6).source, url: `${pub.website}drinks` },
      observedAt: OBSERVED_AT,
    });
    const elsewhere = { ...page(defined(pubs[1]), "Bitter"), venueKey: "another city pub|x|53.00000|-2.00000" };
    const already = { venueKey: venueKeyForOsmPub(defined(pubs[2])), sourceUrl: `${defined(pubs[2]).website}drinks` };

    const rows = rejectClosedPrRows([already], {
      prUpdates: [onMain, page(defined(pubs[1]), "Bitter"), page(defined(pubs[1]), "Stout"), page(defined(pubs[2]), "Lager"), elsewhere],
      committedUpdates: [onMain],
      cityVenueKeys: cityKeys(pubs),
      rejectedAt: OBSERVED_AT,
    });

    expect(rows).toEqual([
      already,
      { venueKey: venueKeyForOsmPub(defined(pubs[1])), sourceUrl: `${defined(pubs[1]).website}drinks`, rejectedAt: OBSERVED_AT },
    ]);
  });

  it("refuses a malformed rejected list rather than writing past it", () => {
    expect(readRejectedRows(undefined)).toEqual([]);
    expect(() => readRejectedRows({ version: 1, rows: [{ venueKey: "x" }] })).toThrow(/sourceUrl/);
    expect(() => readRejectedRows([])).toThrow(/version: 1/);
  });

  it("reads a closed PR branch whose prices pass git's default 1 MiB buffer", () => {
    const repo = mkdtempSync(join(tmpdir(), "tavily-london-reject-"));
    try {
      const pubs = londonPubs(6000);
      const updates = pubs.map((pub) => officialPrice(pub, "Guinness", 6));
      const priceDir = join(repo, "public/data/drink_price_updates");
      mkdirSync(priceDir, { recursive: true });
      writeFileSync(join(priceDir, "latest.json"), JSON.stringify({ updates }, null, 2));
      const git = (...args: string[]) =>
        execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
          cwd: repo,
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
          stdio: "pipe",
        });
      git("init", "-b", "tavily-london/20261007");
      git("add", ".");
      git("commit", "-m", "night");

      expect(readFileSync(join(priceDir, "latest.json")).length).toBeGreaterThan(1024 * 1024);
      expect(readPriceUpdatesAt("tavily-london/20261007", { cwd: repo })).toEqual(updates);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("reads the stalest pubs first and records when it read them", async () => {
    const pubs = londonPubs(3);
    const checkpoint = {
      ...freshLondon(pubs),
      readAt: { "node/1": "2026-10-01T02:30:00.000Z", "node/3": "2026-09-01T02:30:00.000Z" },
    };
    const fetchImpl = billing(2);

    const { state } = await runCityPass({
      city: "london",
      checkpoint,
      pubs,
      apiKey: "test-key",
      maxQueries: 2,
      observedAt: OBSERVED_AT,
      committedPrices: [],
      fetchImpl,
    });

    expect(searchedPubs(fetchImpl)).toEqual(["Independent Arms 2", "Independent Arms 3"]);
    expect(state.readAt).toEqual({
      "node/1": "2026-10-01T02:30:00.000Z",
      "node/2": OBSERVED_AT,
      "node/3": OBSERVED_AT,
    });
  });

  it("starts the next pass by itself once every pub has been read", async () => {
    const pubs = londonPubs(250);
    let checkpoint = freshLondon(pubs);
    const nights = ["2026-10-06T02:30:00.000Z", "2026-10-07T02:30:00.000Z", "2026-10-08T02:30:00.000Z"];
    const spent: number[] = [];
    for (const observedAt of nights) {
      const { runResult, state } = await runCityPass({
        city: "london",
        checkpoint,
        pubs,
        apiKey: "test-key",
        observedAt,
        committedPrices: [],
        fetchImpl: billing(2),
      });
      spent.push(runResult.queriesSpent);
      checkpoint = state;
    }

    expect(spent).toEqual([200, 200, 200]);
    expect(Object.keys(checkpoint.readAt)).toHaveLength(250);
    expect(checkpoint.readAt["node/250"]).toBe("2026-10-07T02:30:00.000Z");
    expect(checkpoint.readAt["node/1"]).toBe("2026-10-08T02:30:00.000Z");
    expect(checkpoint.readAt["node/151"]).toBe("2026-10-08T02:30:00.000Z");
    expect(Object.values(checkpoint.readAt)).not.toContain(nights[0]);
  });

  it("fails when it searched nothing while a pub was still due", async () => {
    const pubs = londonPubs(3);
    await expect(
      runCityPass({
        city: "london",
        checkpoint: freshLondon(pubs),
        pubs,
        apiKey: "test-key",
        maxCredits: 1,
        observedAt: OBSERVED_AT,
        committedPrices: [],
        fetchImpl: billing(2),
      }),
    ).rejects.toThrow(/no search ran while 3 pubs were still due/);
  });

  it("passes a night with nothing to search", async () => {
    const pubs = londonPubs(2).map((pub) => ({ ...pub, website: null }));
    const { runResult } = await runCityPass({
      city: "london",
      checkpoint: freshLondon(pubs as unknown as London),
      pubs,
      apiKey: "test-key",
      observedAt: OBSERVED_AT,
      committedPrices: [],
      fetchImpl: billing(2),
    });

    expect(runResult.queriesSpent).toBe(0);
  });
});

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> };
type Workflow = {
  on: { schedule?: Array<{ cron: string }>; workflow_dispatch?: unknown };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { steps: Step[]; permissions: Record<string, string> }>;
};

describe("the nightly London workflow", () => {
  const ROOT = process.cwd();
  const workflow = parse(
    readFileSync(join(ROOT, ".github/workflows/tavily-london-nightly.yml"), "utf8"),
  ) as Workflow;
  const steps = defined(workflow.jobs.pass, "the pass job").steps;
  const stepIndex = (match: (step: Step) => boolean) => {
    const index = steps.findIndex(match);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  };
  const passIndex = stepIndex((step) => /^npm run enrich:city /.test(step.run ?? ""));
  const validateIndex = stepIndex((step) => step.run === "npm run validate-data");
  const prIndex = stepIndex((step) => /tavily-london-review-pr\.sh$/.test(step.run ?? ""));

  it("runs on a schedule and by hand", () => {
    expect(workflow.on.schedule?.map((entry) => entry.cron)).toEqual(["30 2 * * *"]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("runs the London enrichment CLI at the code's own ceilings", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["enrich:city"]).toBe("tsx scripts/enrich_city_pubs_tavily.mjs");
    const run = String(defined(steps[passIndex]).run);
    const cliArgs = defined(run.split(" -- ")[1], "CLI arguments").trim().split(/\s+/);
    expect(parseArgs(cliArgs)).toEqual({
      city: "london",
      maxQueries: 200,
      maxCredits: 400,
      reset: false,
      dryRun: false,
    });
  });

  it("serialises runs so two nights never overlap", () => {
    expect(workflow.concurrency).toEqual({ group: "tavily-london-nightly", "cancel-in-progress": false });
  });

  it("validates the data after the pass and before the PR", () => {
    expect(validateIndex).toBeGreaterThan(passIndex);
    expect(prIndex).toBeGreaterThan(validateIndex);
  });

  it("saves the checkpoint it restored, even when a later step fails", () => {
    const restore = defined(steps[stepIndex((step) => step.uses?.startsWith("actions/cache/restore@") ?? false)]);
    const saveIndex = stepIndex((step) => step.uses?.startsWith("actions/cache/save@") ?? false);
    const save = defined(steps[saveIndex]);

    expect(save.if).toBe("${{ !cancelled() }}");
    expect(save.with?.path).toBe(".tavily/enrichment/london.json");
    expect(restore.with?.path).toBe(save.with?.path);
    expect(stepIndex((step) => step === restore)).toBeLessThan(passIndex);
    expect(saveIndex).toBeGreaterThan(passIndex);
    expect(saveIndex).toBeLessThan(validateIndex);
  });

  it("keeps the token out of git config and pins every action to a commit", () => {
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(workflow.permissions).toEqual({});
    for (const step of steps.filter((entry) => entry.uses)) {
      expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe("the London review PR script", () => {
  const SCRIPT = join(process.cwd(), "scripts/ci/tavily-london-review-pr.sh");
  let dir = "";

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv(), stdio: "pipe" }).trim();
  const gitEnv = () => ({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });

  function repo() {
    dir = mkdtempSync(join(tmpdir(), "tavily-london-pr-"));
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    const bin = join(dir, "bin");
    mkdirSync(work);
    mkdirSync(bin);
    git(dir, "init", "--bare", "-b", "main", origin);
    git(work, "init", "-b", "main");
    git(work, "config", "user.name", "test");
    git(work, "config", "user.email", "test@example.com");
    git(work, "config", "commit.gpgsign", "false");
    writeFileSync(join(work, "README.md"), "x\n");
    git(work, "add", "README.md");
    git(work, "commit", "-m", "init");
    git(work, "remote", "add", "origin", origin);
    git(work, "push", "origin", "main");
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${join(dir, "gh.log")}"\n`);
    chmodSync(join(bin, "gh"), 0o755);
    return { work, mainBefore: git(work, "rev-parse", "main"), bin };
  }

  const runScript = (work: string, bin: string) =>
    execFileSync("bash", [SCRIPT], {
      cwd: work,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...gitEnv(), PATH: `${bin}:${process.env.PATH}` },
    });

  const remoteHeads = (work: string) =>
    git(work, "ls-remote", "--heads", "origin")
      .split("\n")
      .map((line) => line.split("\t"));

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("pushes tonight's prices to a review branch and opens a PR, leaving main alone", () => {
    const { work, mainBefore, bin } = repo();
    mkdirSync(join(work, "public/data/drink_price_updates"), { recursive: true });
    writeFileSync(join(work, "public/data/drink_price_updates/latest.json"), "{}\n");
    mkdirSync(join(work, "data/enrichment/tavily/london"), { recursive: true });
    writeFileSync(join(work, "data/enrichment/tavily/london/run_20261006.json"), "{}\n");

    runScript(work, bin);

    const heads = remoteHeads(work);
    expect(heads.find(([, ref]) => ref === "refs/heads/main")?.[0]).toBe(mainBefore);
    expect(heads.map(([, ref]) => ref)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^refs\/heads\/tavily-london\/\d{8}$/)]),
    );
    expect(heads).toHaveLength(2);
    expect(readFileSync(join(dir, "gh.log"), "utf8")).toMatch(/^pr create /);
  });

  it("pushes nothing when the pass wrote nothing", () => {
    const { work, mainBefore, bin } = repo();

    expect(runScript(work, bin)).toContain("the pass wrote nothing to review");
    expect(remoteHeads(work)).toEqual([[mainBefore, "refs/heads/main"]]);
  });
});
