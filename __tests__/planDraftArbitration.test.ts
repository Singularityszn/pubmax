import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  PLAN_DRAFT_KEY,
  PLAN_DRAFT_TTL_MS,
  PLAN_DRAFT_V2_KEY,
  parsePlanDraftEnvelope,
  readPlanDraftEnvelope,
  writePlanDraftEnvelope,
  type ParsedPlanDraft,
  type StoredPlanDraft,
} from "@/lib/planDraft";
import { arbitratePlanDrafts, recoverPlanDrafts, resolveRequestedPlanIntent } from "@/lib/planDraftArbitration";
import {
  PLAN_INTAKE_MAX_RAW_BYTES,
  PLAN_INTAKE_STORAGE_KEY,
  createPlanIntakeDraft,
  parsePlanIntakeDraftWithMetadata,
  readPlanIntakeDraftWithMetadata,
  writePlanIntakeDraft,
  type ParsedPlanIntakeDraft,
} from "@/lib/planIntake";
import {
  PLAN_ROUTE_DRAFT_KEY,
  PLAN_ROUTE_DRAFT_TTL_MS,
  PLAN_ROUTE_DRAFT_V2_KEY,
  parsePlanRouteDraftEnvelope,
  parsePlanRouteDraftV2,
  readPlanRouteDraftEnvelope,
  reconcilePlanRouteDrafts,
  writePlanRouteDraftEnvelope,
  type ParsedPlanRouteDraft,
} from "@/lib/planRouteDraft";
import { createPlanningIntent } from "@/lib/planningIntent";
import { inferNightContext } from "@/lib/nightPlanning";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function memoryStorage(options: { throwOnSet?: number } = {}): Storage {
  const values = new Map<string, string>();
  let writes = 0;
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => {
      writes += 1;
      if (options.throwOnSet === writes) throw new Error("blocked");
      values.set(key, String(value));
    },
  };
}

function storedPlan(overrides: Partial<StoredPlanDraft> = {}): StoredPlanDraft {
  return {
    title: "Friday Plan",
    creatorName: "K",
    startTime: "2026-07-24T18:00:00.000Z",
    conciergeQuery: "Quiet pints",
    stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A" }],
    ...overrides,
  };
}

function v2Plan(savedAt: number, overrides: Partial<StoredPlanDraft> = {}): ParsedPlanDraft {
  const storage = memoryStorage();
  expect(writePlanDraftEnvelope(storedPlan(overrides), "manual", storage, savedAt).v2).toBe(true);
  const parsed = readPlanDraftEnvelope(storage, savedAt);
  expect(parsed).not.toBeNull();
  return parsed as ParsedPlanDraft;
}

function intake(savedAt: number, start = "2026-07-24T19:00:00.000Z"): ParsedPlanIntakeDraft {
  const storage = memoryStorage();
  const blank = createPlanIntakeDraft();
  writePlanIntakeDraft({
    ...blank,
    currentStep: "group-size",
    settledSteps: ["area", "time-window"],
    answers: {
      ...blank.answers,
      area: "soho",
      timeWindow: "evening",
      exactStartIso: start,
    },
  }, storage, savedAt);
  const parsed = readPlanIntakeDraftWithMetadata(storage, savedAt);
  expect(parsed).not.toBeNull();
  return parsed as ParsedPlanIntakeDraft;
}

describe("requested-count recovery", () => {
  const plan = v2Plan(NOW, { requestedStopCount: 1 });
  const local = intake(NOW);
  const localCount = (count: 1 | 3 | 5, savedAt: number): ParsedPlanIntakeDraft => ({
    ...local, savedAt: new Date(savedAt).toISOString(),
    draft: { ...local.draft, answers: { ...local.draft.answers, stopCount: count } },
  });
  it.each([
    { sessionAge: 0, intakeAge: 1, source: "picker" },
    { sessionAge: 1, intakeAge: 0, source: "text" },
    { sessionAge: 0, intakeAge: 0, source: "text" },
  ])("selects count origin with its winning clock: $sessionAge/$intakeAge", ({ sessionAge, intakeAge, source }) => {
    const saved = v2Plan(NOW + sessionAge, { requestedStopCount: 1, requestedStopCountSource: "text" });
    const storage = memoryStorage();
    writePlanIntakeDraft({ ...local.draft, answers: { ...local.draft.answers, stopCount: 1, stopCountSource: "picker" } }, storage, NOW + intakeAge);
    const localCopy = readPlanIntakeDraftWithMetadata(storage, NOW + 1);
    expect(resolveRequestedPlanIntent(saved, saved.draft, localCopy)).toMatchObject({ stopCount: 1, stopCountSource: source });
    expect(resolveRequestedPlanIntent(null, null, localCopy)).toMatchObject({ stopCount: 1, stopCountSource: "picker" });
    expect(resolveRequestedPlanIntent(saved, saved.draft, null)).toMatchObject({ stopCount: 1, stopCountSource: "text" });
  });

  it("preserves validated legacy origin without inventing an order for competing requests", () => {
    const saved = v2Plan(NOW, { requestedStopCount: 1, requestedStopCountSource: "picker" });
    const conflicting = { ...saved.draft, requestedStopCountSource: "text" as const };
    expect(resolveRequestedPlanIntent(saved, conflicting, null)).toEqual({ stopCount: 1, conciergeQuery: "", descriptionUnavailable: true });
    const legacy: ParsedPlanDraft = { ...saved, legacy: true, savedAt: null };
    expect(resolveRequestedPlanIntent(legacy, saved.draft, null).stopCountSource).toBe("picker");
    expect(legacy.savedAt).toBeNull();
    expect(resolveRequestedPlanIntent(legacy, saved.draft, local).stopCountSource).toBeUndefined();
    const unknown = v2Plan(NOW + 1);
    const oldPicker = { ...localCount(5, NOW), draft: { ...local.draft, answers: { ...local.draft.answers, stopCount: 5 as const, stopCountSource: "picker" as const } } };
    expect(resolveRequestedPlanIntent(unknown, unknown.draft, oldPicker)).toEqual({ stopCount: undefined, conciergeQuery: "Quiet pints", descriptionUnavailable: false });
  });
  it("recovers the route and request together without turning returned stops into intent", () => {
    const older = v2Plan(NOW, { conciergeQuery: "Six pubs in Soho tonight", requestedStopCount: 6 });
    const recovered = recoverPlanDrafts({
      plan: older, legacyDraft: older.draft, intake: localCount(5, NOW), route: routeDraft(NOW + 1),
    });
    expect(recovered.routeWins).toBe(true);
    expect(recovered.planDraft).toBeNull();
    expect(recovered.recoveredDraft).toBeNull();
    expect(recovered.intakeDraft).toBeNull();
    expect(recovered.intent).toEqual({ stopCount: undefined, conciergeQuery: "", descriptionUnavailable: false });
  });

  it.each([NOW - 1, NOW, null])("preserves the request when the route date is %s", (routeTime) => {
    const current = v2Plan(NOW, { conciergeQuery: "One pub in Clapham tonight", requestedStopCount: 1 });
    const recovered = recoverPlanDrafts({
      plan: current, legacyDraft: current.draft, intake: localCount(5, NOW - 1),
      route: { ...routeDraft(NOW), savedAt: routeTime === null ? null : new Date(routeTime).toISOString() },
    });
    expect(recovered.routeWins).toBe(false);
    expect(recovered.intent).toEqual({ stopCount: 1, conciergeQuery: "One pub in Clapham tonight", descriptionUnavailable: false });
    expect(recovered.sessionWins).toBe(routeTime === NOW - 1);
  });

  it("recovers session stops as a preview without dating an unconflicted legacy route", () => {
    const current = v2Plan(NOW, { conciergeQuery: "One pub in Clapham tonight", requestedStopCount: 1 });
    const recovered = recoverPlanDrafts({
      plan: current, legacyDraft: current.draft, intake: localCount(1, NOW),
      route: { ...routeDraft(NOW), savedAt: null, conflicting: false },
    });
    expect(recovered.routeWins).toBe(false);
    expect(recovered.sessionWins).toBe(true);
    expect(recovered.intent).toEqual({ stopCount: 1, conciergeQuery: "One pub in Clapham tonight", descriptionUnavailable: false });
  });

  it.each([NOW + 1, NOW + 2])("preserves a local request saved at %s while reporting its unavailable description", (savedAt) => {
    const older = v2Plan(NOW, { conciergeQuery: "One pub in Soho tonight", requestedStopCount: 1 });
    const recovered = recoverPlanDrafts({
      plan: older, legacyDraft: older.draft, intake: localCount(5, savedAt),
      route: routeDraft(NOW + 1),
    });
    expect(recovered.intent).toEqual({ stopCount: 5, conciergeQuery: "", descriptionUnavailable: true });
  });
  it("uses the available store and compares the versioned save times", () => {
    expect(resolveRequestedPlanIntent(plan, plan.draft, null).stopCount).toBe(1);
    expect(resolveRequestedPlanIntent(null, null, localCount(5, NOW)).stopCount).toBe(5);
    expect(resolveRequestedPlanIntent(plan, plan.draft, localCount(5, NOW + 1)).stopCount).toBe(5);
    expect(resolveRequestedPlanIntent(plan, plan.draft, localCount(5, NOW - 1)).stopCount).toBe(1);
    expect(resolveRequestedPlanIntent(plan, plan.draft, localCount(5, NOW)).stopCount).toBe(1);
    const unknown = v2Plan(NOW + 1);
    expect(resolveRequestedPlanIntent(unknown, unknown.draft, localCount(5, NOW)).stopCount).toBeUndefined();
  });
  it("does not invent an ordering for legacy or conflicting session copies", () => {
    const legacy: ParsedPlanDraft = { ...plan, storageVersion: 1, savedAt: null, expiresAt: null, legacy: true };
    expect(resolveRequestedPlanIntent(legacy, legacy.draft, localCount(5, NOW + 1)).stopCount).toBeUndefined();
    expect(resolveRequestedPlanIntent(legacy, legacy.draft, localCount(1, NOW + 1)).stopCount).toBe(1);
    expect(resolveRequestedPlanIntent(plan, { ...plan.draft, requestedStopCount: 3 }, localCount(5, NOW + 1)).stopCount).toBeUndefined();
  });

  it("restores a saved picker count when the undated request has no count", () => {
    const saved = v2Plan(NOW, { requestedStopCount: undefined });
    const legacy: ParsedPlanDraft = { ...saved, storageVersion: 1, savedAt: null, expiresAt: null, legacy: true };
    const picker = {
      ...localCount(5, NOW + 1),
      draft: { ...local.draft, answers: { ...local.draft.answers, stopCount: 5 as const, stopCountSource: "picker" as const } },
    };
    expect(resolveRequestedPlanIntent(legacy, legacy.draft, picker)).toEqual({
      stopCount: 5, stopCountSource: "picker", conciergeQuery: "", descriptionUnavailable: true,
    });
    const matching = { ...legacy, draft: { ...legacy.draft, requestedStopCount: 5 as const } };
    expect(resolveRequestedPlanIntent(matching, matching.draft, picker)).toEqual({
      stopCount: 5, conciergeQuery: "", descriptionUnavailable: true,
    });
  });

  it("discards a description when only newer local intent survives", () => {
    const stale = v2Plan(NOW, { conciergeQuery: "Six pubs in Clapham tonight", requestedStopCount: 6 });
    const unknown = { ...local, savedAt: new Date(NOW + 1).toISOString() };
    expect(resolveRequestedPlanIntent(stale, stale.draft, unknown)).toEqual({
      stopCount: undefined, conciergeQuery: "", descriptionUnavailable: true,
    });
    expect(resolveRequestedPlanIntent(stale, stale.draft, localCount(5, NOW + 1))).toEqual({
      stopCount: 5, conciergeQuery: "", descriptionUnavailable: true,
    });
  });

  it("keeps the session description and count together for equal or newer session saves", () => {
    const saved = v2Plan(NOW, { conciergeQuery: "One pub in Clapham tonight", requestedStopCount: 1 });
    for (const savedAt of [NOW - 1, NOW]) {
      expect(resolveRequestedPlanIntent(saved, saved.draft, localCount(5, savedAt))).toEqual({
        stopCount: 1, conciergeQuery: "One pub in Clapham tonight", descriptionUnavailable: false,
      });
    }
  });

  it("does not restore uncertain descriptions from undated or conflicting session copies", () => {
    const saved = v2Plan(NOW, { conciergeQuery: "Six pubs in Clapham tonight", requestedStopCount: 1 });
    const legacy: ParsedPlanDraft = { ...saved, storageVersion: 1, savedAt: null, expiresAt: null, legacy: true };
    expect(resolveRequestedPlanIntent(legacy, legacy.draft, localCount(1, NOW))).toEqual({
      stopCount: 1, conciergeQuery: "", descriptionUnavailable: true,
    });
    expect(resolveRequestedPlanIntent(saved, { ...saved.draft, conciergeQuery: "A different description" }, local)).toEqual({
      stopCount: 1, conciergeQuery: "", descriptionUnavailable: true,
    });
  });
});

