import { describe, expect, it } from "vitest";

import {
  getNightArea,
  isNightAreaRouteReady,
  nearestRouteReadyNightArea,
  publicNightAreaCoverage,
  tryGetNightArea,
  validateNightAreaCatalogue,
} from "@/lib/nightAreas";

describe("Night Area catalogue", () => {
  it("keeps route readiness explicit and rejects an expired review snapshot", () => {
    const clapham = getNightArea("clapham");
    expect(isNightAreaRouteReady(clapham, new Date("2026-07-13T12:00:00.000Z"))).toBe(true);
    expect(isNightAreaRouteReady(clapham, new Date("2027-02-01T12:00:00.000Z"))).toBe(false);

    const barnes = getNightArea("barnes");
    expect(isNightAreaRouteReady(barnes, new Date("2026-07-13T12:00:00.000Z"))).toBe(false);
  });

  it("fails closed when a route-ready gate omits a required check or evidence", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    const incompleteGate = structuredClone(getNightArea("clapham"));
    incompleteGate.gate.checks = incompleteGate.gate.checks.slice(1);
    expect(isNightAreaRouteReady(incompleteGate, now)).toBe(false);

    const evidenceFreeGate = structuredClone(getNightArea("clapham"));
    evidenceFreeGate.gate.checks.find((check) => check.code === "terminal_food")!.evidenceRefs = [];
    expect(isNightAreaRouteReady(evidenceFreeGate, now)).toBe(false);
  });

  it("fails closed when the gate version, public reasons, or review window is inconsistent", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    const unsupportedVersion = structuredClone(getNightArea("clapham"));
    (unsupportedVersion.gate as { version: number }).version = 2;
    expect(isNightAreaRouteReady(unsupportedVersion, now)).toBe(false);

    const incompleteReasons = structuredClone(getNightArea("clapham"));
    incompleteReasons.routeReadyReasons.pop();
    expect(isNightAreaRouteReady(incompleteReasons, now)).toBe(false);

    const invalidReviewWindow = structuredClone(getNightArea("clapham"));
    invalidReviewWindow.lastReviewedAt = "2027-02-01T00:00:00.000Z";
    invalidReviewWindow.reviewExpiresAt = "2027-01-01T00:00:00.000Z";
    expect(isNightAreaRouteReady(invalidReviewWindow, now)).toBe(false);
  });

  it("derives published route readiness from the evidence gate", () => {
    const invalidReadyArea = structuredClone(getNightArea("clapham"));
    invalidReadyArea.missingEvidence = ["opening_hours"];

    expect(isNightAreaRouteReady(invalidReadyArea, new Date("2026-07-13T12:00:00.000Z"))).toBe(false);
    expect(publicNightAreaCoverage(invalidReadyArea).routeReady).toBe(false);
  });

  it("rejects duplicate aliases, blank anchors, and invalid coordinates", () => {
    expect(() => validateNightAreaCatalogue([
      {
        slug: "one", cityId: "london", name: "One", aliases: ["Shared"],
        centre: { lat: 51.5, lng: -0.1 }, radiusKm: 1, transportAnchors: ["One station"],
      },
      {
        slug: "one", cityId: "london", name: "Two", aliases: ["shared"],
        centre: { lat: 91, lng: -0.2 }, radiusKm: 1, transportAnchors: ["  "],
      },
    ])).toThrow(/slug|alias|anchor|coordinate/i);
  });

  it("admits an area that names NO transport anchor", () => {
    // A derived area reads no station out of the base layer, and naming one it
    // has not read would be the invention the whole lane refuses. It carries
    // `transport_anchor` in its own missingEvidence instead.
    expect(() => validateNightAreaCatalogue([
      {
        slug: "nowhere-yet", cityId: "manchester", name: "Nowhere yet", aliases: [],
        centre: { lat: 53.48, lng: -2.24 }, radiusKm: 1, transportAnchors: [],
      },
    ])).not.toThrow();
  });

  it("answers null rather than throwing for a stale or unknown area slug", () => {
    expect(tryGetNightArea("clapham")).toEqual(getNightArea("clapham"));
    expect(tryGetNightArea("a-renamed-or-removed-area")).toBeNull();
    expect(tryGetNightArea(null)).toBeNull();
    expect(tryGetNightArea(undefined)).toBeNull();
    expect(tryGetNightArea("")).toBeNull();
  });
});

describe("nearestRouteReadyNightArea", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("never answers with an area the app calls not crawl-ready", () => {
    // King's Cross is the nearest area to the default London centre and is not ready.
    const kingsCross = getNightArea("kings-cross");
    expect(isNightAreaRouteReady(kingsCross, now)).toBe(false);
    const found = nearestRouteReadyNightArea(
      "london",
      [kingsCross.centre.lng, kingsCross.centre.lat],
      now,
    );
    expect(found).not.toBeNull();
    expect(isNightAreaRouteReady(found!, now)).toBe(true);
  });

  it("answers Soho for the Soho patch", () => {
    expect(nearestRouteReadyNightArea("london", [-0.1365, 51.5136], now)?.slug).toBe("piccadilly-soho");
  });

  it("answers nothing for a bad centre", () => {
    expect(nearestRouteReadyNightArea("london", [Number.NaN, 51.5], now)).toBeNull();
  });
});
