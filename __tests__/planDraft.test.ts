import { describe, expect, it } from "vitest";

import { parsePlanDraft, parsePlanDraftEnvelope, readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";

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

it.each([
  undefined, null, { savedAt: "2026-11-03T12:00:00.000Z", operationKey: "operation-1" },
])("preserves request ownership after acceptance expires: %j", (routeReference) => {
  const now = Date.parse("2026-11-03T12:00:00.000Z");
  const request = {
    title: "Our night", creatorName: "Captain", startTime: "2026-11-03T19:00",
    conciergeQuery: "Three pubs in Clapham", requestedStopCount: 3 as const,
    requestedStopCountSource: "text" as const,
    stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }],
    ...(routeReference !== undefined ? { routeReference } : {}),
  };
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  writePlanDraftEnvelope({ ...request, acceptedAnchor: {
    venueId: "venue-a", source: "near", cityId: "london", acceptedArea: null, startsAt: null,
    expiresAt: "2026-11-03T12:01:00.000Z",
  } }, "planning-intent", storage, now);
  expect(readPlanDraftEnvelope(storage, now + 60_000)?.draft).toEqual(request);
  expect(parsePlanDraft(values.get("pubmaxx:plan-draft:v1")!, now + 60_000)).toEqual(request);
});

describe("request drafts without stops", () => {
  const now = Date.parse("2026-11-03T12:00:00.000Z");
  const draft = { title: "Tonight, sorted", creatorName: "", startTime: "", conciergeQuery: "Quiet in Soho for 4 today at 19:00", stops: [] };
  const storage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  };

  it("writes and reads text, then a count, then an explicit empty description", () => {
    const session = storage();
    expect(writePlanDraftEnvelope(draft, "manual", session, now)).toMatchObject({ v1: true, v2: true });
    expect(readPlanDraftEnvelope(session, now)).toMatchObject({ savedAt: new Date(now).toISOString(), draft });
    const counted = { ...draft, requestedStopCount: 2 as const, requestedStopCountSource: "picker" as const };
    expect(writePlanDraftEnvelope(counted, "manual", session, now + 1)).toMatchObject({ v1: true, v2: true });
    expect(readPlanDraftEnvelope(session, now + 1)?.draft).toEqual(counted);
    const cleared = { ...counted, conciergeQuery: "", routeReference: null };
    expect(writePlanDraftEnvelope(cleared, "manual", session, now + 2)).toMatchObject({ v1: true, v2: true });
    expect(readPlanDraftEnvelope(session, now + 2)?.draft).toEqual(cleared);
    expect(parsePlanDraft(session.getItem("pubmaxx:plan-draft:v1"), now + 2)).toEqual(cleared);
  });

  it("accepts an explicit empty request as a clear, but rejects missing or malformed stops", () => {
    const empty = { ...draft, conciergeQuery: "", routeReference: null };
    expect(parsePlanDraft(JSON.stringify(empty), now)).toEqual(empty);
    expect(parsePlanDraft(JSON.stringify({ ...empty, stops: undefined }), now)).toBeNull();
    expect(parsePlanDraft(JSON.stringify({ ...empty, stops: null }), now)).toBeNull();
    expect(parsePlanDraft(JSON.stringify({ ...empty, stops: [{}] }), now)).toBeNull();
    expect(parsePlanDraft("{}", now)).toBeNull();
  });

  it("does not grant an anchor or generated route to a zero-stop request", () => {
    const session = storage();
    const anchor = { venueId: "pub", source: "near" as const, cityId: "manchester" as const, acceptedArea: null, startsAt: null, expiresAt: new Date(now + 60_000).toISOString() };
    const reference = { savedAt: new Date(now).toISOString(), operationKey: "old-operation" };
    expect(writePlanDraftEnvelope({ ...draft, acceptedAnchor: anchor }, "manual", session, now)).toMatchObject({ v1: false, v2: false });
    expect(writePlanDraftEnvelope({ ...draft, routeReference: reference }, "manual", session, now)).toMatchObject({ v1: false, v2: false });
    expect(readPlanDraftEnvelope(session, now)).toBeNull();
    const legacy = parsePlanDraft(JSON.stringify({ ...draft, groundingProof: "forged" }), now);
    expect(legacy).not.toHaveProperty("groundingProof");
    expect(legacy?.stops).toEqual([]);
  });
});