function routeValue(overrides: Partial<ParsedPlanRouteDraft["value"]> = {}): ParsedPlanRouteDraft["value"] {
  return {
    anchorVenueId: "venue-a",
    anchorSource: "near",
    outcome: "route",
    stops: [
      { key: 1, venueId: "venue-a", venueName: "Venue A", alternatives: [] },
      { key: 2, venueId: "venue-b", venueName: "Venue B", alternatives: [] },
      { key: 3, venueId: "venue-c", venueName: "Venue C", alternatives: [] },
    ],
    alternatives: [],
    nightContext: null,
    routeTotals: null,
    transportBasis: null,
    planningConfidence: null,
    warnings: [],
    groundingProof: fakeProof(NOW + 60 * 60 * 1000),
    operationKey: "operation-1",
    routeRevision: 1,
    routeStale: false,
    ...overrides,
  };
}

function routeDraft(savedAt: number, overrides: Partial<ParsedPlanRouteDraft["value"]> = {}): ParsedPlanRouteDraft {
  const storage = memoryStorage();
  expect(writePlanRouteDraftEnvelope(routeValue(overrides), "plan-generated", storage, savedAt).v2).toBe(true);
  const parsed = readPlanRouteDraftEnvelope(storage, savedAt);
  expect(parsed).not.toBeNull();
  return parsed as ParsedPlanRouteDraft;
}

function intent() {
  const value = createPlanningIntent({
    source: "near",
    cityId: "london",
    acceptedVenueId: "venue-intent",
    acceptedArea: { kind: "night-patch", id: "shoreditch" },
    startsAt: "2026-07-24T20:00:00.000Z",
    displayEvidence: { kind: "directory", observedAt: null },
  }, NOW);
  expect(value).not.toBeNull();
  return value;
}

function fakeProof(expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, expiresAt }), "utf8").toString("base64url");
  return `${payload}.not-a-trusted-signature`;
}

describe("V2 Plan draft migration", () => {
  it("dual-writes V1 and V2, then prefers the valid V2 envelope", () => {
    const storage = memoryStorage();
    const result = writePlanDraftEnvelope(storedPlan(), "template", storage, NOW);
    expect(result).toMatchObject({ v1: true, v2: true });
    expect(storage.getItem(PLAN_DRAFT_KEY)).not.toBeNull();
    expect(storage.getItem(PLAN_DRAFT_V2_KEY)).not.toBeNull();
    expect(readPlanDraftEnvelope(storage, NOW)).toMatchObject({
      storageVersion: 2,
      savedAt: "2026-07-24T12:00:00.000Z",
      origin: "template",
      legacy: false,
    });
  });

  it("falls back to populated legacy work without inventing savedAt", () => {
    const legacy = JSON.stringify(storedPlan());
    expect(parsePlanDraftEnvelope(null, legacy, NOW)).toMatchObject({
      storageVersion: 1,
      savedAt: null,
      expiresAt: null,
      legacy: true,
    });
  });

  it("rejects expired, oversized, and unknown-key V2 envelopes", () => {
    const storage = memoryStorage();
    writePlanDraftEnvelope(storedPlan(), "manual", storage, NOW);
    const raw = storage.getItem(PLAN_DRAFT_V2_KEY);
    expect(parsePlanDraftEnvelope(raw, null, NOW + PLAN_DRAFT_TTL_MS)).toBeNull();
    expect(parsePlanDraftEnvelope(JSON.stringify({
      ...JSON.parse(raw ?? "{}"),
      unexpected: true,
    }), null, NOW)).toBeNull();
    expect(parsePlanDraftEnvelope("x".repeat(20 * 1024 + 1), null, NOW)).toBeNull();
  });

  it("attempts both migration writes without throwing when storage fails", () => {
    const result = writePlanDraftEnvelope(storedPlan(), "manual", memoryStorage({ throwOnSet: 1 }), NOW);
    expect(result).toMatchObject({ v1: false, v2: true });
  });
});

