import { describe, expect, it } from "vitest";

import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import { parsePlanDraft } from "@/lib/planDraft";
import { PLANNING_INTENT_SOURCES } from "@/lib/planningIntent";

describe("parsePlanDraft", () => {
  it("recovers bounded editable plan fields", () => {
    const draft = parsePlanDraft(JSON.stringify({
      title: "Friday side quest",
      creatorName: "K",
      startTime: "2026-07-17T18:00",
      conciergeQuery: "Cheap jazz near Soho",
      stops: [{ key: 1, venueId: "v1", venueName: "The Example" }],
    }));

    expect(draft).toMatchObject({
      title: "Friday side quest",
      creatorName: "K",
      conciergeQuery: "Cheap jazz near Soho",
    });
    expect(draft?.stops).toHaveLength(1);
  });

  it("rejects malformed, empty, and oversized drafts", () => {
    expect(parsePlanDraft("not-json")).toBeNull();
    expect(parsePlanDraft("{}" )).toBeNull();
    expect(parsePlanDraft(JSON.stringify({ title: "x".repeat(201) }))).toBeNull();
  });
});

describe("parsePlanDraft accepted anchors", () => {
  const now = Date.parse("2026-07-17T12:00:00.000Z");
  const base = {
    title: "Friday side quest",
    creatorName: "K",
    startTime: "2026-07-17T18:00",
    conciergeQuery: "",
    stops: [{ key: 1, venueId: "v1", venueName: "The Example" }],
  };
  const anchor = {
    venueId: "v1",
    source: PLANNING_INTENT_SOURCES[0],
    cityId: "london",
    acceptedArea: { kind: "night-patch", id: NIGHT_PATCHES[0]!.id },
    startsAt: "2026-07-17T18:00:00.000Z",
    expiresAt: "2026-07-17T20:00:00.000Z",
  };
  const parse = (acceptedAnchor: unknown) =>
    parsePlanDraft(JSON.stringify({ ...base, acceptedAnchor }), now);

  it.each([
    ["a night patch", anchor],
    ["a borough", { ...anchor, acceptedArea: { kind: "borough", name: LONDON_BOROUGHS[0] } }],
    ["no area, city or start", { ...anchor, acceptedArea: null, cityId: null, startsAt: null }],
  ])("keeps a complete anchor for %s", (_label, accepted) => {
    expect(parse(accepted)).toEqual({ ...base, acceptedAnchor: accepted });
  });

  it("drops the legacy anchor shape and an expired anchor but keeps the draft", () => {
    const legacy = {
      venueId: anchor.venueId,
      source: anchor.source,
      cityId: anchor.cityId,
      acceptedArea: anchor.acceptedArea,
      startsAt: anchor.startsAt,
    };
    expect(parse(legacy)).toEqual(base);
    expect(parse({ ...anchor, expiresAt: "2026-07-17T11:00:00.000Z" })).toEqual(base);
  });

  it.each([
    ["a non-record", "v1"],
    ["an extra key", { ...anchor, extra: true }],
    ["an empty venue", { ...anchor, venueId: "" }],
    ["an unknown source", { ...anchor, source: "rumour" }],
    ["an unknown city", { ...anchor, cityId: "atlantis" }],
    ["a non-canonical start", { ...anchor, startsAt: "2026-07-17T18:00" }],
    ["a missing expiry", { ...anchor, expiresAt: null }],
    ["an unknown night patch", { ...anchor, acceptedArea: { kind: "night-patch", id: "nowhere" } }],
    ["an unknown borough", { ...anchor, acceptedArea: { kind: "borough", name: "Atlantis" } }],
    ["a mismatched area kind", { ...anchor, acceptedArea: { kind: "borough", id: NIGHT_PATCHES[0]!.id } }],
    ["an area with extra keys", { ...anchor, acceptedArea: { ...anchor.acceptedArea, name: "x" } }],
  ])("refuses the whole draft for %s", (_label, accepted) => {
    expect(parse(accepted)).toBeNull();
  });
});
