import { describe, expect, it } from "vitest";

import { parsePublicCrewPreview } from "@/lib/socialCrewsUi";

const PREVIEW = {
  kind: "public",
  crewId: "50000000-0000-4000-8000-000000000001",
  title: "Friday in Camden",
  hostHandle: "host",
  startsAt: "2026-08-23T18:30:00.000Z",
  meetingPoint: {
    kind: "venue",
    name: "Camden Arms",
    lat: 51.541,
    lng: -0.142,
  },
  area: { name: "Camden Town", relation: "inside" },
  placesLeft: 3,
  spendBand: { minGbp: 4.5, maxGbp: 6.2, observedOn: "2026-11-03", sourceKind: "listed" },
};

describe("public Open Crew preview parser", () => {
  it("accepts only public preview fields", () => {
    expect(parsePublicCrewPreview(PREVIEW)).toEqual(PREVIEW);
  });

  it.each([
    ["member count", { memberCount: 2 }],
    ["visibility", { visibility: "open" }],
    ["full stop id", { stopVenueId: "venue-1" }],
    ["private plan", { plan: { id: "secret" } }],
  ])("rejects extra %s data", (_label, extra) => {
    expect(parsePublicCrewPreview({ ...PREVIEW, ...extra })).toBeNull();
  });

  it("accepts an unplaced, uncapped, unpriced crawl", () => {
    const bare = { ...PREVIEW, area: null, placesLeft: null, spendBand: null };
    expect(parsePublicCrewPreview(bare)).toEqual(bare);
  });

  it("rejects a preview missing the share facts", () => {
    const { area, placesLeft, spendBand, ...legacy } = PREVIEW;
    void area;
    void placesLeft;
    void spendBand;
    expect(parsePublicCrewPreview(legacy)).toBeNull();
  });

  it.each([
    ["negative places", { placesLeft: -1 }],
    ["fractional places", { placesLeft: 1.5 }],
    ["inverted band", { spendBand: { ...PREVIEW.spendBand, minGbp: 6, maxGbp: 4 } }],
    ["band without provenance", { spendBand: { minGbp: 4, maxGbp: 6 } }],
    ["invalid observation day", { spendBand: { ...PREVIEW.spendBand, observedOn: "2026-02-30" } }],
    ["missing observation day", { spendBand: { ...PREVIEW.spendBand, observedOn: null } }],
    ["publisher as source kind", { spendBand: { ...PREVIEW.spendBand, sourceKind: "Secret Pub" } }],
    ["band with publisher", { spendBand: { ...PREVIEW.spendBand, publisher: "Secret Pub" } }],
    ["band with stops", { spendBand: { ...PREVIEW.spendBand, stops: ["venue-1"] } }],
    ["unknown area relation", { area: { name: "Soho", relation: "far" } }],
    ["area with extra fields", { area: { name: "Soho", relation: "inside", venueId: "venue-1" } }],
  ])("rejects %s", (_label, extra) => {
    expect(parsePublicCrewPreview({ ...PREVIEW, ...extra })).toBeNull();
  });

  it("rejects invalid meeting points and identifiers", () => {
    expect(parsePublicCrewPreview({ ...PREVIEW, crewId: "bad" })).toBeNull();
    expect(parsePublicCrewPreview({
      ...PREVIEW,
      meetingPoint: { ...PREVIEW.meetingPoint, lat: 200 },
    })).toBeNull();
    expect(parsePublicCrewPreview({
      ...PREVIEW,
      meetingPoint: { ...PREVIEW.meetingPoint, kind: "unknown" },
    })).toBeNull();
  });
});