describe("V2 Route draft migration", () => {
  it("preserves an old V1 listed row's valid read day through the V1 and V2 rewrite", () => {
    const storage = memoryStorage();
    const oldReadDays = [
      "2026-07-23T12:00:00.000Z",
      "2026-07",
      "2026-02-30",
      "2026-07-25",
      "2026-07-24T12:00:01.000Z",
    ];
    storage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({
      stops: oldReadDays.map((priceObservedAt, index) => ({
        key: index + 1,
        venueId: `venue-${index + 1}`,
        venueName: `Venue ${index + 1}`,
        estimatedPintPricePence: 289,
        priceKind: "listed",
        priceObservedAt,
        alternatives: [],
      })),
      nightContext: null,
      routeNight: null,
      routeRevision: null,
      routeStale: false,
      groundingProof: null,
      createOperationKey: null,
      planAnchor: null,
    }));

    const expectedQuote = {
      venueId: "venue-1", pence: 289, serving: null,
      source: { label: null, url: null, observedAt: "2026-07-23T12:00:00.000Z" },
    };
    const legacy = readPlanRouteDraftEnvelope(storage, NOW)!;
    expect(legacy).toMatchObject({ storageVersion: 1, legacy: true });
    expect(legacy.value.stops[0]).toMatchObject({
      priceKind: "listed", estimatedPintPricePence: 289, pintPriceEvidence: expectedQuote,
    });
    for (const stop of legacy.value.stops.slice(1)) {
      expect(stop).toMatchObject({ priceKind: "listed", estimatedPintPricePence: 289 });
      expect(stop).not.toHaveProperty("pintPriceEvidence");
    }

    expect(writePlanRouteDraftEnvelope(legacy.value, legacy.origin, storage, NOW))
      .toMatchObject({ v1: true, v2: true });
    for (const key of [PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]) {
      const { stops } = JSON.parse(storage.getItem(key)!);
      expect(stops[0].pintPriceEvidence).toEqual(expectedQuote);
    }
    const restored = readPlanRouteDraftEnvelope(storage, NOW);
    expect(restored).toMatchObject({ storageVersion: 2, legacy: false });
    expect(restored?.value.stops[0]?.pintPriceEvidence).toEqual(expectedQuote);
  });

  it("keeps the selected pint quote on both stops and swaps through both draft formats", () => {
    const storage = memoryStorage();
    const quote = (venueId: string) => ({
      estimatedPintPricePence: 289,
      priceKind: "listed",
      pintPriceEvidence: {
        venueId,
        pence: 289,
        serving: "pint",
        source: { label: "Pub menu", url: "https://example.com/menu", observedAt: "2026-07-23" },
      },
    } as const);
    const firstQuote = quote("venue-a");
    const swapQuote = quote("venue-x");
    const pricedStops = routeValue().stops.map((stop, index) => {
      if (index === 0) {
        return {
          ...stop, ...firstQuote,
          alternatives: [{ venueId: "venue-x", venueName: "Venue X", ...swapQuote }],
        };
      }
      return index === 1 ? { ...stop, ...firstQuote } : stop;
    });
    expect(writePlanRouteDraftEnvelope(routeValue({ stops: pricedStops }), "plan-generated", storage, NOW))
      .toMatchObject({ v1: true, v2: true });
    for (const key of [PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]) {
      const { stops } = JSON.parse(storage.getItem(key)!);
      expect(stops[0]).toMatchObject({ ...firstQuote, alternatives: [swapQuote] });
      expect(stops[1]).toMatchObject({ venueId: "venue-b", estimatedPintPricePence: 289, priceKind: "estimated" });
      expect(stops[1]).not.toHaveProperty("pintPriceEvidence");
    }
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value.stops[0])
      .toMatchObject({ ...firstQuote, alternatives: [swapQuote] });
  });

  it("does not publish unfinished stops as a complete route envelope", () => {
    const storage = memoryStorage();
    const result = writePlanRouteDraftEnvelope(routeValue({ stops: [
      { key: 1, venueId: "", venueName: "", alternatives: [] },
    ] }), "manual", storage, NOW);
    expect(result).toMatchObject({ v1: false, v2: false, envelope: null });
    expect(storage.length).toBe(0);
  });

  it.each([null, NOW - 1, NOW, NOW + 1].flatMap((savedAt) => [0, 1, 3].map((blankIndex) => ({ savedAt, blankIndex }))))(
    "recovers an unfinished V1 slot at $blankIndex with date $savedAt conservatively",
    ({ savedAt, blankIndex }) => {
      const storage = memoryStorage();
      writePlanRouteDraftEnvelope(routeValue(), "map-generated", storage, NOW);
      const unfinished = JSON.parse(storage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
      unfinished.stops.splice(blankIndex, 0, { key: blankIndex + 1, venueId: "", venueName: "", alternatives: [] });
      if (savedAt === null) delete unfinished.savedAt;
      else unfinished.savedAt = new Date(savedAt).toISOString();
      storage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(unfinished));
      const recovered = readPlanRouteDraftEnvelope(storage, NOW + 1)!;
      if (savedAt === NOW - 1) {
        expect(recovered.value.stops).toHaveLength(3);
        expect(recovered.value.anchorVenueId).toBe("venue-a");
      } else {
        expect(recovered.savedAt).toBe(savedAt === null ? null : new Date(savedAt).toISOString());
        expect(recovered.value.stops).toHaveLength(4);
        expect(recovered.value.stops[blankIndex]).toMatchObject({ venueId: "", venueName: "" });
        expect(recovered.value).toMatchObject({
          nightContext: null, routeTotals: null, transportBasis: null, planningConfidence: null,
          groundingProof: null, operationKey: null, anchorVenueId: null, anchorSource: null,
          routeRevision: null, routeStale: true, outcome: "unanchored",
        });
      }
    },
  );

  it.each(["changed", "absent"])("does not borrow a stale envelope's anchor or date after the anchor is %s", (anchor) => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "map-generated", storage, NOW);
    const oldV2 = storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!;
    const next = routeValue(anchor === "changed"
      ? { anchorSource: "map-search" }
      : { anchorVenueId: null, anchorSource: null, outcome: "unanchored" });
    const partial = {
      getItem: storage.getItem.bind(storage),
      setItem: (key: string, value: string) => {
        if (key === PLAN_ROUTE_DRAFT_V2_KEY) throw new Error("quota");
        storage.setItem(key, value);
      },
    };
    expect(writePlanRouteDraftEnvelope(next, "map-generated", partial, NOW + 1)).toMatchObject({ v1: true, v2: false });
    const recovered = readPlanRouteDraftEnvelope(storage, NOW + 1);
    expect(recovered?.savedAt).toBe("2026-07-24T12:00:00.001Z");
    expect(recovered?.value.anchorSource).toBe(anchor === "changed" ? "map-search" : null);
    expect(recovered?.value.groundingProof).toBe(next.groundingProof);
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(oldV2);
  });

  it.each(["V1", "V2"])("selects the complete dated record when only %s saves a new handoff", (written) => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "map-generated", storage, NOW);
    const oldRecord = storage.getItem(written === "V1" ? PLAN_ROUTE_DRAFT_V2_KEY : PLAN_ROUTE_DRAFT_KEY);
    const next = routeValue({
      anchorVenueId: null, anchorSource: null, outcome: "unanchored",
      operationKey: "new-operation", routeRevision: 2,
      nightContext: { ...inferNightContext("Clapham tonight").context, nightArea: "clapham", transportConstraints: [] },
    });
    const partial = {
      getItem: storage.getItem.bind(storage),
      setItem: (key: string, value: string) => {
        if (key === (written === "V1" ? PLAN_ROUTE_DRAFT_V2_KEY : PLAN_ROUTE_DRAFT_KEY)) throw new Error("quota");
        storage.setItem(key, value);
      },
    };
    expect(writePlanRouteDraftEnvelope(next, "map-generated", partial, NOW + 1))
      .toMatchObject({ v1: written === "V1", v2: written === "V2" });
    const recovered = readPlanRouteDraftEnvelope(storage, NOW + 1);
    expect(recovered?.savedAt).toBe("2026-07-24T12:00:00.001Z");
    expect(recovered?.value).toMatchObject({
      anchorVenueId: null, anchorSource: null, outcome: "unanchored", operationKey: "new-operation",
      routeRevision: 2, groundingProof: next.groundingProof, routeStale: false,
      nightContext: { nightArea: "clapham", transportConstraints: [] },
    });
    expect(storage.getItem(written === "V1" ? PLAN_ROUTE_DRAFT_V2_KEY : PLAN_ROUTE_DRAFT_KEY)).toBe(oldRecord);
  });

  it("keeps equally dated conflicting routes unverified", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "map-generated", storage, NOW);
    const oldV2 = storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!;
    writePlanRouteDraftEnvelope(routeValue({ operationKey: "replacement", anchorSource: "map-search" }), "map-generated", storage, NOW);
    storage.setItem(PLAN_ROUTE_DRAFT_V2_KEY, oldV2);
    expect(readPlanRouteDraftEnvelope(storage, NOW)).toMatchObject({
      savedAt: "2026-07-24T12:00:00.000Z",
      value: { anchorVenueId: null, anchorSource: null, groundingProof: null, operationKey: null, routeStale: true },
    });
  });

  it("recovers the valid V2 route when its V1 copy is invalid", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "map-generated", storage, NOW);
    storage.setItem(PLAN_ROUTE_DRAFT_KEY, "invalid");
    expect(readPlanRouteDraftEnvelope(storage, NOW)).toMatchObject({
      savedAt: "2026-07-24T12:00:00.000Z", legacy: false,
      value: { anchorVenueId: "venue-a", operationKey: "operation-1", routeRevision: 1 },
    });
  });

  it("keeps an undated conflicting route as an unverified preview", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "map-generated", storage, NOW);
    const raw = JSON.parse(storage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    delete raw.savedAt;
    delete raw.anchorVenueId;
    delete raw.anchorSource;
    delete raw.outcome;
    const recovered = reconcilePlanRouteDrafts(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY), JSON.stringify(raw), NOW);
    expect(recovered.conflicting).toBe(true);
    expect(recovered.envelope).toMatchObject({
      savedAt: null,
      value: { anchorVenueId: null, anchorSource: null, groundingProof: null, operationKey: null, routeStale: true },
    });
    expect(recovered.envelope?.value.stops.map((stop) => stop.venueId)).toEqual(["venue-a", "venue-b", "venue-c"]);
  });

  it("keeps selected wine price evidence on stops and swaps through both draft formats", () => {
    const storage = memoryStorage();
    const wine = {
      category: "wine", pence: 550, serving: null, source: "community",
      reportedAt: "2026-07-23T12:00:00.000Z",
    } as const;
    const pricedStops = routeValue().stops.map((stop, index) => index === 0
      ? { ...stop, selectedDrinkPriceEvidence: wine, alternatives: [{
          venueId: "venue-x", venueName: "Venue X", selectedDrinkPriceEvidence: wine,
        }] }
      : stop);

    expect(writePlanRouteDraftEnvelope(routeValue({
      stops: pricedStops,
      nightContext: inferNightContext("wine in Soho", new Date(NOW)).context,
    }), "plan-generated", storage, NOW).v2).toBe(true);
    for (const raw of [storage.getItem(PLAN_ROUTE_DRAFT_KEY), storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)]) {
      expect(raw).toContain('"selectedDrinkPriceEvidence"');
    }
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value.stops[0]).toMatchObject({
      selectedDrinkPriceEvidence: wine,
      alternatives: [{ selectedDrinkPriceEvidence: wine }],
    });

    const forged = JSON.parse(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY) ?? "{}") as {
      stops: Array<{ selectedDrinkPriceEvidence?: unknown; alternatives: Array<{ selectedDrinkPriceEvidence?: unknown }> }>;
    };
    forged.stops[0]!.selectedDrinkPriceEvidence = { ...wine, serving: "175ml" };
    forged.stops[0]!.alternatives[0]!.selectedDrinkPriceEvidence = { ...wine, category: "beer" };
    expect(parsePlanRouteDraftV2(JSON.stringify(forged), NOW)?.value.stops[0]).toEqual({
      key: 1, venueId: "venue-a", venueName: "Venue A",
      alternatives: [{ venueId: "venue-x", venueName: "Venue X" }],
    });
  });

  it("drops stored drink prices that disagree with selected category", () => {
    const wine = {
      category: "wine", pence: 550, serving: null, source: "community",
      reportedAt: "2026-07-23T12:00:00.000Z",
    } as const;
    const stops = routeValue().stops.map((stop, index) => index === 0
      ? { ...stop, selectedDrinkPriceEvidence: wine, alternatives: [{
          venueId: "venue-x", venueName: "Venue X", selectedDrinkPriceEvidence: wine,
        }] }
      : stop);
    for (const context of [
      null,
      inferNightContext("cocktails in Soho", new Date(NOW)).context,
      inferNightContext("beer in Soho", new Date(NOW)).context,
      { ...inferNightContext("wine in Soho", new Date(NOW)).context, zeroProof: true },
    ]) {
      const storage = memoryStorage();
      writePlanRouteDraftEnvelope(routeValue({
        stops,
        alternatives: [{ venueId: "venue-y", venueName: "Venue Y", selectedDrinkPriceEvidence: wine }],
        nightContext: context,
      }), "plan-generated", storage, NOW);
      const restoredDraft = readPlanRouteDraftEnvelope(storage, NOW)?.value;
      const restored = restoredDraft?.stops[0];
      expect(restored?.selectedDrinkPriceEvidence).toBeUndefined();
      expect(restored?.alternatives[0]?.selectedDrinkPriceEvidence).toBeUndefined();
      expect(restoredDraft?.alternatives[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    }
  });

  it("dual-writes compatible Route drafts and preserves replay metadata", () => {
    const storage = memoryStorage();
    expect(writePlanRouteDraftEnvelope(routeValue(), "map-generated", storage, NOW)).toMatchObject({
      v1: true,
      v2: true,
    });
    expect(storage.getItem(PLAN_ROUTE_DRAFT_KEY)).not.toBeNull();
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).not.toBeNull();
    expect(readPlanRouteDraftEnvelope(storage, NOW)).toMatchObject({
      storageVersion: 2,
      origin: "map-generated",
      legacy: false,
      value: { operationKey: "operation-1", routeRevision: 1 },
    });
  });

  it("recovers a legacy Route without assigning it an age", () => {
    const raw = JSON.stringify({
      stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A", alternatives: [] }],
      nightContext: null,
      routeRevision: 2,
      routeStale: false,
      groundingProof: null,
      createOperationKey: "legacy-operation",
    });
    expect(parsePlanRouteDraftEnvelope(null, raw, NOW)).toMatchObject({
      storageVersion: 1,
      savedAt: null,
      legacy: true,
      value: { operationKey: "legacy-operation", routeRevision: 2 },
    });
  });

  it("keeps an unexpired proof only as display context and marks expired proof stale", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue({
      groundingProof: fakeProof(NOW + 1_000),
    }), "plan-generated", storage, NOW);
    const raw = storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
    expect(parsePlanRouteDraftV2(raw, NOW)).toMatchObject({
      value: { routeStale: false, groundingProof: expect.any(String) },
    });
    expect(parsePlanRouteDraftV2(raw, NOW + 1_001)).toMatchObject({
      value: { routeStale: true, groundingProof: null },
    });
  });

  it("rejects inconsistent outcome, anchor, and Stop counts", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "plan-generated", storage, NOW);
    const envelope = JSON.parse(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY) ?? "{}") as Record<string, unknown>;
    // One Stop is a listed route size now (lib/planStopCount.ts), so it parses.
    envelope.stops = [routeValue().stops[0]];
    expect(parsePlanRouteDraftV2(JSON.stringify(envelope), NOW)).toMatchObject({
      value: { outcome: "route" },
    });
    // A count outside the table is still rejected.
    expect(parsePlanRouteDraftV2(JSON.stringify({ ...envelope, stops: [] }), NOW)).toBeNull();

    const wrongAnchor = {
      ...envelope,
      stops: routeValue().stops,
      anchorVenueId: "venue-other",
    };
    expect(parsePlanRouteDraftV2(JSON.stringify(wrongAnchor), NOW)).toBeNull();
  });

  it("rejects expired envelopes and survives partial storage failure", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "manual", storage, NOW);
    expect(parsePlanRouteDraftV2(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY), NOW + PLAN_ROUTE_DRAFT_TTL_MS)).toBeNull();
    expect(writePlanRouteDraftEnvelope(routeValue(), "manual", memoryStorage({ throwOnSet: 2 }), NOW))
      .toMatchObject({ v1: true, v2: false, envelope: null });
  });
});

