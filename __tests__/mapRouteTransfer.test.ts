import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  mapGeneratedRouteDraftValue,
  mapCurrentRouteDraftValue,
  transferMapRouteToDraft,
  type MapGeneratedRouteResponse,
} from "@/lib/mapRouteTransfer";
import {
  PLAN_ROUTE_DRAFT_V2_KEY,
  readPlanRouteDraftEnvelope,
} from "@/lib/planRouteDraft";
import { mintPlanGroundingProof, verifyPlanGroundingProof } from "@/lib/planGrounding.server";
import { createWebMcpBoard, publishWebMcpRoute, writeWebMcpRouteToPlanDraft } from "@/lib/webmcp/board";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function memoryStorage(options: { alwaysThrow?: boolean } = {}): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => {
      if (options.alwaysThrow) throw new Error("blocked");
      values.set(key, String(value));
    },
  };
}

function fakeProof(expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, expiresAt }), "utf8").toString("base64url");
  return `${payload}.not-a-trusted-signature`;
}

function generateResponse(overrides: Partial<MapGeneratedRouteResponse> = {}): MapGeneratedRouteResponse {
  return {
    groundingProof: fakeProof(NOW + 2 * 60 * 60 * 1000),
    operationKey: "operation-1",
    stops: [
      { venueId: "venue-a", venueName: "Venue A", alternatives: [{ venueId: "venue-x", venueName: "Venue X" }] },
      { venueId: "venue-b", venueName: "Venue B", alternatives: [] },
      { venueId: "venue-c", venueName: "Venue C", alternatives: [] },
    ],
    inferredContext: {
      nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 4,
      budget: "standard", budgetLimitPence: null, zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
    },
    routeTotals: { stopCount: 3, straightLineWalkingKm: 1.2, estimatedWalkingMinutes: 20, distanceBasis: "straight-line" },
    planningConfidence: { level: "medium", score: 0.5, routeReady: false, missingEvidence: [], warnings: ["check opening"], provenance: [] },
    ...overrides,
  };
}

function evidenceResponse(): MapGeneratedRouteResponse {
  const context = {
    nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 4,
    budget: "standard", budgetLimitPence: null, zeroProof: false, drinkCategory: "wine",
    wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
  };
  const listed = { category: "wine", pence: 625, serving: "125ml", source: "listed",
    sourceUrl: "https://example.org/menu", observedAt: "2026-07-23T10:40:17.846Z" };
  const community = { category: "wine", pence: 575, serving: null, source: "community",
    reportedAt: "2026-07-23T11:00:00.000Z" };
  return {
    ...generateResponse({ inferredContext: context }),
    grounded: true,
    stops: [
      { venueId: "venue-a", venueName: "Venue A",
        selectedDrinkPriceEvidence: { ...listed, contributor: "private-account-canary" },
        alternatives: [{ venueId: "venue-x", venueName: "Venue X",
          selectedDrinkPriceEvidence: { ...community, actor: "private-actor-canary" } }] },
      { venueId: "venue-b", venueName: "Venue B",
        selectedDrinkPriceEvidence: { ...community, accountId: "private-account-canary" },
        alternatives: [{ venueId: "venue-y", venueName: "Venue Y",
          selectedDrinkPriceEvidence: { ...listed, privateMetadata: "private-source-canary" } }] },
      { venueId: "venue-c", venueName: "Venue C", alternatives: [] },
    ],
    latitude: 51.515,
    longitude: -0.09,
    deviceUrl: "https://private.example/location?token=private-url-canary",
  } as unknown as MapGeneratedRouteResponse;
}

