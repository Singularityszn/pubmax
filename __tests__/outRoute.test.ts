import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  listOpen: vi.fn(),
}));

const whatsOn = vi.hoisted(() => ({
  loadWhatsOn: vi.fn(),
}));

const limiter = vi.hoisted(() => ({ limited: false }));

const venueIndex = vi.hoisted(() => ({
  readable: true,
  /** Canonical id -> display name, standing in for the slim packs. */
  venues: new Map<string, string>([
    ["venue-angel-islington", "The Angel"],
    ["venue-mcr-northern", "The Northern"],
  ]),
}));

vi.mock("@/lib/socialCrewStore", () => ({
  createSocialCrewStore: () => store,
}));

vi.mock("@/lib/whatsOnStore", () => ({
  loadWhatsOn: (...args: unknown[]) => whatsOn.loadWhatsOn(...args),
}));

vi.mock("@/lib/outRateLimit", () => ({
  isOutLimited: vi.fn(async () => limiter.limited),
}));

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: vi.fn(async (id: string) => {
    if (!venueIndex.readable) return { status: "unavailable", canonicalId: id };
    const name = venueIndex.venues.get(id);
    return name
      ? {
          status: "found",
          canonicalId: id,
          venue: { id, name, borough: "Islington", lat: 51.53, lng: -0.1 },
          slimVenue: { id, name },
        }
      : { status: "unknown", canonicalId: id };
  }),
}));

vi.mock("@/lib/planStore", () => ({
  planStateResult: vi.fn(async () => ({ ok: true, plan: null })),
}));

import { GET } from "@/app/api/out/route";
import {
  OUT_OPEN_PLAN_LIMIT,
  OUT_UNAVAILABLE_ERROR,
  type OutOpenPlan,
} from "@/lib/out";

function openPlan(overrides: Partial<OutOpenPlan> = {}): OutOpenPlan {
  return {
    crewId: "50000000-0000-4000-8000-000000000001",
    title: "Friday at the Angel",
    startTime: "2026-08-21T18:30:00.000Z",
    stopVenueId: "venue-angel-islington",
    stopVenueName: "The Angel",
    hostHandle: "alice",
    memberCount: 1,
    meetingPoint: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  limiter.limited = false;
  venueIndex.readable = true;
  store.listOpen.mockResolvedValue([openPlan()]);
  whatsOn.loadWhatsOn.mockResolvedValue({
    rows: [],
    servedAt: "2026-08-16T12:00:00.000Z",
    revalidation: { status: "measured" },
    sourceObservedAt: null,
    sourceFreshnessKind: "bundled",
    kindObservedAt: {},
    localityBasis: "city",
    asOf: null,
  });
});

describe("GET /api/out openPlans", () => {
  it("answers ready plans with the meeting point a card renders", async () => {
    const response = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/s-maxage=300/);
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.openPlans).toHaveLength(1);
    expect(body.openPlans[0].meetingPoint).toEqual({
      kind: "venue",
      name: "The Angel",
      lat: 51.53,
      lng: -0.1,
    });
    expect(Array.isArray(body.events)).toBe(true);
    expect(store.listOpen).toHaveBeenCalledWith({
      from: expect.any(String),
      until: expect.any(String),
      city: "london",
      limit: OUT_OPEN_PLAN_LIMIT,
    });
  });

  it("marks a failed plans read degraded and keeps it off the CDN", async () => {
    store.listOpen.mockRejectedValue(new Error("rpc down"));
    const response = await GET(new Request("http://localhost/api/out?day=today"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.openPlans).toEqual([]);
  });

  it("keeps a successful empty list as ready", async () => {
    store.listOpen.mockResolvedValue([]);
    const response = await GET(new Request("http://localhost/api/out"));
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.openPlans).toEqual([]);
  });

  it("refuses an unauthenticated flood", async () => {
    limiter.limited = true;
    const response = await GET(new Request("http://localhost/api/out"));
    expect(response.status).toBe(429);
    expect(store.listOpen).not.toHaveBeenCalled();
  });

  it("answers the house error sentence when events fail, never raw exception text", async () => {
    whatsOn.loadWhatsOn.mockRejectedValue(new Error("secret upstream detail"));
    const response = await GET(new Request("http://localhost/api/out?day=today"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error).toBe(OUT_UNAVAILABLE_ERROR);
    expect(body.error).not.toContain("secret upstream detail");
    expect(body.status).toBe("degraded");
  });
});

describe("GET /api/out city", () => {
  const manchesterPlan = openPlan({
    crewId: "50000000-0000-4000-8000-000000000002",
    title: "Northern Quarter round",
    stopVenueId: "venue-mcr-northern",
    stopVenueName: "The Northern",
  });

  beforeEach(() => {
    store.listOpen.mockImplementation(async (input: { city: string }) => {
      if (input.city === "manchester") return [manchesterPlan];
      return [openPlan()];
    });
  });

  it("asks the RPC for the requested city", async () => {
    const london = await (
      await GET(new Request("http://localhost/api/out?city=london"))
    ).json();
    expect(london.openPlans.map((plan: OutOpenPlan) => plan.crewId)).toEqual([
      openPlan().crewId,
    ]);
    expect(store.listOpen).toHaveBeenCalledWith(
      expect.objectContaining({ city: "london" }),
    );

    const manchester = await (
      await GET(new Request("http://localhost/api/out?city=manchester"))
    ).json();
    expect(manchester.status).toBe("ready");
    expect(manchester.openPlans.map((plan: OutOpenPlan) => plan.crewId)).toEqual([
      manchesterPlan.crewId,
    ]);
    expect(store.listOpen).toHaveBeenCalledWith(
      expect.objectContaining({ city: "manchester" }),
    );
  });

  it("drops a row whose Stop 1 cannot be resolved for the meeting point", async () => {
    store.listOpen.mockResolvedValue([
      openPlan({ stopVenueId: "venue-gone-from-the-index" }),
      openPlan({ crewId: "50000000-0000-4000-8000-000000000003", stopVenueId: null }),
    ]);
    const body = await (
      await GET(new Request("http://localhost/api/out?city=london"))
    ).json();
    expect(body.openPlans).toEqual([]);
    expect(body.status).toBe("ready");
  });

  it("degrades rather than emptying the market when the index cannot be read", async () => {
    venueIndex.readable = false;
    const response = await GET(new Request("http://localhost/api/out?city=london"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.openPlans).toEqual([]);
  });
});