describe("Plan intake metadata access", () => {
  it("preserves canonical savedAt for cross-draft precedence", () => {
    const storage = memoryStorage();
    writePlanIntakeDraft(createPlanIntakeDraft(), storage, NOW);
    expect(readPlanIntakeDraftWithMetadata(storage, NOW)).toMatchObject({
      storageVersion: 1,
      savedAt: "2026-07-24T12:00:00.000Z",
      legacy: false,
    });
    expect(parsePlanIntakeDraftWithMetadata(storage.getItem(PLAN_INTAKE_STORAGE_KEY), NOW)?.draft)
      .toEqual(createPlanIntakeDraft());
  });

  it("enforces the 12 KB bound in UTF-8 bytes", () => {
    const storage = memoryStorage();
    writePlanIntakeDraft(createPlanIntakeDraft(), storage, NOW);
    const envelope = JSON.parse(storage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    envelope.padding = "é".repeat(Math.floor(PLAN_INTAKE_MAX_RAW_BYTES / 2));
    const raw = JSON.stringify(envelope);
    expect(raw.length).toBeLessThan(PLAN_INTAKE_MAX_RAW_BYTES);
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(PLAN_INTAKE_MAX_RAW_BYTES);
    expect(parsePlanIntakeDraftWithMetadata(raw, NOW)).toBeNull();
  });
});

describe("pure Plan draft arbitration", () => {
  it("uses explicit URL surface and defaults only after clean arbitration", () => {
    expect(arbitratePlanDrafts({
      url: { surface: "map", selectedVenueId: null, replaceAnchor: false },
      defaults: {
        area: { kind: "night-patch", id: "camden" },
        startsAt: "2026-07-24T18:30:00.000Z",
        acceptedVenueId: "default-venue",
        title: "Untitled Plan",
      },
    })).toMatchObject({
      surface: { value: "map", source: "explicit-url" },
      acceptedVenueId: { value: "default-venue", source: "default" },
      area: { value: { kind: "night-patch", id: "camden" }, source: "default" },
      title: { value: "Untitled Plan", source: "default" },
      routePreview: null,
      conflicts: [],
      hydration: { status: "complete", defaultsMayWrite: true },
    });
  });

  it("uses newest valid V2 savedAt where Plan and intake time overlap", () => {
    const newerPlan = arbitratePlanDrafts({
      planDraft: v2Plan(NOW + 2_000),
      intakeDraft: intake(NOW + 1_000),
    });
    expect(newerPlan.startsAt).toEqual({
      value: "2026-07-24T18:00:00.000Z",
      source: "plan-v2",
    });
    expect(newerPlan.conflicts).toContainEqual(expect.objectContaining({ code: "draft-overlap" }));

    const newerIntake = arbitratePlanDrafts({
      planDraft: v2Plan(NOW + 1_000),
      intakeDraft: intake(NOW + 2_000),
    });
    expect(newerIntake.startsAt).toEqual({
      value: "2026-07-24T19:00:00.000Z",
      source: "intake-v1",
    });
  });

  it("keeps populated legacy Plan work ahead of a newer PlanningIntent", () => {
    const legacyPlan = parsePlanDraftEnvelope(null, JSON.stringify(storedPlan()), NOW);
    const result = arbitratePlanDrafts({
      planDraft: legacyPlan,
      planningIntent: intent(),
    });
    expect(result.acceptedVenueId).toEqual({ value: "venue-a", source: "plan-legacy" });
    expect(result.startsAt).toEqual({
      value: "2026-07-24T18:00:00.000Z",
      source: "plan-legacy",
    });
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      code: "intent-preserved-existing",
      recoveryAction: "review-existing-plan",
    }));
  });

  it("lets intent fill missing fields only, then remembered area, then defaults", () => {
    const fromIntent = arbitratePlanDrafts({
      planningIntent: intent(),
      rememberedArea: { kind: "patch", id: "camden" },
    });
    expect(fromIntent.acceptedVenueId).toEqual({
      value: "venue-intent",
      source: "planning-intent",
    });
    expect(fromIntent.area).toEqual({
      value: { kind: "night-patch", id: "shoreditch" },
      source: "planning-intent",
    });

    const withoutIntent = arbitratePlanDrafts({
      rememberedArea: { kind: "patch", id: "camden" },
      defaults: { acceptedVenueId: "default-venue" },
    });
    expect(withoutIntent.acceptedVenueId).toEqual({ value: "default-venue", source: "default" });
    expect(withoutIntent.area).toEqual({
      value: { kind: "night-patch", id: "camden" },
      source: "remembered-area",
    });
  });

  it("uses a valid non-empty Route draft for preview and marks replay stale", () => {
    const result = arbitratePlanDrafts({
      routeDraft: routeDraft(NOW),
      lastAppliedOperationKey: "operation-1",
    });
    expect(result.routePreview).toMatchObject({ value: { routeStale: true } });
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      code: "operation-replay",
      recoveryAction: "regenerate-route",
    }));
  });

  it("inspects B without replacing anchor A until Make it Stop 1 is explicit", () => {
    const plan = v2Plan(NOW);
    const inspected = arbitratePlanDrafts({
      planDraft: plan,
      url: { surface: "map", selectedVenueId: "venue-b", replaceAnchor: false },
    });
    expect(inspected.inspectionVenueId.value).toBe("venue-b");
    expect(inspected.acceptedVenueId.value).toBe("venue-a");
    expect(inspected.conflicts).toContainEqual(expect.objectContaining({
      code: "inspection-not-anchor",
      recoveryAction: "make-it-stop-1",
    }));

    const replaced = arbitratePlanDrafts({
      planDraft: plan,
      url: { surface: "map", selectedVenueId: "venue-b", replaceAnchor: true },
    });
    expect(replaced.acceptedVenueId).toEqual({ value: "venue-b", source: "explicit-url" });
    expect(replaced.conflicts).toContainEqual(expect.objectContaining({ code: "anchor-replaced" }));
  });

  it("is deterministic across duplicate-tab hydration and performs no writes", () => {
    const input = {
      planDraft: v2Plan(NOW),
      intakeDraft: intake(NOW + 1),
      routeDraft: routeDraft(NOW),
      planningIntent: intent(),
    };
    const first = arbitratePlanDrafts(input);
    const second = arbitratePlanDrafts(structuredClone(input));
    expect(second).toEqual(first);
  });
});

