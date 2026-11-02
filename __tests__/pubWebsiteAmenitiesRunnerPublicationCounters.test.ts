import { describe, expect, it } from "vitest";

import {
  CHECKPOINT,
  createCli,
  DATASET,
  EVIDENCE,
  FOOD_QUOTE,
  HOME,
  pageAt,
  pagesWithLinkedLanding,
  removeScratchCopiesAfterEach,
  SPORTS_QUOTE,
  UUID_V4,
  WELCOME,
} from "./helpers/pubWebsiteAmenitiesCli";

// The pub website amenities CLI: uninterrupted publication counters after a
// publication failure.
// The scratch CLI and its fixtures are shared in __tests__/helpers/pubWebsiteAmenitiesCli.ts.
removeScratchCopiesAfterEach();

describe("pub website amenities CLI checkpoint publication", () => {
  it.each([
    { operation: "write", path: `${DATASET}.tmp` },
    { operation: "rename", path: DATASET },
    { operation: "write", path: `${EVIDENCE}.tmp` },
    { operation: "rename", path: EVIDENCE },
    { operation: "write", path: `${CHECKPOINT}.tmp`, occurrence: 2 },
  ].flatMap((failure) => [
    {
      failure,
      kind: "mixed-page positive",
      pages: () => {
        const pages = pagesWithLinkedLanding();
        pageAt(pages, HOME).body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
        return pages;
      },
      amenities: { food: { value: true, evidence: FOOD_QUOTE }, liveSports: { value: true, evidence: SPORTS_QUOTE } },
      skipCounts: { ok: 3, "robots-denied": 2 },
      rows: 2,
    },
    { failure, kind: "empty", pages: () => pagesWithLinkedLanding(), amenities: {}, skipCounts: { ok: 4, "robots-denied": 2 }, rows: 0 },
    {
      failure,
      kind: "robots-denied",
      pages: () => ({ "https://first.example/robots.txt": { body: "User-agent: *\nDisallow: /", type: "text/plain" } }),
      amenities: {},
      skipCounts: { ok: 3, "robots-denied": 2, "robots-disallowed": 1 },
      rows: 0,
    },
  ]))("publishes uninterrupted counters for a $kind pub after $failure.operation $failure.path", ({ failure, pages, amenities, skipCounts, rows }) => {
    const prior = { version: 1, actualSpendUsd: 1.25, skipCounts: { ok: 3, "robots-denied": 2 }, rows: [] };
    const control = createCli(pages(), amenities);
    control.write(EVIDENCE, prior);
    const uninterrupted = control.run();
    expect(uninterrupted.status, uninterrupted.stderr).toBe(0);
    const expected = control.read(EVIDENCE);
    expect(expected).toMatchObject({ publications: 1, skipCounts });
    expect(expected.rows).toHaveLength(rows);
    expect(expected.publicationBatchId).toMatch(UUID_V4);

    const cli = createCli(pages(), amenities);
    cli.write(EVIDENCE, prior);
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure });
    const interrupted = cli.run();
    expect(interrupted.status, interrupted.stderr).toBe(1);
    expect(interrupted.stderr).toContain("Synthetic publication interruption");
    const batchId = cli.read(CHECKPOINT).pendingPublication.id;
    expect(batchId).toMatch(UUID_V4);
    expect(batchId).not.toBe(expected.publicationBatchId);
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z" });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(cli.calls()).toEqual([]);
    expect(cli.read(EVIDENCE).publicationBatchId).toBe(batchId);
    expect({ ...cli.read(EVIDENCE), projected: null, publicationBatchId: expected.publicationBatchId }).toEqual({ ...expected, projected: null });
    expect(cli.readText(DATASET)).toBe(control.readText(DATASET));
    expect(cli.readText(CHECKPOINT)).toBe(control.readText(CHECKPOINT));

    const before = { dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) };
    for (const args of [[], ["--restamp"]]) {
      const rerun = cli.run(args);
      expect(rerun.status, rerun.stderr).toBe(0);
      expect(cli.calls()).toEqual([]);
      expect({ dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) }).toEqual(before);
    }
  });
});