describe("mapGeneratedRouteDraftValue / transferMapRouteToDraft", () => {
  it("transfers the exact Route, order, alternatives, and proof as a map-generated draft", () => {
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(generateResponse(), storage, NOW)).toBe(true);

    const parsed = readPlanRouteDraftEnvelope(storage, NOW);
    expect(parsed?.origin).toBe("map-generated");
    expect(parsed?.value.outcome).toBe("unanchored");
    expect(parsed?.value.stops.map((stop) => stop.venueId)).toEqual(["venue-a", "venue-b", "venue-c"]);
    expect(parsed?.value.stops[0].alternatives).toEqual([{ venueId: "venue-x", venueName: "Venue X" }]);
    expect(parsed?.value.groundingProof).toEqual(expect.any(String));
    expect(parsed?.value.operationKey).toBe("operation-1");
    expect(parsed?.value.transportBasis).toBe("straight-line");
    expect(parsed?.value.warnings).toEqual(["check opening"]);
    expect(parsed?.value.routeTotals).toMatchObject({ stopCount: 3, distanceBasis: "straight-line" });
    expect(parsed?.value.planningConfidence).toMatchObject({ level: "medium" });
    expect(parsed?.value.nightContext).toMatchObject({ daypart: "evening", partyType: "friends" });
    expect(parsed?.value.anchorVenueId).toBeNull();
  });

  it("carries an anchored Route with the anchor kept at Stop 1", () => {
    const storage = memoryStorage();
    transferMapRouteToDraft(generateResponse({
      outcome: "route", anchored: true, anchorVenueId: "venue-a", anchorSource: "near",
    }), storage, NOW);
    const parsed = readPlanRouteDraftEnvelope(storage, NOW);
    expect(parsed?.value.outcome).toBe("route");
    expect(parsed?.value.anchorVenueId).toBe("venue-a");
    expect(parsed?.value.anchorSource).toBe("near");
    expect(parsed?.value.stops[0].venueId).toBe("venue-a");
  });

  it("writes nothing for a malformed or empty Route (caller falls back)", () => {
    const storage = memoryStorage();
    expect(mapGeneratedRouteDraftValue({ stops: undefined })).toBeNull();
    expect(mapGeneratedRouteDraftValue(null)).toBeNull();
    expect(mapGeneratedRouteDraftValue({ stops: [{ venueName: "no id" }] })).toBeNull();
    expect(transferMapRouteToDraft({ stops: [] }, storage, NOW)).toBe(false);
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();
  });

  it("recovers an ungrounded Route when the proof is missing", () => {
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(generateResponse({ groundingProof: undefined }), storage, NOW)).toBe(true);
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value.groundingProof).toBeNull();
  });

  it("stays non-destructive when storage throws", () => {
    const storage = memoryStorage({ alwaysThrow: true });
    expect(() => transferMapRouteToDraft(generateResponse(), storage, NOW)).not.toThrow();
    expect(transferMapRouteToDraft(generateResponse(), storage, NOW)).toBe(false);
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();
  });

  it("is idempotent across a duplicate navigation", () => {
    const storage = memoryStorage();
    transferMapRouteToDraft(generateResponse(), storage, NOW);
    const first = readPlanRouteDraftEnvelope(storage, NOW);
    transferMapRouteToDraft(generateResponse(), storage, NOW);
    const second = readPlanRouteDraftEnvelope(storage, NOW);
    expect(second?.value.stops.map((stop) => stop.venueId)).toEqual(first?.value.stops.map((stop) => stop.venueId));
    expect(second?.value.operationKey).toBe(first?.value.operationKey);
  });

  it("carries listed and community evidence through Map and WebMCP Plan transfers", () => {
    const response = evidenceResponse();
    const listed = { category: "wine", pence: 625, serving: "125ml", source: "listed",
      sourceUrl: "https://example.org/menu", observedAt: "2026-07-23T10:40:17.846Z" };
    const community = { category: "wine", pence: 575, serving: null, source: "community",
      reportedAt: "2026-07-23T11:00:00.000Z" };
    const assertEvidence = (storage: Storage) => {
      const parsed = readPlanRouteDraftEnvelope(storage, NOW);
      expect(parsed?.value.stops.map((stop) => stop.selectedDrinkPriceEvidence))
        .toEqual([listed, community, undefined]);
      expect(parsed?.value.stops.map((stop) => stop.alternatives)).toEqual([
        [{ venueId: "venue-x", venueName: "Venue X", selectedDrinkPriceEvidence: community }],
        [{ venueId: "venue-y", venueName: "Venue Y", selectedDrinkPriceEvidence: listed }],
        [],
      ]);
      const serialized = storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY) ?? "";
      for (const canary of ["private-account-canary", "private-actor-canary", "private-source-canary",
        "private-url-canary", "51.515", "-0.09"]) expect(serialized).not.toContain(canary);
    };

    const mapStorage = memoryStorage();
    expect(transferMapRouteToDraft(response, mapStorage, NOW)).toBe(true);
    assertEvidence(mapStorage);

    const board = publishWebMcpRoute(createWebMcpBoard(), response);
    expect(board.route?.originalResponse?.stops).toBeDefined();
    if (!board.route) throw new Error("WebMCP route fixture was not accepted");
    const webmcpStorage = memoryStorage();
    expect(writeWebMcpRouteToPlanDraft(board.route, webmcpStorage, NOW)).toBe(true);
    assertEvidence(webmcpStorage);
  });

  it("strips malformed citations and keeps the existing backup-count ceiling", () => {
    const invalid = { category: "wine", pence: 625, serving: "125ml", source: "listed",
      sourceUrl: "javascript:alert(1)", observedAt: "2026-07-23T10:40:17.846Z",
      contributor: "private-account-canary" };
    const malformed = { ...generateResponse({ inferredContext: {
      nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 4,
      budget: "standard", budgetLimitPence: null, zeroProof: false, drinkCategory: "wine",
      wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
    } }), stops: [
      { venueId: "venue-a", venueName: "Venue A", selectedDrinkPriceEvidence: invalid,
        alternatives: [{ venueId: "venue-x", venueName: "Venue X", selectedDrinkPriceEvidence: invalid }] },
      { venueId: "venue-b", venueName: "Venue B", alternatives: [] },
      { venueId: "venue-c", venueName: "Venue C", alternatives: [] },
    ] } as unknown as MapGeneratedRouteResponse;
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(malformed, storage, NOW)).toBe(true);
    const parsed = readPlanRouteDraftEnvelope(storage, NOW);
    expect(parsed?.value.stops[0]).toMatchObject({
      venueId: "venue-a", venueName: "Venue A", alternatives: [{ venueId: "venue-x", venueName: "Venue X" }],
    });
    expect(parsed?.value.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect(parsed?.value.stops[0]?.alternatives[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY) ?? "").not.toContain("private-account-canary");

    const overCap = { ...generateResponse(), stops: [
      { venueId: "venue-a", venueName: "Venue A", alternatives: Array.from({ length: 25 }, (_, index) => ({
        venueId: `venue-${index + 10}`, venueName: `Venue ${index + 10}`,
      })) },
      { venueId: "venue-b", venueName: "Venue B", alternatives: [] },
      { venueId: "venue-c", venueName: "Venue C", alternatives: [] },
    ] } as unknown as MapGeneratedRouteResponse;
    const boundedStorage = memoryStorage();
    expect(transferMapRouteToDraft(overCap, boundedStorage, NOW)).toBe(false);
    expect(boundedStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();
  });

});


