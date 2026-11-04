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

  it("does not borrow authority from conflicting or undated session copies", () => {
    const saved = v2Plan(NOW, { requestedStopCount: 1, requestedStopCountSource: "picker" });
    const conflicting = { ...saved.draft, requestedStopCountSource: "text" as const };
    expect(resolveRequestedPlanIntent(saved, conflicting, null)).toEqual({ stopCount: 1, conciergeQuery: "", descriptionUnavailable: true });
    const legacy: ParsedPlanDraft = { ...saved, legacy: true, savedAt: null };
    expect(resolveRequestedPlanIntent(legacy, saved.draft, null).stopCountSource).toBeUndefined();
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

  it("does not correlate a legacy request or a same-ID replacement generation", () => {
    const route = routeDraft(NOW);
    const plan = correlatedRequest(route);
    const replacement = routeDraft(NOW + 500, { operationKey: "new-operation", nightContext: inferNightContext("Soho tonight").context });
    expect(recoverPlanDrafts({ plan, legacyDraft: plan.draft, intake: null, route: replacement }).sessionWins).toBe(true);
    const legacy = { ...plan, legacy: true, savedAt: null };
    expect(recoverPlanDrafts({ plan: legacy, legacyDraft: plan.draft, intake: null, route }).routeWins).toBe(true);
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
