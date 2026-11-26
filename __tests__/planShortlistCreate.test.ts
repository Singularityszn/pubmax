import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ available: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pintDrops")>(),
  isLimited: async () => false,
}));
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: async () => source.available ? [{
    id: "venue-a", name: "Pub A", area: "Soho", lat: 51.511, lng: -0.134,
    cheapestPrice: 5, cheapestPint: "Lager", priceSource: "Pub menu", priceObservedAt: "2026-01-01",
    amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
    nearWater: false, hasStory: false, canonical: true,
  }] : [],
}));
vi.mock("@/lib/venueDetailIndex", () => ({
  lookupVenueDetail: async () => ({ status: "found", venue: {
    cheapestPrice: 5, cheapestPint: "Lager", prices: [{
      price_gbp: 5, pint_name: "Lager", pub_url: "https://example.com/menu", scraped_at_values: "2026-01-01",
    }],
  } }),
}));

import { POST } from "@/app/api/plans/route";
import { planMemberCookieCapability } from "@/lib/planMemberCapability";
import { shortlistCandidates, shortlistFilters } from "@/lib/planShortlistCandidates.server";
import { readPlanShortlist } from "@/lib/planShortlistStore";
import { __resetMemoryPlans, planMemberIdentity } from "@/lib/planStore";

const input = {
  startTime: "2026-06-29T12:00:00.000Z",
  shortlist: { filters: "area=piccadilly-soho&anchor=venue-a&pintLimit=6", venueIds: ["venue-a"], budgetLimitPence: 3000 },
};

function create(key: string, body = input) {
  return POST(new Request("http://localhost/api/plans", {
    method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  __resetMemoryPlans();
  source.available = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-29T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  __resetMemoryPlans();
});

describe("shortlist creation recovers a lost response from submitted intent", () => {
  it.each(["expired price", "unavailable pub"])("returns the saved Plan and organiser capability after an %s", async (change) => {
    const first = await create("shortlist-lost-response");
    expect(first.status).toBe(201);
    const saved = await first.json() as { planId: string };
    const initial = await readPlanShortlist(saved.planId);
    expect(initial.status === "found" && initial.view.options[0]?.listedPint?.priceGbp).toBe(5);

    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    source.available = change !== "unavailable pub";
    const filters = shortlistFilters(new URLSearchParams(input.shortlist.filters));
    if (!filters) throw new Error("Invalid fixture filters");
    const current = await shortlistCandidates(filters);
    expect(current[0]?.listedPint ?? null).toBeNull();
    if (!source.available) expect(current).toEqual([]);

    const replay = await create("shortlist-lost-response");
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({ planId: saved.planId, created: false });
    const memberToken = (response: Response) => planMemberCookieCapability(new Request("http://localhost", {
      headers: { cookie: response.headers.get("set-cookie")!.split(";")[0]! },
    }), saved.planId);
    expect(memberToken(replay)).toBe(memberToken(first));
    const identity = await planMemberIdentity(saved.planId, memberToken(replay));
    expect(identity?.role).toBe("host");

    const visible = await readPlanShortlist(saved.planId);
    expect(visible.status === "found" && visible.view.options[0]?.listedPint).toBeNull();
    const fresh = await create("new-shortlist-request");
    expect(fresh.status).toBe(source.available ? 201 : 409);
    if (source.available) {
      const freshBody = await fresh.json() as { planId: string };
      const freshView = await readPlanShortlist(freshBody.planId);
      expect(freshView.status === "found" && freshView.view.options[0]?.listedPint).toBeNull();
    }
  });

  it.each([
    { ...input, startTime: "2026-06-29T13:00:00.000Z" },
    { ...input, shortlist: { ...input.shortlist, budgetLimitPence: 4000 } },
    { ...input, shortlist: { ...input.shortlist, venueIds: ["venue-b"] } },
    { ...input, shortlist: { ...input.shortlist, filters: "area=piccadilly-soho&anchor=venue-a&pintLimit=7" } },
  ])("refuses a changed submission with the original key: %j", async (changed) => {
    expect((await create("shortlist-changed-submission")).status).toBe(201);
    source.available = false;
    const response = await create("shortlist-changed-submission", changed);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "This request key was used for a different shortlist." });
  });
});