describe("current displayed Map route transfer", () => {
  const reversed = [
    { id: "venue-c", name: "Venue C" }, { id: "venue-b", name: "Venue B" }, { id: "venue-a", name: "Venue A" },
  ];

  it("leaves an unchanged response draft and proof intact", () => {
    const response = evidenceResponse();
    const original = mapGeneratedRouteDraftValue(response)!;
    expect(mapCurrentRouteDraftValue(response, original.stops.map((stop) => ({ id: stop.venueId, name: stop.venueName }))))
      .toEqual(original);
  });

  it("transfers actual reversed order with original per-stop and backup quotes and a valid V1 candidate proof", () => {
    const response = evidenceResponse();
    const proof = mintPlanGroundingProof(["venue-a", "venue-b", "venue-c", "venue-x", "venue-y"], "operation-1", NOW);
    response.groundingProof = proof;
    const original = mapGeneratedRouteDraftValue(response)!;
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(response, storage, NOW, reversed)).toBe(true);
    const value = readPlanRouteDraftEnvelope(storage, NOW)!.value;
    expect(value.stops.map((stop) => stop.venueId)).toEqual(["venue-c", "venue-b", "venue-a"]);
    expect(value.stops.map((stop) => stop.selectedDrinkPriceEvidence)).toEqual([...original.stops].reverse().map((stop) => stop.selectedDrinkPriceEvidence));
    expect(value.stops.map((stop) => stop.alternatives)).toEqual([...original.stops].reverse().map((stop) => stop.alternatives));
    expect(value.groundingProof).toBe(proof);
    expect(value.operationKey).toBe("operation-1");
    expect(verifyPlanGroundingProof(value.groundingProof, value.stops.map((stop) => stop.venueId), value.operationKey!, NOW)).toBe(true);
    expect(verifyPlanGroundingProof(value.groundingProof, ["venue-c", "venue-b", "venue-unknown"], value.operationKey!, NOW)).toBe(false);
    expect(value).toMatchObject({ routeTotals: null, transportBasis: null, planningConfidence: null, routeRevision: null, routeStale: false });
    expect(value.nightContext?.drinkCategory).toBe("wine");
  });

  it("keeps edited current identities and requested drink as a refreshable preview, without resurrecting captured proof or quotes", () => {
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(evidenceResponse(), storage, NOW, [
      { id: "venue-new", name: "New Venue" }, { id: "venue-b", name: "Venue B" },
    ])).toBe(true);
    const value = readPlanRouteDraftEnvelope(storage, NOW)!.value;
    expect(value.stops).toEqual([
      { key: 1, venueId: "venue-new", venueName: "New Venue", alternatives: [] },
      { key: 2, venueId: "venue-b", venueName: "Venue B", alternatives: [] },
    ]);
    expect(value.nightContext).toMatchObject({ drinkCategory: "wine", stopCount: 2 });
    expect(value).toMatchObject({ groundingProof: null, operationKey: null, routeRevision: null, routeStale: true, routeTotals: null, planningConfidence: null });
    expect(value.warnings).toEqual(["You changed this route. Review a refreshed route before locking it in."]);
  });

  it("never silently releases an accepted Stop 1, but explicit release carries the actual route as a stale preview", () => {
    const response = evidenceResponse();
    Object.assign(response, { outcome: "route", anchored: true, anchorVenueId: "venue-a", anchorSource: "near" });
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(response, storage, NOW, reversed)).toBe(false);
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();
    expect(transferMapRouteToDraft(response, storage, NOW, reversed, true)).toBe(true);
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value).toMatchObject({
      anchorVenueId: null, anchorSource: null, outcome: "unanchored", groundingProof: null, operationKey: null, routeStale: true,
    });
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value.stops.map((stop) => stop.venueId)).toEqual(["venue-c", "venue-b", "venue-a"]);
  });

  it("retires an anchored changed-order proof even when its held Stop 1 remains first", () => {
    const response = generateResponse({ outcome: "route", anchored: true, anchorVenueId: "venue-a", anchorSource: "near" });
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(response, storage, NOW, [
      { id: "venue-a", name: "Venue A" }, { id: "venue-c", name: "Venue C" }, { id: "venue-b", name: "Venue B" },
    ])).toBe(true);
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value).toMatchObject({
      anchorVenueId: "venue-a", anchorSource: "near", outcome: "route", groundingProof: null, routeStale: true,
    });
  });

  it.each(["expired", "malformed"] as const)("keeps an %s proof from authorizing the reversed preview", (kind) => {
    const response = generateResponse({ groundingProof: kind === "expired" ? fakeProof(NOW - 1) : "malformed.signature" });
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(response, storage, NOW, reversed)).toBe(true);
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value).toMatchObject({ groundingProof: null, routeStale: true });
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value.stops.map((stop) => stop.venueId)).toEqual(["venue-c", "venue-b", "venue-a"]);
  });

  it("preserves zero-proof intent and never transfers an alcoholic price", () => {
    const response = evidenceResponse();
    response.inferredContext = { ...(response.inferredContext as Record<string, unknown>), zeroProof: true };
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(response, storage, NOW, reversed)).toBe(true);
    const value = readPlanRouteDraftEnvelope(storage, NOW)!.value;
    expect(value.nightContext?.zeroProof).toBe(true);
    expect(value.stops.every((stop) => !stop.selectedDrinkPriceEvidence && stop.alternatives.every((alt) => !alt.selectedDrinkPriceEvidence))).toBe(true);
  });

  it("refuses duplicate or empty displayed routes without overwriting a saved draft", () => {
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(generateResponse(), storage, NOW)).toBe(true);
    const previous = storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
    for (const route of [[], [{ id: "venue-a", name: "A" }, { id: "venue-a", name: "A" }]]) {
      expect(transferMapRouteToDraft(generateResponse(), storage, NOW, route)).toBe(false);
      expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(previous);
    }
    expect(transferMapRouteToDraft(generateResponse(), memoryStorage({ alwaysThrow: true }), NOW, reversed)).toBe(false);
  });
});
