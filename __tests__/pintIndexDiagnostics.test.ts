import { describe, expect, it } from "vitest";

import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import type { PintIndexObservation, PintIndexSnapshot } from "@/lib/pintIndex";
import { diagnosePintIndex } from "@/lib/pintIndexDiagnostics";
import committedSnapshot from "@/public/data/pint_index_snapshot.json";

function observation(index: number, observedAt = "2026-11-10T12:00:00.000Z"): PintIndexObservation {
  return {
    venueId: `pub-${index}`, pubName: `Pub ${index}`, boroughCode: "islington",
    boroughName: "Islington", pricePence: 550, observedAt, sourceId: "menu",
  };
}

function snapshot(observations: PintIndexObservation[]): PintIndexSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "diagnostic-test",
    status: observations.length ? "published" : "empty",
    generatedAt: "2026-12-01T12:00:00.000Z",
    observationWindow: observations.length ? {
      start: "2026-10-01T00:00:00.000Z", end: "2026-11-30T23:59:59.999Z",
    } : null,
    classification: {
      version: LONDON_BOROUGH_CLASSIFIER_VERSION, method: "point_in_polygon",
      sourceArtifact: "data/london_boroughs_simplified.json", licence: "OGL v3",
    },
    sources: [{
      id: "menu", kind: "official_publisher", publisher: "Test pub",
      publisherType: "pub", sourceUrl: "https://example.com/menu",
      officialDomain: "example.com", licence: null,
    }],
    observations,
    excluded: [],
  };
}

describe("public Pint Index diagnostics", () => {
  it("keeps the committed legacy baseline outside the public evidence count", () => {
    // Update this baseline assertion with the first reviewed evidence publication.
    const report = diagnosePintIndex(committedSnapshot);
    expect(report).toMatchObject({
      status: "valid", admitted: false, validObservationCount: 0, groups: [], records: [],
    });
    expect(report.exclusions).toEqual([expect.objectContaining({
      reason: "source_not_eligible_for_public_index", observationCount: 2796,
    })]);
  });

  it("reports the one missing pub at 19 and admits 20 in the same borough and month", () => {
    const rows = Array.from({ length: 19 }, (_, index) => observation(index));
    const below = diagnosePintIndex(snapshot(rows));
    expect(below.admitted).toBe(false);
    expect(below.groups).toEqual([expect.objectContaining({
      month: "2026-11", boroughCode: "islington", distinctPubCount: 19,
      missingDistinctPubs: 1, meetsFloor: false,
    })]);
    const met = diagnosePintIndex(snapshot([...rows, observation(19)]));
    expect(met.admitted).toBe(true);
    expect(met.groups[0]).toMatchObject({ distinctPubCount: 20, missingDistinctPubs: 0 });
  });

  it("counts duplicate visits once and uses the latest borough for a venue within a month", () => {
    const first = observation(1);
    const later = {
      ...first, boroughCode: "camden", boroughName: "Camden" as const,
      observedAt: "2026-11-11T12:00:00.000Z",
    };
    const report = diagnosePintIndex(snapshot([first, later, later]));
    expect(report.validObservationCount).toBe(3);
    expect(report.groups).toEqual([{
      month: "2026-11", boroughCode: "camden", boroughName: "Camden",
      distinctPubCount: 1, venueIds: ["pub-1"], missingDistinctPubs: 19, meetsFloor: false,
    }]);
  });

  it("does not combine ten pubs in October with ten in November", () => {
    const rows = Array.from({ length: 20 }, (_, index) => observation(index,
      index < 10 ? "2026-10-15T12:00:00.000Z" : "2026-11-15T12:00:00.000Z"));
    const report = diagnosePintIndex(snapshot(rows));
    expect(report.admitted).toBe(false);
    expect(report.groups.map((group) => [group.month, group.distinctPubCount])).toEqual([
      ["2026-10", 10], ["2026-11", 10],
    ]);
  });

  it("groups the source instant in UTC rather than its written local month", () => {
    const report = diagnosePintIndex(snapshot([
      observation(1, "2026-11-01T00:30:00.000+01:00"),
      observation(2, "2026-11-01T00:30:00.000Z"),
    ]));
    expect(report.groups.map((group) => [group.month, group.venueIds])).toEqual([
      ["2026-10", ["pub-1"]], ["2026-11", ["pub-2"]],
    ]);
  });

  it("keeps earlier qualifying months when the same pubs have later observations", () => {
    const october = Array.from({ length: 20 }, (_, index) => observation(index, "2026-10-15T12:00:00.000Z"));
    const report = diagnosePintIndex(snapshot([...october, observation(0)]));
    expect(report.admitted).toBe(true);
    expect(report.groups.map((group) => group.distinctPubCount)).toEqual([20, 1]);
  });

  it("reports an invalid date without treating the remaining rows as an admitted snapshot", () => {
    const report = diagnosePintIndex(snapshot([observation(1, "unknown"), observation(2)]));
    expect(report.status).toBe("invalid");
    expect(report.admitted).toBeNull();
    expect(report.validObservationCount).toBeNull();
    expect(report.groups).toEqual([]);
    expect(report.records).toEqual([
      { index: 0, venueId: "pub-1", status: "rejected", reasons: ["observation 0 observedAt must be an ISO date"] },
      { index: 1, venueId: "pub-2", status: "blocked", reasons: [] },
    ]);
  });

  it("attributes an ineligible source to each observation that cites it", () => {
    const raw = snapshot([observation(1)]);
    const report = diagnosePintIndex({ ...raw, sources: [{ ...raw.sources[0], kind: "directory" }] });
    expect(report.admitted).toBeNull();
    expect(report.records[0]).toMatchObject({
      status: "rejected", reasons: ["source 0 kind is not public-index eligible"],
    });
  });

  it("retains explicit exclusions separately from an empty admitted record set", () => {
    const raw = snapshot([]);
    raw.excluded = [{ reason: "source_not_eligible_for_public_index", observationCount: 2796, note: "Legacy baseline held." }];
    const before = JSON.stringify(raw);
    const report = diagnosePintIndex(raw);
    expect(report).toMatchObject({ status: "valid", admitted: false, validObservationCount: 0, groups: [] });
    expect(report.exclusions).toEqual(raw.excluded);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("explains missing source and branch fields through the existing validator", () => {
    const raw = snapshot([observation(1)]);
    const report = diagnosePintIndex({
      ...raw, observations: [{ ...raw.observations[0], venueId: "", sourceId: "missing" }],
    });
    expect(report.records[0]?.reasons).toEqual([
      "observation 0 venueId is required", "observation 0 references an unknown source",
    ]);
    expect(report.validationErrors).toEqual(report.records[0]?.reasons);
  });

  it("returns unknown admission for malformed input", () => {
    expect(diagnosePintIndex(null)).toMatchObject({
      status: "invalid", admitted: null, records: [],
      validationErrors: ["snapshot must be an object"],
    });
  });
});
