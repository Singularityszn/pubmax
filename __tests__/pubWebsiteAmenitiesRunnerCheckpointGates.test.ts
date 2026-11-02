import { describe, expect, it } from "vitest";

import {
  CHECKPOINT,
  createCli,
  DATASET,
  EVIDENCE,
  LANDING,
  pagesWithLinkedLanding,
  PRICE_ROW,
  removeScratchCopiesAfterEach,
} from "./helpers/pubWebsiteAmenitiesCli";

// The pub website amenities CLI: reruns, deliberate removals and the gates a
// recovered checkpoint entry must pass again.
// The scratch CLI and its fixtures are shared in __tests__/helpers/pubWebsiteAmenitiesCli.ts.
removeScratchCopiesAfterEach();

describe("pub website amenities CLI checkpoint publication", () => {
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
});
