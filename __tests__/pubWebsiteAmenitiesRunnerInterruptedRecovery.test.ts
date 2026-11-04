import { describe, expect, it } from "vitest";

import { stableVenueIdFromKey, venueGroupingKey } from "../lib/venues";
import {
  CHECKPOINT,
  createCli,
  DATASET,
  EVIDENCE,
  HOME,
  LANDING,
  OBSERVED_AT,
  pageAt,
  pagesWithLinkedLanding,
  PRICE_ROW,
  removeScratchCopiesAfterEach,
  SPORTS_QUOTE,
  WELCOME,
} from "./helpers/pubWebsiteAmenitiesCli";

// The pub website amenities CLI: malformed pending checkpoints and recovery after
// an interrupted run.
// The scratch CLI and its fixtures are shared in __tests__/helpers/pubWebsiteAmenitiesCli.ts.
removeScratchCopiesAfterEach();

describe("pub website amenities CLI checkpoint publication", () => {
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

  it("recovers an interrupted --copy-skipped observation in the default scope, where the pub carries its OSM name", () => {
    const pages = pagesWithLinkedLanding();
    pageAt(pages, HOME).body = `<p>${WELCOME} ${SPORTS_QUOTE}</p>`;
    const cli = createCli(pages);
    const pubs = cli.read("data/osm/uk/uk_osm_pubs.json");
    pubs.pubs[0].name = "SYNTHETIC EXAMPLE PUB";
    cli.write("data/osm/uk/uk_osm_pubs.json", pubs);
    const venueId = stableVenueIdFromKey(venueGroupingKey(PRICE_ROW as unknown as Parameters<typeof venueGroupingKey>[0]));
    cli.write("data/venue_copy/london.json", { skipped: { [venueId]: { reason: "insufficient-stored-facts" } } });
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure: { operation: "rename", path: EVIDENCE } });
    const interrupted = cli.run(["--copy-skipped", "--limit", "1"]);
    expect(interrupted.status, interrupted.stderr).toBe(1);
    // The copy-skipped list names the pub as the price dataset does.
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-1"]).toMatchObject({ publication: "pending", name: PRICE_ROW.pub_name });
    cli.write("fixture.json", { ...cli.read("fixture.json"), failure: null, pages: {}, now: "2026-10-04T12:00:00Z" });
    const resumed = cli.run();
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(resumed.stderr).not.toContain("unrecoverable-pending-observation");
    const { calls, dataset, evidence } = cli.output();
    expect(calls).toEqual([]);
    expect(evidence.rows).toEqual([expect.objectContaining({ sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } })]);
    expect(dataset[0].live_sports).toBe("y");
    expect(cli.read(CHECKPOINT).byOsmId["node/synthetic-1"].publication).toBe("published");
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
