import { beforeEach, describe, expect, it } from "vitest";

import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import {
  PLANNING_INTENT_STORAGE_KEY,
  parsePlanningIntent,
  type PlanningIntentStorage,
} from "@/lib/planningIntent";
import { acceptTonightVenue } from "@/lib/tonightAcceptance";

// The Tonight acceptance seam is pure — inject storage + clock and read the
// result. Source is fixed "tonight", evidence is "what's-on", browsing is never
// an acceptance, and a storage failure never over-counts.

const NOW = Date.parse("2026-07-24T18:00:00.000Z");
const OBSERVED = "2026-07-24T12:00:00.000Z";
const LONDON_VENUE = "the-dove-hammersmith";
const SOHO = NIGHT_PATCHES.find((patch) => patch.id === "soho")!;
const CANONICAL_BOROUGH = LONDON_BOROUGHS[0];

type FakeStorage = PlanningIntentStorage & { map: Map<string, string> };

function memoryStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function throwingStorage(): PlanningIntentStorage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("QuotaExceededError");
    },
    removeItem: () => {},
  };
}

function storedIntent(storage: FakeStorage) {
  const raw = storage.map.get(PLANNING_INTENT_STORAGE_KEY);
  return raw ? parsePlanningIntent(raw, NOW) : null;
}

const baseInput = {
  venueId: LONDON_VENUE,
  area: null,
  startsAt: null,
  observedAt: OBSERVED,
  fallbackCityId: "london" as const,
};

describe("acceptTonightVenue", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("writes source 'tonight', what's-on evidence, and the accept deep link", () => {
    const result = acceptTonightVenue(
      { ...baseInput, area: { kind: "patch", id: SOHO.id } },
      { storage, now: NOW },
    );

    expect(result.accepted).toBe(true);
    expect(result.href).toContain("accept=1");
    expect(result.href).toContain("src=tonight");
    expect(result.telemetry).toEqual({
      source: "tonight",
      hasArea: true,
      hasDate: false,
      hasProvenance: true,
    });

    const intent = storedIntent(storage);
    expect(intent?.source).toBe("tonight");
    expect(intent?.acceptedVenueId).toBe(LONDON_VENUE);
    expect(intent?.acceptedArea).toEqual({ kind: "night-patch", id: SOHO.id });
    expect(intent?.displayEvidence).toEqual({ kind: "whats-on", observedAt: OBSERVED });
  });

  it("records a canonical borough as the accepted area", () => {
    const result = acceptTonightVenue(
      { ...baseInput, area: { kind: "borough", name: CANONICAL_BOROUGH } },
      { storage, now: NOW },
    );
    expect(result.telemetry?.hasArea).toBe(true);
    expect(storedIntent(storage)?.acceptedArea).toEqual({ kind: "borough", name: CANONICAL_BOROUGH });
  });

  it("accepts with no area (live-location order) — hasArea false", () => {
    const result = acceptTonightVenue({ ...baseInput, area: null }, { storage, now: NOW });
    expect(result.accepted).toBe(true);
    expect(result.telemetry?.hasArea).toBe(false);
    expect(storedIntent(storage)?.acceptedArea).toBeNull();
  });

  it("marks hasProvenance false when source freshness is unknown (null observedAt)", () => {
    const result = acceptTonightVenue({ ...baseInput, observedAt: null }, { storage, now: NOW });
    expect(result.telemetry?.hasProvenance).toBe(false);
    expect(storedIntent(storage)?.displayEvidence).toEqual({ kind: "whats-on", observedAt: null });
  });

  it("drops a non-canonical borough to null but still accepts the Venue", () => {
    const result = acceptTonightVenue(
      { ...baseInput, area: { kind: "borough", name: "Notting Dale Superborough" } },
      { storage, now: NOW },
    );
    expect(result.accepted).toBe(true);
    expect(storedIntent(storage)?.acceptedArea).toBeNull();
  });

  it("drops an unknown patch id to null but still accepts the Venue", () => {
    const result = acceptTonightVenue(
      { ...baseInput, area: { kind: "patch", id: "not-a-real-patch" } },
      { storage, now: NOW },
    );
    expect(result.accepted).toBe(true);
    expect(storedIntent(storage)?.acceptedArea).toBeNull();
  });

  it("degrades to a browse selection (no acceptance, no telemetry) when storage denies", () => {
    const result = acceptTonightVenue(baseInput, { storage: throwingStorage(), now: NOW });
    expect(result.accepted).toBe(false);
    expect(result.href).not.toContain("accept=1");
    expect(result.telemetry).toBeNull();
  });
});