describe("provisional Stop 1 requests", () => {
  const now = Date.parse("2026-11-03T12:00:00.000Z");
  const v1 = "pubmaxx:plan-draft:v1";
  const v2 = "pubmax:plan-draft:v2";
  const request = {
    title: "Tonight, sorted", creatorName: "Captain", startTime: "", conciergeQuery: "",
    stops: [{ key: 1, venueId: "pub-a", venueName: "Pub A" }],
    provisionalStop: true as const, routeReference: null,
  };

  it.each([false, true])("round trips a released provisional pub when V2 refusal is %s", (refuseV2) => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (refuseV2 && key === v2) throw new Error("blocked");
        values.set(key, value);
      },
    };
    expect(writePlanDraftEnvelope(request, "manual", storage, now)).toMatchObject({ v1: true, v2: !refuseV2 });
    const written = { ...request, provisionalSavedAt: new Date(now).toISOString() };
    expect(parsePlanDraft(values.get(v1) ?? null, now)).toEqual(written);
    expect(readPlanDraftEnvelope(storage, now)).toMatchObject({
      legacy: refuseV2, savedAt: refuseV2 ? null : written.provisionalSavedAt, draft: written,
    });
    if (!refuseV2) expect(JSON.parse(values.get(v2)!)).toMatchObject({ savedAt: written.provisionalSavedAt, draft: written });
    expect(values.has(v2)).toBe(!refuseV2);
  });

  it("rejects invalid provisional date provenance", () => {
    for (const provisionalSavedAt of ["bad", new Date(now + 6 * 60_000).toISOString()]) {
      expect(parsePlanDraft(JSON.stringify({ ...request, provisionalSavedAt }), now)).toBeNull();
    }
    const provisionalSavedAt = new Date(now - 1).toISOString();
    expect(parsePlanDraft(JSON.stringify({ ...request, provisionalStop: undefined, provisionalSavedAt }), now)).toBeNull();
    const result = writePlanDraftEnvelope({ ...request, provisionalSavedAt }, "manual", { getItem: () => null, setItem: () => {} }, now);
    expect(result.envelope?.draft.provisionalSavedAt).toBe(new Date(now).toISOString());
    expect(parsePlanDraftEnvelope(JSON.stringify({
      ...result.envelope, draft: { ...request, provisionalSavedAt },
    }), null, now)).toBeNull();
  });

  it("rejects a provisional marker on a generated reference, a multi-stop route or an empty pub", () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("invalid draft reached storage"); } };
    const reference = { savedAt: new Date(now).toISOString(), operationKey: "generated-operation" };
    const invalid = [
      { ...request, routeReference: reference },
      { ...request, stops: [...request.stops, { key: 2, venueId: "pub-b", venueName: "Pub B" }] },
      { ...request, stops: [{ key: 1, venueId: "", venueName: "" }] },
    ];
    for (const draft of invalid) {
      expect(parsePlanDraft(JSON.stringify({ ...draft, provisionalSavedAt: new Date(now).toISOString() }), now)).toBeNull();
      expect(writePlanDraftEnvelope(draft, "manual", storage, now)).toEqual({ v1: false, v2: false, envelope: null });
    }
    expect(parsePlanDraft(JSON.stringify({ ...request, provisionalStop: false, provisionalSavedAt: new Date(now).toISOString() }), now)).toBeNull();
    expect(parsePlanDraft(JSON.stringify({ ...request, provisionalStop: undefined }), now)).toEqual({
      title: request.title, creatorName: request.creatorName, startTime: request.startTime,
      conciergeQuery: request.conciergeQuery, stops: request.stops, routeReference: null,
    });
  });
});

describe("confirmed legacy prerequisite for Plan metadata writes", () => {
  const v1 = "pubmaxx:plan-draft:v1";
  const v2 = "pubmax:plan-draft:v2";
  const now = Date.parse("2026-11-03T12:00:00.000Z");
  const draft = { title: "Night", creatorName: "Captain", startTime: "", conciergeQuery: "", stops: [] };
  const edited = { ...draft, title: "Our later night", stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }] };

  it.each([
    { lane: "V1 refused", refuse: [v1], discard: false, requireV1: true, attempts: [v1], result: { v1: false, v2: false } },
    { lane: "V2 refused", refuse: [v2], discard: false, requireV1: true, attempts: [v1, v2], result: { v1: true, v2: false } },
    { lane: "both refused", refuse: [v1, v2], discard: false, requireV1: true, attempts: [v1], result: { v1: false, v2: false } },
    { lane: "V1 discarded", refuse: [], discard: true, requireV1: true, attempts: [v1], result: { v1: false, v2: false } },
    { lane: "both writable", refuse: [], discard: false, requireV1: true, attempts: [v1, v2], result: { v1: true, v2: true } },
    { lane: "default V1 refused", refuse: [v1], discard: false, requireV1: false, attempts: [v1, v2], result: { v1: false, v2: true } },
  ])("keeps both draft records consistent with the attempt when $lane", ({ refuse, discard, requireV1, attempts, result }) => {
    const values = new Map<string, string>();
    const writes: string[] = [];
    let editing = false;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes.push(key);
        if (editing && refuse.includes(key)) throw new DOMException("Storage is full", "QuotaExceededError");
        if (editing && discard && key === v1) return;
        values.set(key, value);
      },
    };
    expect(writePlanDraftEnvelope(draft, "manual", storage, now)).toMatchObject({ v1: true, v2: true });
    const oldV1 = storage.getItem(v1);
    const oldV2 = storage.getItem(v2);
    writes.length = 0;
    editing = true;

    expect(writePlanDraftEnvelope(edited, "manual", storage, now + 1, requireV1 ? { requireV1 } : undefined)).toMatchObject(result);
    expect(writes).toEqual(attempts);
    if (result.v1) expect(parsePlanDraft(storage.getItem(v1), now + 1)).toEqual(edited);
    else expect(storage.getItem(v1)).toBe(oldV1);
    if (!result.v2) expect(storage.getItem(v2)).toBe(oldV2);
    expect(readPlanDraftEnvelope(storage, now + 1)?.draft).toEqual(result.v2 ? edited : draft);
  });
});
