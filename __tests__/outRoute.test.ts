import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  listOpen: vi.fn(),
}));

const whatsOn = vi.hoisted(() => ({
  loadWhatsOn: vi.fn(),
}));

vi.mock("@/lib/socialCrewStore", () => ({
  createSocialCrewStore: () => store,
}));

vi.mock("@/lib/whatsOnStore", () => ({
  loadWhatsOn: (...args: unknown[]) => whatsOn.loadWhatsOn(...args),
}));

import { GET } from "@/app/api/out/route";
import { OUT_OPEN_PLAN_LIMIT } from "@/lib/out";

const OPEN_PLAN = {
  crewId: "50000000-0000-4000-8000-000000000001",
  title: "Friday at the Angel",
  startTime: "2026-08-21T18:30:00.000Z",
  stopVenueId: "venue-angel-islington",
  stopVenueName: "The Angel",
  hostHandle: "alice",
  memberCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  store.listOpen.mockResolvedValue([OPEN_PLAN]);
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
  it("answers ready plans beside the events half", async () => {
    const response = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/s-maxage=300/);
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.openPlans).toEqual([OPEN_PLAN]);
    expect(Array.isArray(body.events)).toBe(true);
    expect(store.listOpen).toHaveBeenCalledWith(
      expect.objectContaining({ city: "london", limit: OUT_OPEN_PLAN_LIMIT }),
    );
  });

  it("marks a failed plans read degraded rather than an empty market", async () => {
    store.listOpen.mockRejectedValue(new Error("rpc down"));
    const response = await GET(new Request("http://localhost/api/out?day=today"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.openPlans).toEqual([]);
    expect(body).not.toEqual(
      expect.objectContaining({ status: "ready", openPlans: [] }),
    );
  });

  it("keeps a successful empty list as ready", async () => {
    store.listOpen.mockResolvedValue([]);
    const response = await GET(new Request("http://localhost/api/out"));
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.openPlans).toEqual([]);
  });
});
