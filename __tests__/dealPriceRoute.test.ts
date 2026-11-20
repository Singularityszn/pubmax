import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ signedIn: true, moderator: false }));
vi.mock("@/lib/adminAuth", () => ({ isModerator: () => identity.moderator }));
vi.mock("@/lib/supabase", async (original) => ({ ...await original<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false, requiresSupabaseStore: () => false }));
vi.mock("@/lib/contributionIdentity.server", () => ({ resolveContributionIdentity: async () => identity.signedIn
  ? { ok: true, accountId: "account-private", actor: "profile-private", handle: "member" }
  : { ok: false, httpStatus: 401, body: { error: "Sign in to contribute." } } }));
vi.mock("@/lib/venueWriteTarget.server", () => ({ resolveWritableVenueId: async (venueId: string) => venueId === "venue-dealtest" ? { ok: true, venueId } : { ok: false, status: 400, error: "Choose a pub." } }));
vi.mock("@/lib/pintDropAuthority.server", () => ({ pintDropAuthorityKey: () => "opaque-private-token" }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/communityPriceActor", () => ({ deriveCommunityPriceActor: () => "reader" }));

import { GET, POST } from "@/app/api/deal-prices/route";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/deal-prices/route";

const deal = { venueId: "venue-dealtest", drinkCategory: "beer", drink: "Lager", measure: "pint", priceGbp: 4.5, schedule: { days: [1, 2], start: "16:00", end: "19:00" }, endDate: null, conditions: "With a meal" };
function post(body: unknown) { return POST(new Request("http://localhost/api/deal-prices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })); }
function get() { return GET(new Request("http://localhost/api/deal-prices?venueId=venue-dealtest")); }

beforeEach(() => { identity.signedIn = true; identity.moderator = false; });
afterEach(() => { vi.useRealTimers(); });

describe("deal price route", () => {
  it("rejects an unauthenticated report and invalid hours", async () => {
    identity.signedIn = false;
    expect((await post(deal)).status).toBe(401);
    identity.signedIn = true;
    expect((await post({ ...deal, schedule: null })).status).toBe(400);
    expect((await post({ ...deal, endDate: "2001-01-01" })).status).toBe(400);
  });

  it("retains an old open-ended report on its sheet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    expect((await post({ ...deal, drink: "Older fixture" })).status).toBe(201);
    vi.setSystemTime(new Date("2026-02-02T12:00:00Z"));
    const venue = await (await get()).json();
    expect(venue.deals.some((row: { drink: string }) => row.drink === "Older fixture")).toBe(true);
  });

  it("requires a venue instead of exposing a cross-venue index", async () => {
    expect((await GET(new Request("http://localhost/api/deal-prices"))).status).toBe(400);
  });

  it("allows a reader to flag a deal and a moderator to hide only the reviewed version", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    const created = await (await post({ ...deal, drink: "Report fixture" })).json();
    identity.signedIn = false;
    expect((await post({ action: "report", id: created.deal.id })).status).toBe(200);
    expect((await post({ action: "report", id: created.deal.id })).status).toBe(200);
    expect((await adminGet(new Request("http://localhost/api/admin/deal-prices"))).status).toBe(403);
    identity.moderator = true;
    const readAdmin = () => adminGet(new Request("http://localhost/api/admin/deal-prices"));
    const decide = (revision: string, action: string) => adminPost(new Request("http://localhost/api/admin/deal-prices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: created.deal.id, revision, action }) }));
    const review = await (await readAdmin()).json();
    expect(review.deals).toHaveLength(1);
    identity.signedIn = true;
    vi.advanceTimersByTime(1000);
    expect((await post({ ...deal, drink: "Report fixture", priceGbp: 5 })).status).toBe(201);
    expect((await decide(review.deals[0].revision, "hide")).status).toBe(409);
    const refreshed = await (await readAdmin()).json();
    expect((await decide(refreshed.deals[0].revision, "hide")).status).toBe(200);
    const visible = await (await get()).json();
    expect(visible.deals.some((row: { id: string }) => row.id === created.deal.id)).toBe(false);
    const hidden = await (await readAdmin()).json();
    expect((await decide(refreshed.deals[0].revision, "restore")).status).toBe(409);
    const updatedHidden = await (await post({ ...deal, drink: "Report fixture", priceGbp: 5.5 })).json();
    expect(updatedHidden.visible).toBe(false);
    expect((await decide(hidden.deals[0].revision, "restore")).status).toBe(409);
    const current = await (await readAdmin()).json();
    expect((await decide(current.deals[0].revision, "restore")).status).toBe(200);
    expect((await (await readAdmin()).json()).deals).toHaveLength(0);
    expect((await post({ action: "report", id: created.deal.id })).status).toBe(200);
    expect((await (await readAdmin()).json()).deals).toHaveLength(1);
  });

  it("stores a separate dated deal, replaces the same reporter's correction, and keeps identity private", async () => {
    expect((await post(deal)).status).toBe(201);
    expect((await post({ ...deal, priceGbp: 5, conditions: "Members only" })).status).toBe(201);
    const body = await (await get()).json();
    const matching = body.deals.filter((row: { drink: string }) => row.drink === "Lager");
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ venueId: deal.venueId, priceGbp: 5, conditions: "Members only", schedule: deal.schedule });
    expect(matching[0].reportedAt).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("private");
  });
});
