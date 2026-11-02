import { describe, expect, it } from "vitest";

import {
  CHECKPOINT,
  createCli,
  DATASET,
  EVIDENCE,
  type EvidenceRow,
  FOOD_QUOTE,
  HOME,
  LANDING,
  OBSERVED_AT,
  pageAt,
  pagesWithLinkedLanding,
  removeScratchCopiesAfterEach,
  SPORTS_QUOTE,
  UUID_V4,
  WELCOME,
} from "./helpers/pubWebsiteAmenitiesCli";

// The pub website amenities CLI: a pending publication batch is retried, acknowledged
// or recovered after a publication failure.
// The scratch CLI and its fixtures are shared in __tests__/helpers/pubWebsiteAmenitiesCli.ts.
removeScratchCopiesAfterEach();

describe("pub website amenities CLI checkpoint publication", () => {
  it.each([
    { counter: "equal", publications: 5 },
    { counter: "different", publications: 7 },
  ])("retries a legacy counter-only pending batch beside unrelated evidence at $counter counters", ({ publications }) => {
    const pages = pagesWithLinkedLanding();
    pageAt(pages, HOME).body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    const cli = createCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    });
    const unrelated = {
      osmId: "node/unrelated", name: "Unrelated Synthetic Pub", venueId: "unrelated-venue",
      sourceUrl: "https://unrelated.example/", verifiedAt: "2026-09-30", amenities: { food: FOOD_QUOTE },
    };
    const prior = {
      version: 1, publications: 4, actualSpendUsd: 1.25, skipCounts: { ok: 3 }, rows: [unrelated],
    };
    cli.write(EVIDENCE, prior);
    cli.write("fixture.json", {
      ...cli.read("fixture.json"), failure: { operation: "rename", path: EVIDENCE },
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
    });
    const interrupted = cli.run();
    expect(interrupted.status, interrupted.stderr).toBe(1);
    expect(interrupted.stderr).toContain("Synthetic publication interruption");
    expect(cli.calls().filter((call) => call.kind === "model")).toHaveLength(1);
    const pending = cli.read(CHECKPOINT);
    expect(pending.pendingPublication).toEqual({
      id: expect.stringMatching(UUID_V4), publications: 5, spentUsd: 0,
    });
    expect(cli.read(EVIDENCE)).toEqual(prior);

    // A checkpoint from before batch ids names no batch, so no evidence file can acknowledge it.
    delete pending.pendingPublication.id;
    cli.write(CHECKPOINT, pending);
    cli.write(EVIDENCE, {
      ...prior, publications, publicationBatchId: "39da3e1e-31fa-4ca7-8a74-2844d1c65cbb",
    });
    cli.write("fixture.json", {
      ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z",
    });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(cli.calls()).toEqual([]);
    const { dataset, evidence } = cli.output();
    expect(evidence).toMatchObject({
      publications: publications + 1,
      publicationBatchId: expect.stringMatching(UUID_V4),
      actualSpendUsd: 1.2503,
    });
    expect(evidence.rows.map((row: EvidenceRow) => row.osmId)).toEqual(["node/synthetic-1", "node/synthetic-1", "node/unrelated"]);
    expect(dataset[0]).toMatchObject({ food: "y", live_sports: "y" });
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-1"].publication).toBe("published");
    expect(cli.read(CHECKPOINT).pendingPublication).toBeUndefined();
  });

  it("acknowledges an already published pending batch UUID without duplicate rows or spend", () => {
    const pages = pagesWithLinkedLanding();
    pageAt(pages, HOME).body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    const cli = createCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    });
    cli.write(EVIDENCE, {
      version: 1, publications: 4, actualSpendUsd: 1.25, skipCounts: { ok: 3 }, rows: [],
    });
    cli.write("fixture.json", {
      ...cli.read("fixture.json"),
      failure: { operation: "write", path: `${CHECKPOINT}.tmp`, occurrence: 2 },
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
    });
    const interrupted = cli.run();
    expect(interrupted.status, interrupted.stderr).toBe(1);
    expect(interrupted.stderr).toContain("Synthetic publication interruption");
    expect(cli.calls().filter((call) => call.kind === "model")).toHaveLength(1);
    const pending = cli.read(CHECKPOINT);
    expect(pending.pendingPublication).toEqual({
      id: expect.stringMatching(UUID_V4), publications: 5, spentUsd: 0,
    });
    expect(pending.spentUsd).toBeCloseTo(0.0003, 8);
    expect(pending.byOsmId["node/synthetic-1"]).toMatchObject({
      publication: "pending", verifiedAt: OBSERVED_AT,
      amenities: { food: FOOD_QUOTE, liveSports: SPORTS_QUOTE },
    });
    const published = cli.read(EVIDENCE);
    expect(published).toMatchObject({
      publications: 5, publicationBatchId: pending.pendingPublication.id,
      actualSpendUsd: 1.2503, skipCounts: { ok: 3 },
    });
    expect(published.rows).toEqual([
      expect.objectContaining({ osmId: "node/synthetic-1", sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { food: FOOD_QUOTE } }),
      expect.objectContaining({ osmId: "node/synthetic-1", sourceUrl: LANDING, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } }),
    ]);
    expect(cli.read(DATASET)[0]).toMatchObject({ food: "y", live_sports: "y" });
    const before = { dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) };
    cli.write("fixture.json", {
      ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z",
    });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(cli.calls()).toEqual([]);
    expect({ dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) }).toEqual(before);
    expect(cli.read(EVIDENCE)).toEqual(published);
    expect(cli.read(CHECKPOINT)).toEqual({
      spentUsd: pending.spentUsd,
      located: {},
      byOsmId: {
        ...pending.byOsmId,
        "node/synthetic-1": { ...pending.byOsmId["node/synthetic-1"], publication: "published" },
      },
    });
    const acknowledged = cli.readText(CHECKPOINT);
    for (const args of [[], ["--restamp"]]) {
      const rerun = cli.run(args);
      expect(rerun.status, rerun.stderr).toBe(0);
      expect(cli.calls()).toEqual([]);
      expect({ dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) }).toEqual(before);
      expect(cli.readText(CHECKPOINT)).toBe(acknowledged);
    }
  });

  it("recovers a paid pending batch when unrelated evidence has the same publication counter", () => {
    const pages = pagesWithLinkedLanding();
    pageAt(pages, HOME).body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    const cli = createCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    });
    const prior = { version: 1, publications: 4, actualSpendUsd: 1.25, skipCounts: { ok: 3 }, rows: [] };
    cli.write(EVIDENCE, prior);
    cli.write("fixture.json", {
      ...cli.read("fixture.json"), failure: { operation: "rename", path: EVIDENCE },
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
    });
    const interrupted = cli.run();
    expect(interrupted.status, interrupted.stderr).toBe(1);
    expect(interrupted.stderr).toContain("Synthetic publication interruption");
    expect(cli.calls().filter((call) => call.kind === "model")).toHaveLength(1);
    const pending = cli.read(CHECKPOINT);
    expect(pending.pendingPublication).toMatchObject({ publications: 5, spentUsd: 0 });
    expect(pending.spentUsd).toBeCloseTo(0.0003, 8);
    expect(pending.byOsmId["node/synthetic-1"]).toMatchObject({
      publication: "pending", verifiedAt: OBSERVED_AT,
      amenities: { food: FOOD_QUOTE, liveSports: SPORTS_QUOTE },
    });
    expect(cli.read(EVIDENCE)).toEqual(prior);

    const unrelated = {
      osmId: "node/unrelated", name: "Unrelated Synthetic Pub", venueId: "unrelated-venue",
      sourceUrl: "https://unrelated.example/", verifiedAt: "2026-09-30", amenities: { food: FOOD_QUOTE },
    };
    cli.write(EVIDENCE, {
      ...prior, publications: 5, publicationBatchId: "39da3e1e-31fa-4ca7-8a74-2844d1c65cbb",
      actualSpendUsd: 2, skipCounts: { ok: 7 }, rows: [unrelated],
    });
    cli.write("fixture.json", {
      ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z",
    });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    const { calls, dataset, evidence } = cli.output();
    expect(calls).toEqual([]);
    expect(evidence.rows).toEqual([
      expect.objectContaining({ osmId: "node/synthetic-1", sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { food: FOOD_QUOTE } }),
      expect.objectContaining({ osmId: "node/synthetic-1", sourceUrl: LANDING, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } }),
      unrelated,
    ]);
    expect(dataset[0]).toMatchObject({ food: "y", live_sports: "y" });
    expect(cli.read(EVIDENCE)).toMatchObject({
      publications: 6, publicationBatchId: pending.pendingPublication.id,
      actualSpendUsd: 2.0003, skipCounts: { ok: 7 },
    });
    expect(pending.pendingPublication.id).toMatch(UUID_V4);
    expect(cli.read(CHECKPOINT).spentUsd).toBe(pending.spentUsd);
    expect(cli.read(CHECKPOINT).pendingPublication).toBeUndefined();
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-1"]).toEqual({
      ...pending.byOsmId["node/synthetic-1"], publication: "published",
    });
    const before = { dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE), checkpoint: cli.readText(CHECKPOINT) };
    for (const args of [[], ["--restamp"]]) {
      const rerun = cli.run(args);
      expect(rerun.status, rerun.stderr).toBe(0);
      expect(cli.calls()).toEqual([]);
      expect({ dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE), checkpoint: cli.readText(CHECKPOINT) }).toEqual(before);
    }
  });

  it.each([
    { operation: "write", path: `${DATASET}.tmp` },
    { operation: "rename", path: DATASET },
    { operation: "rename", path: EVIDENCE },
    { operation: "write", path: `${CHECKPOINT}.tmp`, occurrence: 2 },
  ])("recovers both page citations across publication failure $operation $path", (failure) => {
    const pages = pagesWithLinkedLanding();
    pageAt(pages, HOME).body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
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
});