describe("request references to an existing generated route", () => {
  function correlatedRequest(route: ParsedPlanRouteDraft, savedAt = NOW + 1000) {
    return v2Plan(savedAt, {
      title: "Our next night",
      stops: route.value.stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName })),
      routeReference: { savedAt: new Date(NOW).toISOString(), operationKey: "operation-1" },
      acceptedAnchor: {
        venueId: "venue-a", source: "near", cityId: "london", acceptedArea: null,
        startsAt: null, expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
      },
    });
  }

  it.each([0, 1000])("retains a matching generation independently of its request date: %i", (age) => {
    const route = routeDraft(NOW);
    const plan = correlatedRequest(route, NOW + age);
    const recovered = recoverPlanDrafts({ plan, legacyDraft: plan.draft, intake: null, route });
    expect(recovered).toMatchObject({ routeWins: false, sessionWins: false, acceptanceUnavailable: false });
    expect(recovered.planDraft?.draft.title).toBe("Our next night");
    expect(arbitratePlanDrafts({ planDraft: recovered.planDraft, routeDraft: route }).routeProofPresent).toBe(true);
  });

  it("does not borrow a route reference when the request copies disagree", () => {
    const route = routeDraft(NOW);
    const plan = correlatedRequest(route);
    const recovered = recoverPlanDrafts({ plan, legacyDraft: { ...plan.draft, requestedStopCount: 1 }, intake: null, route });
    expect(recovered.intent).toMatchObject({ stopCount: undefined, descriptionUnavailable: true });
    expect(recovered.sessionWins).toBe(true);
  });

  it.each(["missing", "operation", "writer-date", "later-than-request", "stops", "anchor", "copies", "expired", "stale", "ambiguous"] as const)(
    "does not certify an older route when its reference has a %s conflict", (conflict) => {
      const route = routeDraft(NOW);
      const plan = correlatedRequest(route);
      const legacyDraft = structuredClone(plan.draft);
      if (conflict === "missing") delete plan.draft.routeReference;
      if (conflict === "operation") plan.draft.routeReference!.operationKey = "other-operation";
      if (conflict === "writer-date") plan.draft.routeReference!.savedAt = new Date(NOW - 1).toISOString();
      if (conflict === "later-than-request") plan.savedAt = new Date(NOW - 1).toISOString();
      if (conflict === "stops") plan.draft.stops[1]!.venueId = "other-pub";
      if (conflict === "anchor") plan.draft.acceptedAnchor!.source = "map-search";
      if (conflict === "expired") { route.value.groundingProof = null; route.value.routeStale = true; }
      if (conflict === "stale") route.value.routeStale = true;
      const recovered = recoverPlanDrafts({
        plan, legacyDraft: conflict === "copies" ? { ...legacyDraft, routeReference: undefined } : plan.draft,
        intake: null, route: { ...route, ambiguous: conflict === "ambiguous" },
      });
      if (conflict === "later-than-request") {
        expect(recovered).toMatchObject({ routeWins: true, sessionWins: false });
      } else if (conflict === "copies" || conflict === "ambiguous") {
        expect(recovered).toMatchObject({ acceptanceUnavailable: true, planDraft: null });
      } else {
        expect(recovered).toMatchObject({ sessionWins: true, acceptanceUnavailable: false });
      }
    },
  );

  it("does not approve a legacy request or a same-ID replacement generation", () => {
    const route = routeDraft(NOW);
    const plan = correlatedRequest(route);
    const replacement = routeDraft(NOW + 500, { operationKey: "new-operation", nightContext: inferNightContext("Soho tonight").context });
    expect(recoverPlanDrafts({ plan, legacyDraft: plan.draft, intake: null, route: replacement }).sessionWins).toBe(true);
    const legacy = { ...plan, legacy: true, savedAt: null };
    const recovered = recoverPlanDrafts({ plan: legacy, legacyDraft: plan.draft, intake: null, route });
    expect(recovered).toMatchObject({ routeWins: false, acceptanceUnavailable: true, planDraft: null });
    expect(recovered.recoveredDraft?.title).toBe("Our next night");
    expect(recovered.recoveredDraft?.acceptedAnchor).toBeUndefined();
    expect(legacy.savedAt).toBeNull();
  });

  it.each(["matching", "missing", "revoked", "operation", "date", "newer-generation"] as const)(
    "recovers legacy requested count independently of route acceptance: %s", (kind) => {
      const route = routeDraft(NOW);
      const related = correlatedRequest(route);
      const draft = { ...related.draft, requestedStopCount: 5 as const, requestedStopCountSource: "picker" as const };
      if (kind === "missing") delete draft.routeReference;
      if (kind === "revoked") draft.routeReference = null;
      if (kind === "operation") draft.routeReference!.operationKey = "other-operation";
      if (kind === "date") draft.routeReference!.savedAt = new Date(NOW - 1).toISOString();
      if (kind === "newer-generation") {
        route.savedAt = new Date(NOW + 1).toISOString();
        route.value.operationKey = "new-generation";
      }
      const plan = parsePlanDraftEnvelope(null, JSON.stringify(draft), NOW + 1)!;
      const recovered = recoverPlanDrafts({ plan, legacyDraft: plan.draft, intake: null, route });
      const ownsRequest = kind === "matching" || kind === "revoked";
      expect(recovered.routeWins).toBe(!ownsRequest);
      expect(recovered.intent.stopCount).toBe(ownsRequest ? 5 : undefined);
      expect(recovered.intent.stopCountSource).toBe(ownsRequest ? "picker" : undefined);
      expect(recovered.intent.conciergeQuery).toBe(ownsRequest ? "Quiet pints" : "");
      expect(recovered.planDraft).toBeNull();
      expect(recovered.recoveredDraft?.creatorName).toBe(ownsRequest ? "K" : undefined);
      expect(plan.savedAt).toBeNull();
    },
  );

  it.each([false, true])("retains legacy revocation without a request clock, local route: %s", (hasRoute) => {
    const draft = storedPlan({ routeReference: null, requestedStopCount: 5 });
    const plan = parsePlanDraftEnvelope(null, JSON.stringify(draft), NOW)!;
    const recovered = recoverPlanDrafts({
      plan, legacyDraft: draft, intake: null, route: hasRoute ? routeDraft(NOW) : null,
    });
    expect(recovered.routeWins).toBe(false);
    expect(recovered.intent.stopCount).toBe(5);
    expect(recovered.recoveredDraft?.routeReference).toBeNull();
    expect(recovered).toMatchObject(hasRoute
      ? { acceptanceUnavailable: true, planDraft: null }
      : { sessionWins: true, planDraft: plan });
  });
});

it.each(["matching", "missing", "different"] as const)("selects the newest request's route correlation with its count and clock: %s", (reference) => {
  const route = routeDraft(NOW, { anchorVenueId: null, anchorSource: null, outcome: "unanchored" });
  const plan = v2Plan(NOW + 1, {
    stops: route.value.stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName })),
    routeReference: { savedAt: new Date(NOW).toISOString(), operationKey: "operation-1" },
    requestedStopCount: 3, requestedStopCountSource: "text",
  });
  const storage = memoryStorage();
  const intake = { ...createPlanIntakeDraft(), answers: { ...createPlanIntakeDraft().answers, stopCount: 1 as const, stopCountSource: "picker" as const } };
  writePlanIntakeDraft(intake, storage, NOW + 2, reference === "missing" ? undefined : {
    savedAt: new Date(NOW).toISOString(), operationKey: reference === "matching" ? "operation-1" : "replacement-operation",
  });
  const parsed = readPlanIntakeDraftWithMetadata(storage, NOW + 2);
  const recovered = recoverPlanDrafts({ plan, legacyDraft: plan.draft, intake: parsed, route });
  expect(recovered.intent).toMatchObject({ stopCount: 1, stopCountSource: "picker", descriptionUnavailable: true });
  expect(recovered.sessionWins).toBe(true);
  expect(recovered.acceptanceUnavailable).toBe(false);
});


it.each([false, true])("checks the winning intake against the generated request, missing session: %s", (missingSession) => {
  const context = { ...inferNightContext("Clapham tonight").context, stopCount: 3 as const };
  const route = routeDraft(NOW, { nightContext: context, anchorVenueId: null, anchorSource: null, outcome: "unanchored" });
  route.value.stops = route.value.stops.slice(0, 1);
  const plan = v2Plan(NOW + 1, { stops: route.value.stops, requestedStopCount: 3,
    routeReference: { savedAt: route.savedAt!, operationKey: "operation-1" } });
  const local = intake(NOW + 2);
  local.routeReference = plan.draft.routeReference;
  local.draft = createPlanIntakeDraft();
  local.draft.answers.stopCount = 3;
  const recover = () => recoverPlanDrafts({ plan: missingSession ? null : plan,
    legacyDraft: missingSession ? null : plan.draft, intake: local, route });
  expect(recover()).toMatchObject({ sessionWins: false, acceptanceUnavailable: false, intakeDraft: local });
  local.draft.answers.stopCount = 1;
  expect(recover()).toMatchObject(missingSession ? { acceptanceUnavailable: true } : { sessionWins: true });
  expect(recover().intakeDraft?.draft.answers.stopCount).toBe(1);
});

it.each(["Soho", "Piccadilly", "Piccadilly and Soho"])("recovers a correlated wizard route with server geography %s", (query) => {
  const route = routeDraft(NOW, {
    nightContext: { ...inferNightContext(query).context, daypart: "evening" },
    anchorVenueId: null,
    anchorSource: null,
    outcome: "unanchored",
  });
  const local = intake(NOW + 1);
  local.routeReference = { savedAt: route.savedAt!, operationKey: "operation-1" };
  expect(recoverPlanDrafts({ plan: null, legacyDraft: null, intake: local, route })).toMatchObject({
    acceptanceUnavailable: false,
    routeWins: true,
  });
});

