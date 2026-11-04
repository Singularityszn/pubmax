import { describe, expect, it } from "vitest";

import { parsePlanDraft, readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";

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

  it.each([1, 3, 6])("round trips requested count %i in both draft formats", (requestedStopCount) => {
    const draft = { title: "Night", creatorName: "", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "v1", venueName: "Pub" }], requestedStopCount };
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    writePlanDraftEnvelope(draft as Parameters<typeof writePlanDraftEnvelope>[0], "manual", storage);
    expect(parsePlanDraft(values.get("pubmaxx:plan-draft:v1") ?? null)?.requestedStopCount).toBe(requestedStopCount);
    expect(readPlanDraftEnvelope(storage)?.draft.requestedStopCount).toBe(requestedStopCount);
  });

  it.each([0, 7, 1.5, "1", null])("keeps a valid route when an optional count is invalid: %s", (requestedStopCount) => {
    const raw = JSON.stringify({ title: "Night", creatorName: "", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "v1", venueName: "Pub" }], requestedStopCount });
    expect(parsePlanDraft(raw)).toMatchObject({ stops: [{ venueId: "v1" }] });
    expect(parsePlanDraft(raw)).not.toHaveProperty("requestedStopCount");
  });

  it("keeps a V2 route with an invalid optional count instead of discarding it", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const draft = { title: "Night", creatorName: "", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "v1", venueName: "Pub" }] };
    writePlanDraftEnvelope(draft, "manual", storage);
    const key = "pubmax:plan-draft:v2";
    const envelope = JSON.parse(values.get(key)!);
    envelope.draft.requestedStopCount = 99;
    values.set(key, JSON.stringify(envelope));
    const restored = readPlanDraftEnvelope(storage);
    expect(restored?.storageVersion).toBe(2);
    expect(restored?.draft.stops[0]?.venueId).toBe("v1");
    expect(restored?.draft).not.toHaveProperty("requestedStopCount");
  });

  it("retains the request count when an accepted anchor expires", () => {
    const raw = JSON.stringify({
      title: "Night", creatorName: "", startTime: "", conciergeQuery: "",
      stops: [{ key: 1, venueId: "v1", venueName: "Pub" }], requestedStopCount: 3, requestedStopCountSource: "picker",
      acceptedAnchor: { venueId: "v1", source: "near", cityId: "london", acceptedArea: null, startsAt: null, expiresAt: "2026-01-01T00:00:00.000Z" },
    });
    const draft = parsePlanDraft(raw, Date.parse("2026-01-02T00:00:00.000Z"));
    expect(draft?.requestedStopCount).toBe(3);
    expect(draft?.requestedStopCountSource).toBe("picker");
    expect(draft).not.toHaveProperty("acceptedAnchor");
    expect(draft?.stops[0]?.venueId).toBe("v1");
  });

  it.each(["text", "picker", "route-edit", "unknown", "Picker", null, 1, {}, undefined])("validates optional count origin without discarding a route: %s", (source) => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    writePlanDraftEnvelope({ title: "Night", creatorName: "", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "v1", venueName: "Pub" }], requestedStopCount: 1 }, "manual", storage);
    const envelope = JSON.parse(values.get("pubmax:plan-draft:v2")!);
    envelope.draft.requestedStopCountSource = source;
    values.set("pubmax:plan-draft:v2", JSON.stringify(envelope));
    const restored = readPlanDraftEnvelope(storage);
    expect(restored?.draft).toMatchObject({ requestedStopCount: 1, stops: [{ venueId: "v1" }] });
    const expected = source === "text" || source === "picker" || source === "route-edit" ? source : undefined;
    expect(restored?.draft.requestedStopCountSource).toBe(expected);
    delete envelope.draft.requestedStopCount;
    values.set("pubmax:plan-draft:v2", JSON.stringify(envelope));
    expect(readPlanDraftEnvelope(storage)?.draft.requestedStopCountSource).toBeUndefined();
  });

  it("rejects malformed, empty, and oversized drafts", () => {
    expect(parsePlanDraft("not-json")).toBeNull();
    expect(parsePlanDraft("{}" )).toBeNull();
    expect(parsePlanDraft(JSON.stringify({ title: "x".repeat(201) }))).toBeNull();
  });
});

it.each([
  undefined, {}, { savedAt: "yesterday", operationKey: "operation-1" },
  { savedAt: "2026-11-03T12:00:00.000Z", operationKey: "" },
  { savedAt: "2026-11-03T12:00:00.000Z", operationKey: "x".repeat(121) },
  { savedAt: "2026-11-03T12:00:00.000Z", operationKey: " operation-1" },
  { savedAt: "2026-11-03T12:00:00.000Z", operationKey: "operation-1", proof: "unexpected" },
])("keeps editable work when an optional route reference is invalid: %j", (routeReference) => {
  const now = Date.parse("2026-11-03T12:00:01.000Z");
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  writePlanDraftEnvelope({ title: "Night", creatorName: "Captain", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }] }, "manual", storage, now);
  const envelope = JSON.parse(values.get("pubmax:plan-draft:v2")!);
  envelope.draft.routeReference = routeReference;
  values.set("pubmax:plan-draft:v2", JSON.stringify(envelope));
  const restored = readPlanDraftEnvelope(storage, now);
  expect(restored).toMatchObject({ storageVersion: 2, draft: { title: "Night", stops: [{ venueId: "venue-a" }] } });
  expect(restored?.draft).not.toHaveProperty("routeReference");
  expect(parsePlanDraft(JSON.stringify(envelope.draft), now)).not.toHaveProperty("routeReference");
});

it.each([null, { savedAt: "2026-11-03T12:00:00.000Z", operationKey: "operation-1" }])("round trips route authority or explicit revocation: %j", (routeReference) => {
  const now = Date.parse("2026-11-03T12:00:01.000Z");
  const draft = { title: "Night", creatorName: "Captain", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }], routeReference };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  expect(writePlanDraftEnvelope(draft, "manual", storage, now)).toMatchObject({ v1: true, v2: true });
  expect(readPlanDraftEnvelope(storage, now)?.draft).toEqual(draft);
  expect(parsePlanDraft(values.get("pubmaxx:plan-draft:v1")!, now)).toEqual(draft);
});
