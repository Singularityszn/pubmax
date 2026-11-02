import { describe, expect, it } from "vitest";

import {
  CHECKPOINT,
  createCli,
  createSharedHomepageCli,
  DATASET,
  EVIDENCE,
  OBSERVED_AT,
  pagesWithLinkedLanding,
  PRICE_ROW,
  removeScratchCopiesAfterEach,
  SPORTS_QUOTE,
} from "./helpers/pubWebsiteAmenitiesCli";

// The pub website amenities CLI: shared quotes, renamed pubs and empty published peers.
// The scratch CLI and its fixtures are shared in __tests__/helpers/pubWebsiteAmenitiesCli.ts.
removeScratchCopiesAfterEach();

describe("pub website amenities CLI checkpoint publication", () => {
  it.each([
    { kind: "name casing", name: "SYNTHETIC EXAMPLE PUB", matched: 2 },
    { kind: "name and loses its slim mapping", name: "Renamed Example House", matched: 1 },
  ])("refuses a pending shared quote after its empty published peer changes $kind", ({ name, matched }) => {
    const cli = createSharedHomepageCli();
    cli.write("fixture.json", { ...cli.read("fixture.json"), amenityResults: [{}] });
    expect(cli.run(["--limit", "1"]).status).toBe(0);
    expect(cli.output().evidence.rows).toEqual([]);
    cli.write("fixture.json", {
      ...cli.read("fixture.json"),
      amenityResults: [{ liveSports: { value: true, evidence: SPORTS_QUOTE } }],
      failure: { operation: "rename", path: EVIDENCE },
    });
    const interrupted = cli.run();
    expect(interrupted.status, interrupted.stderr).toBe(1);
    expect(interrupted.stderr).toContain("Synthetic publication interruption");
    const pending = cli.read(CHECKPOINT).byOsmId["node/synthetic-2"];
    expect(pending).toMatchObject({
      publication: "pending", verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE },
    });
    const pubs = cli.read("data/osm/uk/uk_osm_pubs.json");
    pubs.pubs[0].name = name;
    cli.write("data/osm/uk/uk_osm_pubs.json", pubs);
    cli.write("fixture.json", {
      ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z",
    });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(resumed.stdout).toContain(`"matchedSlimVenues":${matched}`);
    const { calls, dataset, evidence } = cli.output();
    expect(calls).toEqual([]);
    expect(evidence.rows, resumed.stdout).toEqual([]);
    expect(dataset.map((row: typeof PRICE_ROW) => row.live_sports)).toEqual(["", ""]);
    for (const row of dataset) {
      expect(row).toMatchObject({ price_gbp: 5.75, price_observed_at: "2026-09-20", scraped_at_values: "2026-09-20T12:00:00Z" });
    }
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-2"]).toEqual({ ...pending, publication: "published" });
    const before = { dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) };
    for (const args of [[], ["--restamp"]]) {
      expect(cli.run(args).status).toBe(0);
      expect(cli.calls()).toEqual([]);
      expect({ dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) }).toEqual(before);
    }
  });

  it("keeps removed published quotes absent after their pub changes name", () => {
    const cli = createCli(pagesWithLinkedLanding());
    expect(cli.run().status).toBe(0);
    expect(cli.output().evidence.rows).toHaveLength(1);
    const checkpoint = cli.readText(CHECKPOINT);
    cli.write(EVIDENCE, { ...cli.read(EVIDENCE), rows: [] });
    const pubs = cli.read("data/osm/uk/uk_osm_pubs.json");
    pubs.pubs[0].name = "Renamed Example House";
    cli.write("data/osm/uk/uk_osm_pubs.json", pubs);
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {}, now: "2026-10-04T12:00:00Z" });
    expect(cli.run().status).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "" }], evidence: { rows: [] } });
    expect(cli.readText(CHECKPOINT)).toBe(checkpoint);
  });

  it.each(["SYNTHETIC EXAMPLE PUB", "Renamed Example House"])("refuses positive fact recovery after its current pub changes name to %s", (name) => {
    const cli = createCli(pagesWithLinkedLanding());
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure: { operation: "rename", path: EVIDENCE } });
    expect(cli.run().status).toBe(1);
    const checkpoint = cli.readText(CHECKPOINT);
    const pubs = cli.read("data/osm/uk/uk_osm_pubs.json");
    pubs.pubs[0].name = name;
    cli.write("data/osm/uk/uk_osm_pubs.json", pubs);
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z" });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(cli.output()).toMatchObject({ calls: [], dataset: [{ live_sports: "" }], evidence: { rows: [], skipCounts: { "unrecoverable-pending": 1 } } });
    // The refusal is a finding: reported, counted and marked, never taken for published.
    expect(resumed.stderr).toContain('"finding":"unrecoverable-pending-observation"');
    expect(resumed.stderr).toContain('"reason":"pub-name-changed"');
    expect(JSON.parse(checkpoint).byOsmId["node/synthetic-1"].publication).toBe("pending");
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-1"].publication).toBe("unrecoverable");
  });

  it.each([
    { operation: "rename", path: EVIDENCE },
    { operation: "write", path: `${CHECKPOINT}.tmp`, occurrence: 2 },
  ])("refuses shared-page recovery beside an empty published peer after $operation $path", (failure) => {
    const cli = createSharedHomepageCli();
    cli.write("fixture.json", { ...cli.read("fixture.json"), amenityResults: [{}] });
    expect(cli.run(["--limit", "1"]).status).toBe(0);
    cli.write("fixture.json", {
      ...cli.read("fixture.json"),
      amenityResults: [{ liveSports: { value: true, evidence: SPORTS_QUOTE } }],
      failure,
    });
    const interrupted = cli.run();
    expect(interrupted.status, interrupted.stderr).toBe(1);
    expect(interrupted.stderr).toContain("Synthetic publication interruption");
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-2"]).toMatchObject({
      publication: "pending", verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE },
    });
    cli.write("fixture.json", {
      ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z",
    });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    const { calls, dataset, evidence } = cli.output();
    expect(calls).toEqual([]);
    expect(evidence.rows, resumed.stdout).toEqual([]);
    expect(dataset.map((row: typeof PRICE_ROW) => row.live_sports)).toEqual(["", ""]);
    const before = { dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) };
    expect(cli.run().status).toBe(0);
    expect(cli.calls()).toEqual([]);
    expect({ dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) }).toEqual(before);
  });

  it.each(["recorded pages", "legacy empty pages"])("retains an empty published peer's ownership for later publication with %s", (kind) => {
    const cli = createSharedHomepageCli();
    cli.write("fixture.json", { ...cli.read("fixture.json"), amenityResults: [{}] });
    expect(cli.run(["--limit", "1"]).status).toBe(0);
    expect(cli.output().evidence.rows).toEqual([]);
    if (kind === "legacy empty pages") {
      const checkpoint = cli.read(CHECKPOINT);
      checkpoint.byOsmId["node/synthetic-1"].pages = [];
      cli.write(CHECKPOINT, checkpoint);
    }
    cli.write("fixture.json", {
      ...cli.read("fixture.json"),
      amenityResults: [{ liveSports: { value: true, evidence: SPORTS_QUOTE } }],
      now: "2026-10-04T12:00:00Z",
    });
    const later = cli.run();
    expect(later.status, later.stderr).toBe(0);
    const { dataset, evidence } = cli.output();
    expect(evidence.rows, later.stdout).toEqual([]);
    expect(dataset.map((row: typeof PRICE_ROW) => row.live_sports)).toEqual(["", ""]);
    const before = { dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) };
    cli.write("fixture.json", { ...cli.read("fixture.json"), pages: {} });
    for (const args of [[], ["--restamp"]]) {
      const rerun = cli.run(args);
      expect(rerun.status, rerun.stderr).toBe(0);
      expect(cli.calls()).toEqual([]);
      expect({ dataset: cli.readText(DATASET), evidence: cli.readText(EVIDENCE) }).toEqual(before);
    }
  });
});