it.each(["correlated", "empty", "conflicting", "uncorrelated"] as const)(
  "restores legacy route inputs only with established request ownership: %s",
  (kind) => {
    const route = routeDraft(NOW);
    const plan = v2Plan(NOW + 1, {
      stops: route.value.stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName })),
      ...(kind !== "uncorrelated" ? { routeReference: { savedAt: route.savedAt!, operationKey: "operation-1" } } : {}),
      ...(kind === "empty" || kind === "conflicting" ? { explicitNightContext: {} } : {}),
    });
    const recovered = recoverPlanDrafts({
      plan, legacyDraft: kind === "conflicting" ? { ...plan.draft, explicitNightContext: { partyType: "work" } } : plan.draft,
      intake: null, route: { ...route, explicitNightContext: { zeroProof: true } },
    });
    expect(recovered.intent.explicitNightContext).toEqual(kind === "correlated" ? { zeroProof: true } : kind === "empty" ? {} : undefined);
    expect(recovered.intent.stopCount).toBeUndefined();
  },
);

describe("request-only recovery", () => {
  const cleared = storedPlan({ stops: [], conciergeQuery: "", routeReference: null });
  const options = { source: "near", cityId: "manchester", acceptedVenueId: "venue-mcr-1lwo5lo",
    acceptedArea: null, startsAt: null, displayEvidence: { kind: "directory", observedAt: null } } as const;

  it.each(["v1", "v2"] as const)("does not restore route authority after only %s records a clear", (written) => {
    const session = memoryStorage({ throwOnSet: written === "v1" ? 4 : 3 });
    const route = routeDraft(NOW);
    expect(writePlanDraftEnvelope(storedPlan(), "manual", session, NOW)).toMatchObject({ v1: true, v2: true });
    expect(writePlanDraftEnvelope(cleared, "manual", session, NOW + 1000))
      .toMatchObject({ v1: written === "v1", v2: written === "v2" });
    const plan = readPlanDraftEnvelope(session, NOW + 1000);
    const legacyDraft = parsePlanDraftEnvelope(null, session.getItem(PLAN_DRAFT_KEY), NOW + 1000)!.draft;
    const recovered = recoverPlanDrafts({ plan, legacyDraft, intake: null, route });
    expect(recovered).toMatchObject({ requestOnly: true, routeWins: false, acceptanceUnavailable: true });
    expect(recovered.recoveredDraft).toMatchObject({ stops: [], routeReference: null });
    expect(recovered.recoveredDraft?.acceptedAnchor).toBeUndefined();
  });

  it("allows a separately dated, later route after a dated clear", () => {
    const session = memoryStorage();
    expect(writePlanDraftEnvelope(cleared, "manual", session, NOW).v2).toBe(true);
    const plan = readPlanDraftEnvelope(session, NOW)!;
    expect(recoverPlanDrafts({ plan, legacyDraft: plan.draft, intake: null, route: routeDraft(NOW + 2000) }))
      .toMatchObject({ requestOnly: false, routeWins: true, recoveredDraft: null });
  });

  it.each([
    { lane: "matching reference and answers at the same time", offset: 0, operationKey: "operation-1", count: 3, routeWins: true },
    { lane: "wrong operation at the same time", offset: 0, operationKey: "different-operation", count: 3, routeWins: false },
    { lane: "changed answers at the same time", offset: 0, operationKey: "operation-1", count: 2, routeWins: false },
    { lane: "unrelated intake saved later", offset: 1000, operationKey: null, count: 3, routeWins: false },
  ] as const)("compares a later route against $lane", ({ offset, operationKey, count, routeWins }) => {
    const session = memoryStorage();
    const local = memoryStorage();
    const routeTime = NOW + 1000;
    const route = routeDraft(routeTime, { nightContext: { ...inferNightContext("Clapham tonight").context, stopCount: 3 } });
    expect(writePlanDraftEnvelope(cleared, "manual", session, NOW).v2).toBe(true);
    const plan = readPlanDraftEnvelope(session, routeTime + offset)!;
    const draft = createPlanIntakeDraft();
    const reference = operationKey === null ? null : { savedAt: route.savedAt!, operationKey };
    expect(writePlanIntakeDraft({ ...draft, answers: { ...draft.answers, stopCount: count } },
      local, routeTime + offset, reference)).toBe(true);
    const saved = readPlanIntakeDraftWithMetadata(local, routeTime + offset);
    expect(saved).not.toBeNull();

    expect(recoverPlanDrafts({ plan, legacyDraft: plan.draft, intake: saved, route }))
      .toMatchObject({ requestOnly: !routeWins, routeWins, acceptanceUnavailable: !routeWins });
  });

  function expiredGeneration(malformedProof = false, format: "v1" | "v2" = "v1") {
    const session = memoryStorage();
    const local = memoryStorage();
    const routeTime = NOW + 1000;
    const proofExpiresAt = routeTime + 2 * 60 * 60 * 1000;
    const proof = fakeProof(proofExpiresAt);
    const nightContext = { ...inferNightContext("Clapham tonight").context, stopCount: 3 as const };
    expect(writePlanDraftEnvelope(cleared, "manual", session, NOW).v2).toBe(true);
    expect(writePlanRouteDraftEnvelope(routeValue({ nightContext, groundingProof: proof }), "plan-generated", local, routeTime).v1).toBe(true);
    if (format === "v1") local.removeItem(PLAN_ROUTE_DRAFT_V2_KEY);
    const savedAt = new Date(routeTime).toISOString();
    const blank = createPlanIntakeDraft();
    expect(writePlanIntakeDraft({ ...blank, answers: { ...blank.answers, area: "clapham", stopCount: 3, stopCountSource: "text" } },
      local, routeTime, { savedAt, operationKey: "operation-1" }, { nightArea: "clapham" })).toBe(true);
    const freshRoute = readPlanRouteDraftEnvelope(local, proofExpiresAt)!;
    if (malformedProof) {
      const raw = JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!);
      local.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({ ...raw, groundingProof: "malformed-proof" }));
    }
    const readAt = malformedProof ? routeTime : proofExpiresAt + 1;
    const plan = readPlanDraftEnvelope(session, readAt)!;
    const route = readPlanRouteDraftEnvelope(local, readAt)!;
    const intake = readPlanIntakeDraftWithMetadata(local, readAt)!;
    expect(route).toMatchObject({ savedAt, legacy: format === "v1", value: {
      groundingProof: null, operationKey: "operation-1", routeStale: true,
    } });
    return { plan, legacyDraft: plan.draft, intake, route, freshRoute, proof, readAt, session, local };
  }

  it.each([false, true])("recovers correlated route stops without usable proof, malformed: %s", (malformedProof) => {
    const { plan, legacyDraft, intake, route, freshRoute, proof } = expiredGeneration(malformedProof);
    const input = { plan, legacyDraft, intake, route };
    expect(freshRoute.value).toMatchObject({ groundingProof: proof, routeStale: false });
    expect(recoverPlanDrafts({ ...input, route: freshRoute }))
      .toMatchObject({ requestOnly: false, routeWins: true, acceptanceUnavailable: false });
    expect(input.route.value.stops.map((stop) => stop.venueId)).toEqual(["venue-a", "venue-b", "venue-c"]);
    const recovered = recoverPlanDrafts(input);
    expect(recovered).toMatchObject({
      requestOnly: false, routeWins: true, acceptanceUnavailable: true,
      planDraft: null, recoveredDraft: null, planningIntent: null, preserveStoredDrafts: true,
      intakeDraft: input.intake, retainedPreviewReference: input.intake.routeReference,
    });
    expect(recovered.intent.stopCount).toBe(3);
  });

  it.each(["v1", "v2"] as const)("retains a correlated expired %s route without Session", (format) => {
    const { intake, route, freshRoute } = expiredGeneration(false, format);
    const input = { plan: null, legacyDraft: null, intake, route };
    expect(recoverPlanDrafts({ ...input, route: freshRoute })).toMatchObject({
      requestOnly: false, routeWins: true, acceptanceUnavailable: false, retainedPreviewReference: null,
    });
    expect(recoverPlanDrafts(input)).toMatchObject({
      requestOnly: false, routeWins: true, acceptanceUnavailable: true, planDraft: null, planningIntent: null,
      retainedPreviewReference: intake.routeReference, intakeDraft: intake,
      intent: { stopCount: 3, stopCountSource: "text", explicitNightContext: { nightArea: "clapham" },
        conciergeQuery: "", descriptionUnavailable: true },
    });
  });

  it("recovers explicit legacy inputs when the correlated intake has no input map", () => {
    const { intake, route } = expiredGeneration();
    const explicitNightContext = { zeroProof: true, drinkCategory: null };
    const input = {
      plan: null, legacyDraft: null,
      intake: { ...intake, explicitNightContext: undefined },
      route: { ...route, explicitNightContext },
    };
    expect(recoverPlanDrafts(input)).toMatchObject({
      acceptanceUnavailable: true,
      retainedPreviewReference: intake.routeReference,
      intent: { explicitNightContext, stopCount: 3, stopCountSource: "text", descriptionUnavailable: true },
    });
  });

  it.each(["v1", "v2"] as const)("starts from a newer accepted pub before an expired local %s route", (format) => {
    const { intake, route, readAt, freshRoute } = expiredGeneration(false, format);
    const planningIntent = createPlanningIntent(options, readAt)!;
    const input = { plan: null, legacyDraft: null, intake, route, planningIntent };
    expect(recoverPlanDrafts(input)).toMatchObject({
      routeWins: false, requestOnly: true, preserveStoredDrafts: true,
      planningIntent: { acceptedVenueId: options.acceptedVenueId, acceptedAt: new Date(readAt).toISOString() },
      intakeDraft: null, requestIntake: null, retainedPreviewReference: null,
    });
    expect(recoverPlanDrafts({ ...input, intake: null })).toMatchObject({
      routeWins: false, requestOnly: true, preserveStoredDrafts: true, planningIntent,
    });
    expect(recoverPlanDrafts({ ...input, route: freshRoute })).toMatchObject({
      routeWins: true, requestOnly: false, planningIntent: null,
    });
    const sameDate = createPlanningIntent(options, Date.parse(intake.savedAt));
    expect(recoverPlanDrafts({ ...input, planningIntent: sameDate })).toMatchObject({
      routeWins: true, requestOnly: false, planningIntent: null, retainedPreviewReference: intake.routeReference,
    });
    expect(recoverPlanDrafts({ ...input, route: { ...route, ambiguous: true } })).toMatchObject({
      requestOnly: false, planningIntent: null, retainedPreviewReference: null,
    });
    expect(recoverPlanDrafts({ ...input, intake: { ...intake, savedAt: new Date(readAt + 1).toISOString() } })).toMatchObject({
      routeWins: true, requestOnly: false, planningIntent: null,
    });
  });

  it.each(["v1", "v2"] as const)("keeps a saved provisional %s pub as a request before and after release", (format) => {
    const { intake, route, readAt } = expiredGeneration();
    const intent = createPlanningIntent(options, readAt)!;
    const editedAt = readAt + 1000;
    const session = memoryStorage({ throwOnSet: format === "v1" ? 2 : undefined });
    const namedStop = { key: 1, venueId: intent.acceptedVenueId, venueName: "Our pub" };
    const accepted = storedPlan({
      title: "Our title", stops: [namedStop], provisionalStop: true, acceptedAnchor: {
        venueId: intent.acceptedVenueId, source: intent.source, cityId: intent.cityId,
        acceptedArea: intent.acceptedArea, startsAt: intent.startsAt, expiresAt: intent.expiresAt,
      },
    });
    expect(writePlanDraftEnvelope(accepted, "planning-intent", session, editedAt)).toMatchObject({
      v1: true, v2: format === "v2",
    });
    const plan = readPlanDraftEnvelope(session, editedAt)!;
    const legacyDraft = parsePlanDraftEnvelope(null, session.getItem(PLAN_DRAFT_KEY), editedAt)!.draft;
    const input = { plan, legacyDraft, intake, route, planningIntent: intent };
    expect(recoverPlanDrafts(input)).toMatchObject({
      requestOnly: true, provisionalRequest: true, preserveStoredDrafts: true,
      recoveredDraft: { title: "Our title", stops: [namedStop] }, planDraft: { savedAt: plan.savedAt },
      intakeDraft: null,
    });
    expect(recoverPlanDrafts({ ...input, route: null })).toMatchObject({
      requestOnly: true, provisionalRequest: true, preserveStoredDrafts: true,
      recoveredDraft: { stops: [namedStop], provisionalStop: true },
      planningIntent: intent, intakeDraft: null,
    });
    expect(recoverPlanDrafts({ ...input, legacyDraft: { ...legacyDraft, acceptedAnchor: undefined } }).provisionalRequest).toBe(false);
    if (format === "v2") {
      expect(recoverPlanDrafts({ ...input, legacyDraft: null, legacyDraftMissing: true })).toMatchObject({
        requestOnly: true, provisionalRequest: true, planningIntent: intent,
        recoveredDraft: { title: "Our title", stops: [namedStop] },
      });
      expect(recoverPlanDrafts({ ...input, legacyDraft: null }).provisionalRequest).toBe(false);
      const differentDate = { ...legacyDraft, provisionalSavedAt: new Date(editedAt - 1).toISOString() };
      expect(recoverPlanDrafts({ ...input, legacyDraft: differentDate, legacyDraftMissing: true }).provisionalRequest).toBe(false);
      session.setItem(PLAN_DRAFT_KEY, JSON.stringify({ ...legacyDraft, provisionalStop: undefined, provisionalSavedAt: undefined }));
      const unmarkedLegacy = parsePlanDraftEnvelope(null, session.getItem(PLAN_DRAFT_KEY), editedAt)!.draft;
      expect(readPlanDraftEnvelope(session, editedAt)?.draft.provisionalStop).toBe(true);
      expect(recoverPlanDrafts({ ...input, legacyDraft: unmarkedLegacy })).toMatchObject({
        provisionalRequest: false, retainedPreviewReference: null, planningIntent: null,
      });
    }

    const releasedDraft = { ...legacyDraft, acceptedAnchor: undefined, routeReference: null };
    const released = { ...plan, draft: releasedDraft };
    const releasedInput = { ...input, plan: released, legacyDraft: releasedDraft, planningIntent: null };
    expect(recoverPlanDrafts(releasedInput)).toMatchObject({
      requestOnly: true, provisionalRequest: true, preserveStoredDrafts: true,
      recoveredDraft: { stops: [namedStop], routeReference: null }, planningIntent: null,
    });
    // The same one-stop shape can be a genuine route edit whose Local save
    // refused. Its older, different Local route cannot establish provenance.
    const genuineEdit = { ...releasedDraft, provisionalStop: undefined, provisionalSavedAt: undefined };
    expect(recoverPlanDrafts({ ...releasedInput, plan: { ...released, draft: genuineEdit }, legacyDraft: genuineEdit })).toMatchObject({
      requestOnly: false, provisionalRequest: false,
    });
  });

  it.each([
    { transition: "released" },
    { transition: "expired acceptance" },
  ] as const)(
    "orders Local generation after a dated $transition provisional request",
    ({ transition }) => {
      const intent = createPlanningIntent({ ...options, acceptedVenueId: "venue-a" }, NOW)!;
      const generationAt = Date.parse(intent.expiresAt) - 1000;
      const reloadAt = Date.parse(intent.expiresAt);
      const session = memoryStorage({ throwOnSet: 2 });
      const local = memoryStorage();
      const anchor = transition === "released" ? undefined : {
        venueId: intent.acceptedVenueId, source: intent.source, cityId: intent.cityId,
        acceptedArea: intent.acceptedArea, startsAt: intent.startsAt, expiresAt: intent.expiresAt,
      };
      const provisional = storedPlan({
        stops: [{ key: 1, venueId: intent.acceptedVenueId, venueName: "Held pub" }],
        acceptedAnchor: anchor, provisionalStop: true, routeReference: anchor ? undefined : null,
      });
      expect(writePlanDraftEnvelope(provisional, anchor ? "planning-intent" : "manual", session, NOW + 1000))
        .toMatchObject({ v1: true, v2: false });
      const plan = readPlanDraftEnvelope(session, reloadAt)!;
      expect(plan).toMatchObject({ savedAt: null, legacy: true, draft: { provisionalStop: true } });
      expect(plan.draft.acceptedAnchor).toBeUndefined();
      expect(plan.draft.provisionalSavedAt).toBe(new Date(NOW + 1000).toISOString());

      const nightContext = { ...inferNightContext("Clapham tonight").context, stopCount: 3 as const };
      const operationKey = "later-generation";
      const generated = routeValue({
        nightContext, operationKey, groundingProof: fakeProof(reloadAt + 60_000),
        anchorVenueId: anchor?.venueId ?? null, anchorSource: anchor?.source ?? null,
        outcome: anchor ? "route" : "unanchored",
      });
      expect(writePlanRouteDraftEnvelope(generated, "plan-generated", local, generationAt).v2).toBe(true);
      const blank = createPlanIntakeDraft();
      const generationIntake = { ...blank, answers: { ...blank.answers, area: "clapham" as const, stopCount: 3 as const, stopCountSource: "text" as const } };
      const reference = { savedAt: new Date(generationAt).toISOString(), operationKey };
      expect(writePlanIntakeDraft(generationIntake, local, generationAt, reference)).toBe(true);
      const route = readPlanRouteDraftEnvelope(local, reloadAt)!;
      const intake = readPlanIntakeDraftWithMetadata(local, reloadAt)!;
      expect(route).toMatchObject({ savedAt: reference.savedAt, value: { operationKey, routeStale: false } });
      const records = { plan, legacyDraft: plan.draft, intake, route };
      expect(recoverPlanDrafts(records)).toMatchObject({
        routeWins: true, requestOnly: false, provisionalRequest: false,
        recoveredDraft: null, planDraft: null, intakeDraft: { routeReference: reference },
        intent: { stopCount: 3, stopCountSource: "text" },
      });
      expect(recoverPlanDrafts({ ...records, intake: null })).toMatchObject({
        routeWins: false, provisionalRequest: true,
      });
      expect(recoverPlanDrafts({ ...records, intake: { ...intake, routeReference: null } }).routeWins).toBe(false);
      expect(recoverPlanDrafts({ ...records, intake: {
        ...intake, routeReference: { ...reference, operationKey: "different-operation" },
      } }).routeWins).toBe(false);
      expect(recoverPlanDrafts({ ...records, route: { ...route, ambiguous: true } }).routeWins).toBe(false);
      const expired = readPlanRouteDraftEnvelope(local, reloadAt + 60_001)!;
      expect(expired.value).toMatchObject({ routeStale: true, groundingProof: null });
      expect(recoverPlanDrafts({ ...records, route: expired })).toMatchObject({
        routeWins: true, retainedPreviewReference: reference,
        acceptanceUnavailable: true, planningIntent: null, intakeDraft: { routeReference: reference },
      });
      expect(recoverPlanDrafts({ ...records, planningIntent: createPlanningIntent(options, reloadAt) }).routeWins).toBe(false);

      const genuineEdit = { ...plan.draft, provisionalStop: undefined, provisionalSavedAt: undefined, routeReference: null };
      expect(recoverPlanDrafts({ ...records, plan: { ...plan, draft: genuineEdit }, legacyDraft: genuineEdit }))
        .toMatchObject({ routeWins: false, provisionalRequest: false });

      const equalDate = { ...plan.draft, provisionalSavedAt: reference.savedAt };
      expect(recoverPlanDrafts({ ...records, plan: { ...plan, draft: equalDate }, legacyDraft: equalDate }).routeWins).toBe(false);
      const releaseAt = reloadAt + 1000;
      const releaseRef = { savedAt: new Date(releaseAt).toISOString(), operationKey };
      expect(writePlanRouteDraftEnvelope({
        ...generated, anchorVenueId: null, anchorSource: null, outcome: "unanchored", groundingProof: null,
      }, "manual", local, releaseAt).v2).toBe(true);
      expect(writePlanIntakeDraft(generationIntake, local, releaseAt, releaseRef)).toBe(true);
      const releasedRoute = readPlanRouteDraftEnvelope(local, releaseAt)!;
      const releasedIntake = readPlanIntakeDraftWithMetadata(local, releaseAt)!;
      const released = { ...records, route: releasedRoute, intake: releasedIntake };
      expect(recoverPlanDrafts(released)).toMatchObject({
        routeWins: true, acceptanceUnavailable: true, planningIntent: null,
        retainedPreviewReference: releaseRef, intakeDraft: { routeReference: releaseRef },
      });
      expect(recoverPlanDrafts({ ...released, intake: { ...releasedIntake, routeReference: undefined } }).routeWins).toBe(false);
      expect(recoverPlanDrafts({ ...released, intake: { ...releasedIntake, routeReference: reference } }).routeWins).toBe(false);
      expect(recoverPlanDrafts({ ...released, intake: { ...releasedIntake, draft: {
        ...generationIntake, answers: { ...generationIntake.answers, stopCount: 2 },
      } } }).routeWins).toBe(false);
      expect(writePlanIntakeDraft({
        ...generationIntake, answers: { ...generationIntake.answers, stopCount: 2 },
      }, local, releaseAt + 1000, null)).toBe(true);
      expect(recoverPlanDrafts({ ...released, intake: readPlanIntakeDraftWithMetadata(local, releaseAt + 1000) })).toMatchObject({
        routeWins: false, retainedPreviewReference: null, intent: { stopCount: 2 },
      });
    },
  );

  it.each(["missing intake", "revoked reference", "changed operation", "changed route date", "changed answers", "undated route",
    "ambiguous route", "later acceptance"] as const)("does not retain a local-only expired route reference after %s", (condition) => {
    const { intake, route, readAt } = expiredGeneration();
    if (condition === "revoked reference") intake.routeReference = null;
    if (condition === "changed operation") intake.routeReference!.operationKey = "another-operation";
    if (condition === "changed route date") intake.routeReference!.savedAt = new Date(NOW).toISOString();
    if (condition === "changed answers") intake.draft.answers.stopCount = 2;
    if (condition === "undated route") route.savedAt = null;
    const planningIntent = condition === "later acceptance" ? createPlanningIntent(options, readAt) : null;
    if (condition === "later acceptance") expect(planningIntent).not.toBeNull();
    const recovered = recoverPlanDrafts({
      plan: null, legacyDraft: null, intake: condition === "missing intake" ? null : intake, planningIntent,
      route: { ...route, ambiguous: condition === "ambiguous route" },
    });
    expect(recovered.retainedPreviewReference).toBeNull();
  });

  it.each(["missing-intake", "revoked-intake", "operation", "route-date", "answers", "ambiguous", "undated-route", "undated-request", "later-clear"] as const)(
    "keeps the request when an expired route has %s", (conflict) => {
      const { plan, legacyDraft, intake, route, readAt } = expiredGeneration();
      if (conflict === "revoked-intake") intake.routeReference = null;
      if (conflict === "operation") intake.routeReference!.operationKey = "other-operation";
      if (conflict === "route-date") intake.routeReference!.savedAt = new Date(NOW).toISOString();
      if (conflict === "answers") intake.draft.answers.stopCount = 2;
      if (conflict === "undated-route") route.savedAt = null;
      if (conflict === "undated-request") { plan.savedAt = null; plan.legacy = true; }
      if (conflict === "later-clear") plan.savedAt = new Date(readAt).toISOString();
      const recovered = recoverPlanDrafts({
        plan, legacyDraft, intake: conflict === "missing-intake" ? null : intake,
        route: { ...route, ambiguous: conflict === "ambiguous" },
      });
      expect(recovered).toMatchObject({ requestOnly: true, routeWins: false, recoveredDraft: { stops: [], routeReference: null } });
    },
  );

  it.each(["matching", "revoked", "changed-stops"] as const)("retains a stale route reference for %s metadata", (kind) => {
    const { route, intake, readAt } = expiredGeneration();
    const stops = route.value.stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName }));
    if (kind === "changed-stops") stops.reverse();
    const plan = v2Plan(readAt, {
      title: "Our later night", stops, routeReference: kind === "revoked" ? null : intake.routeReference,
    });
    const recovered = recoverPlanDrafts({ plan, legacyDraft: plan.draft, intake, route });
    expect(recovered).toMatchObject({ requestOnly: false, routeWins: false, sessionWins: true });
    expect(recovered.recoveredDraft?.title).toBe("Our later night");
    expect(recovered.retainedPreviewReference).toEqual(kind === "matching" ? intake.routeReference : null);
  });

  it("protects a correlated preview after the older Session V2 expires without dating legacy metadata", () => {
    const { plan, intake, readAt, session, local, route } = expiredGeneration();
    const metadata = storedPlan({
      title: "Our later night", routeReference: intake.routeReference, requestedStopCount: 3,
      stops: route.value.stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName })),
    });
    expect(writePlanDraftEnvelope(metadata, "manual", {
      getItem: session.getItem,
      setItem: (key, value) => {
        if (key === PLAN_DRAFT_V2_KEY) throw new Error("blocked");
        session.setItem(key, value);
      },
    }, readAt, { requireV1: true })).toMatchObject({ v1: true, v2: false });

    const sessionExpiresAt = Date.parse(plan.expiresAt!);
    const intakeExpiresAt = Date.parse(intake.expiresAt);
    const inBetween = sessionExpiresAt + 1;
    expect(inBetween).toBeLessThan(intakeExpiresAt);
    expect(readPlanDraftEnvelope(session, sessionExpiresAt - 1)).toMatchObject({ legacy: false, draft: { stops: [] } });
    const legacy = readPlanDraftEnvelope(session, inBetween)!;
    const savedIntake = readPlanIntakeDraftWithMetadata(local, inBetween)!;
    const savedRoute = readPlanRouteDraftEnvelope(local, inBetween)!;
    expect(legacy).toMatchObject({ legacy: true, savedAt: null, expiresAt: null, draft: metadata });
    expect(savedRoute.value).toMatchObject({ routeStale: true, groundingProof: null });
    const input = { plan: legacy, legacyDraft: legacy.draft, intake: savedIntake, route: savedRoute };
    expect(recoverPlanDrafts(input)).toMatchObject({
      routeWins: false, sessionWins: false, requestOnly: false, requestAmbiguous: true, acceptanceUnavailable: true,
      planDraft: null, retainedPreviewReference: savedIntake.routeReference,
      recoveredDraft: { title: "Our later night", stops: metadata.stops },
      intakeDraft: savedIntake,
      requestIntake: { answers: { area: "clapham", stopCount: 3, stopCountSource: "text" } },
      intent: {
        stopCount: 3, stopCountSource: "text", explicitNightContext: { nightArea: "clapham" },
        conciergeQuery: "", descriptionUnavailable: true,
      },
    });

    const mismatch = { ...legacy.draft, routeReference: { ...legacy.draft.routeReference!, operationKey: "other-operation" } };
    expect(recoverPlanDrafts({ ...input, plan: { ...legacy, draft: mismatch }, legacyDraft: mismatch }).retainedPreviewReference).toBeNull();
    const reordered = { ...legacy.draft, stops: [...legacy.draft.stops].reverse() };
    expect(recoverPlanDrafts({ ...input, plan: { ...legacy, draft: reordered }, legacyDraft: reordered }).retainedPreviewReference).toBeNull();
    expect(recoverPlanDrafts({ ...input, route: { ...savedRoute, ambiguous: true } }).retainedPreviewReference).toBeNull();
    const clearedLegacy = { ...legacy.draft, stops: [], routeReference: null };
    expect(recoverPlanDrafts({ ...input, plan: { ...legacy, draft: clearedLegacy }, legacyDraft: clearedLegacy }))
      .toMatchObject({ requestOnly: true, routeWins: false, retainedPreviewReference: null });
    const expiredIntake = readPlanIntakeDraftWithMetadata(local, intakeExpiresAt);
    expect(expiredIntake).toBeNull();
    expect(recoverPlanDrafts({ ...input, intake: expiredIntake }).retainedPreviewReference).toBeNull();
  });

  it("keeps a later explicit acceptance ahead of an expired route preview", () => {
    const { plan, legacyDraft, intake, route, readAt } = expiredGeneration();
    const planningIntent = createPlanningIntent(options, readAt);
    expect(planningIntent).not.toBeNull();
    expect(recoverPlanDrafts({ plan, legacyDraft, intake, route, planningIntent }))
      .toMatchObject({ requestOnly: true, routeWins: false, planningIntent });
  });

  it("does not invent the age of a legacy clear or borrow acceptance from a conflicting route", () => {
    const session = memoryStorage({ throwOnSet: 2 });
    expect(writePlanDraftEnvelope(cleared, "manual", session, NOW)).toMatchObject({ v1: true, v2: false });
    const plan = readPlanDraftEnvelope(session, NOW + 2000)!;
    const route = { ...routeDraft(NOW), conflicting: true, ambiguous: true };
    const input = { plan, legacyDraft: plan.draft, intake: null, route };
    const older = createPlanningIntent(options, NOW - 1000);
    const later = createPlanningIntent(options, NOW + 2000);
    expect(plan).toMatchObject({ savedAt: null, expiresAt: null, legacy: true });
    expect(recoverPlanDrafts({ ...input, planningIntent: older }))
      .toMatchObject({ acceptanceUnavailable: true, requestOnly: true, planningIntent: null });
    expect(recoverPlanDrafts({ ...input, planningIntent: later }))
      .toMatchObject({ acceptanceUnavailable: true, requestOnly: true, planningIntent: later });
  });
});
