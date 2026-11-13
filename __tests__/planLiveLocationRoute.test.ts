import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));

import { DELETE, GET, PUT } from "@/app/api/plans/[id]/live-location/route";
import { planLiveLocationEndsAtMs } from "@/lib/planLiveLocation";
import { memoryPlanLiveLocations, memoryPlanLiveLocationStops } from "@/lib/planLiveLocationMemory";
import { __resetMemoryRsvps, rsvpStore } from "@/lib/planInviteRsvpStore";
import { __resetMemoryPlans, memoryPlanStore, removeMemoryPlanInviteRsvpMember } from "@/lib/planStore";

const NOW = new Date("2026-11-07T20:00:00.000Z");
const FIX = { latitude: 51.5138, longitude: -0.1318, accuracyM: 14.6 };
const GUEST_JOIN = { collaborationAuthorized: true, userId: "live-guest-account", idempotencyKey: "live-location-guest-rejoin" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  __resetMemoryPlans();
  __resetMemoryRsvps();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function night(startTime = NOW.toISOString()) {
  const created = await memoryPlanStore.create({ title: "Our night", startTime, creatorName: "Host", stops: [{ venueId: "a", venueName: "Pub a", position: 0 }] });
  if (!created.ok) throw new Error("Could not create the test plan.");
  const id = created.plan.plan.id;
  const joined = await memoryPlanStore.join(id, "Guest", GUEST_JOIN);
  if (!joined.ok) throw new Error("Could not join the test plan.");
  const guestId = joined.plan.crew.find((member) => member.name === "Guest")!.id;
  return { id, host: created.memberToken, guest: joined.memberToken, guestId };
}

function request(id: string, token: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost/api/plans/${id}/live-location`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const read = async (id: string, token: string) => (await GET(request(id, token), context(id))).json();

describe("live location through the private plan route", () => {
  it.each(["ending", "completed", "abandoned", "completion"] as const)("deletes positions and Stop markers immediately on %s", async (terminal) => {
    const { id, host, guest } = await night();
    expect((await PUT(request(id, guest, "PUT", FIX), context(id))).status).toBe(200);
    expect((await DELETE(request(id, host, "DELETE"), context(id))).status).toBe(200);
    expect(memoryPlanLiveLocations.get(id)?.size).toBe(1);
    expect(memoryPlanLiveLocationStops.get(id)?.size).toBe(1);
    expect((await memoryPlanStore.addAction(id, host, { type: "arrived", stopPosition: 0, idempotencyKey: "live-location-terminal-arrival" })).ok).toBe(true);
    const result = terminal === "completion"
      ? await memoryPlanStore.complete(id, host, {
        expectedRouteRevision: 1, ending: "get_home",
        endingSelection: { kind: "get_home", optionId: "transport:nearest-station", evidenceSnapshot: { label: "Nearest station", confidence: "unknown" } },
      })
      : await memoryPlanStore.update(id, host, { status: terminal });
    expect(result.ok).toBe(true);
    expect(memoryPlanLiveLocations.has(id)).toBe(false);
    expect(memoryPlanLiveLocationStops.has(id)).toBe(false);
  });

  it("purges expired positions and Stop markers when another Plan accesses the memory store", async () => {
    const { id, host, guest } = await night();
    await PUT(request(id, guest, "PUT", FIX), context(id));
    await DELETE(request(id, host, "DELETE"), context(id));
    vi.setSystemTime(new Date("2026-11-08T04:00:00Z"));
    const other = await night(new Date().toISOString());
    expect(await read(other.id, other.host)).toMatchObject({ live: true });
    expect(memoryPlanLiveLocations.has(id)).toBe(false);
    expect(memoryPlanLiveLocationStops.has(id)).toBe(false);
  });

  it("shows a member's dot to the crew once they turn it on, and not before", async () => {
    const { id, host, guest, guestId } = await night();
    expect(await read(id, host)).toMatchObject({ live: true, sharing: false, people: [] });
    const shared = await PUT(request(id, guest, "PUT", FIX), context(id));
    expect(shared.status).toBe(200);
    expect(shared.headers.get("cache-control")).toBe("private, no-store");
    expect(await shared.json()).toMatchObject({ sharing: true, people: [] });
    expect(await read(id, host)).toMatchObject({
      live: true, sharing: false,
      people: [{ memberId: guestId, name: "Guest", latitude: 51.5138, longitude: -0.1318, accuracyM: 15, updatedAt: NOW.toISOString() }],
    });
  });

  it("gives a stranger and a name-only guest the same refusal as a missing plan", async () => {
    const { id, guest } = await night();
    await PUT(request(id, guest, "PUT", FIX), context(id));
    const nameOnly = await memoryPlanStore.join(id, "Name only");
    if (!nameOnly.ok) throw new Error("Could not create a name-only guest.");
    const missing = "11111111-1111-4111-8111-111111111111";
    const stranger = await GET(request(id, "not-a-member"), context(id));
    const named = await GET(request(id, nameOnly.memberToken), context(id));
    const absent = await GET(request(missing, "not-a-member"), context(missing));
    expect([stranger.status, named.status, absent.status]).toEqual([404, 404, 404]);
    const strangerText = await stranger.text();
    expect(strangerText).toBe(await absent.text());
    expect(await named.text()).toBe(strangerText);
    expect(strangerText).not.toContain("51.5138");
    expect((await PUT(request(id, nameOnly.memberToken, "PUT", FIX), context(id))).status).toBe(404);
  });

  it("drops a removed member's dot and gives them nothing", async () => {
    const { id, host, guest, guestId } = await night();
    await PUT(request(id, guest, "PUT", FIX), context(id));
    expect(removeMemoryPlanInviteRsvpMember(id, guestId)).toBe(true);
    expect(await read(id, host)).toMatchObject({ people: [] });
    expect((await GET(request(id, guest), context(id))).status).toBe(404);
    expect((await PUT(request(id, guest, "PUT", FIX), context(id))).status).toBe(404);
  });

  it.each(["maybe", "remove"] as const)("deletes an RSVP guest's position on %s before immediate rejoin", async (action) => {
    const { id, host } = await night();
    const store = rsvpStore();
    const joined = await store.upsert(id, "rsvp-location-guest", "RSVP guest", "going");
    const token = joined.membership!.memberToken;
    expect((await PUT(request(id, token, "PUT", FIX), context(id))).status).toBe(200);
    expect(await read(id, host)).toMatchObject({ people: [{ name: "RSVP guest" }] });
    if (action === "maybe") await store.upsert(id, "rsvp-location-guest", "RSVP guest", "maybe");
    else await store.remove(id, joined.summary.guests.find((guest) => guest.displayName === "RSVP guest")!.id);
    expect((await GET(request(id, token), context(id))).status).toBe(404);
    const rejoined = await store.upsert(id, "rsvp-location-guest", "RSVP guest", "going");
    expect(rejoined.membership!.memberToken).toBe(token);
    expect(await read(id, host)).toMatchObject({ people: [] });
    expect(await read(id, token)).toMatchObject({ sharing: false });
    expect((await PUT(request(id, token, "PUT", FIX), context(id))).status).toBe(200);
    expect(await read(id, host)).toMatchObject({ people: [{ name: "RSVP guest" }] });
  });

  it("removes the dot for everyone as soon as the member stops", async () => {
    const { id, host, guest } = await night();
    await PUT(request(id, host, "PUT", FIX), context(id));
    await PUT(request(id, guest, "PUT", FIX), context(id));
    const stopped = await DELETE(request(id, guest, "DELETE"), context(id));
    expect(await stopped.json()).toMatchObject({ sharing: false, people: [] });
    expect(await read(id, host)).toMatchObject({ sharing: true, people: [] });
  });

  it("lets a seat stop itself without permission to read other people's positions", async () => {
    const { id, host } = await night();
    const named = await memoryPlanStore.join(id, "Name only");
    if (!named.ok) throw new Error("Could not create a name-only guest.");
    await PUT(request(id, host, "PUT", FIX), context(id));
    expect((await GET(request(id, named.memberToken), context(id))).status).toBe(404);
    const stopped = await DELETE(request(id, named.memberToken, "DELETE"), context(id));
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ sharing: false, people: [] });
    expect((await GET(request(id, named.memberToken), context(id))).status).toBe(404);
    expect((await PUT(request(id, named.memberToken, "PUT", FIX), context(id))).status).toBe(404);
    expect(await read(id, host)).toMatchObject({ sharing: true, people: [] });
  });

  it("revokes another client's uploads until an explicit new start", async () => {
    const { id, host, guest } = await night();
    expect((await PUT(request(id, guest, "PUT", { ...FIX, startAt: Date.now() }), context(id))).status).toBe(200);
    expect((await PUT(request(id, guest, "PUT", { ...FIX, startAt: Date.now() }), context(id))).status).toBe(200);
    expect((await DELETE(request(id, guest, "DELETE"), context(id))).status).toBe(200);
    for (const startAt of [undefined, Date.now() - 1, Date.now()]) {
      const refused = await PUT(request(id, guest, "PUT", { ...FIX, startAt }), context(id));
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: "PLAN_LIVE_LOCATION_STOPPED", retryable: false });
      expect(await read(id, host)).toMatchObject({ people: [] });
    }
    for (const startAt of ["now", null, 0, -1, Date.now() + 1, Date.now() - 0.5]) {
      expect((await PUT(request(id, guest, "PUT", { ...FIX, startAt }), context(id))).status).toBe(400);
    }
    vi.setSystemTime(NOW.getTime() + 1);
    expect((await PUT(request(id, guest, "PUT", { ...FIX, startAt: Date.now() }), context(id))).status).toBe(200);
    expect((await PUT(request(id, guest, "PUT", FIX), context(id))).status).toBe(200);
    expect(await read(id, host)).toMatchObject({ people: [{ latitude: FIX.latitude }] });
  });

  it("refuses a delayed first GPS fix authorised before another device stopped", async () => {
    const { id, host, guest } = await night();
    const startAt = Date.now();
    vi.setSystemTime(startAt + 1_000);
    await DELETE(request(id, guest, "DELETE"), context(id));
    vi.setSystemTime(startAt + 2_000);
    const refused = await PUT(request(id, guest, "PUT", { ...FIX, startAt }), context(id));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "PLAN_LIVE_LOCATION_STOPPED" });
    expect(await read(id, host)).toMatchObject({ people: [] });
  });

  it("keeps Stop through leave, an absent-member read and same-night rejoin", async () => {
    const { id, host, guest, guestId } = await night();
    await DELETE(request(id, guest, "DELETE"), context(id));
    expect(removeMemoryPlanInviteRsvpMember(id, guestId)).toBe(true);
    expect(await read(id, host)).toMatchObject({ people: [] });
    const rejoined = await memoryPlanStore.join(id, "Guest", GUEST_JOIN);
    if (!rejoined.ok) throw new Error("Could not rejoin the test plan.");
    expect(rejoined.plan.crew.find((member) => member.name === "Guest")?.id).toBe(guestId);
    expect((await PUT(request(id, rejoined.memberToken, "PUT", FIX), context(id))).status).toBe(409);
    expect(await read(id, host)).toMatchObject({ people: [] });
    vi.setSystemTime(NOW.getTime() + 1_000);
    expect((await PUT(request(id, rejoined.memberToken, "PUT", { ...FIX, startAt: Date.now() }), context(id))).status).toBe(200);
    expect(await read(id, host)).toMatchObject({ people: [{ memberId: guestId }] });
  });

  it("requires a capability for every operation and never caches or discloses denied locations", async () => {
    const { id, host, guest } = await night();
    await PUT(request(id, guest, "PUT", FIX), context(id));
    for (const token of ["", "outsider"]) {
      for (const [method, handler] of [["GET", GET], ["PUT", PUT], ["DELETE", DELETE]] as const) {
        const response = await handler(request(id, token, method, method === "PUT" ? FIX : undefined), context(id));
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const denied = await response.json();
        expect(denied).toMatchObject({ code: "PLAN_LIVE_LOCATION_NOT_FOUND" });
        expect(JSON.stringify(denied)).not.toMatch(/latitude|longitude|51\.5138|-0\.1318/);
        expect(await read(id, host)).toMatchObject({ sharing: false, people: [{ latitude: FIX.latitude }] });
      }
    }
    const response = await GET(request(id, host), context(id));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("switches itself off at the end of the night and refuses new fixes", async () => {
    const { id, host, guest } = await night();
    await PUT(request(id, guest, "PUT", FIX), context(id));
    const end = planLiveLocationEndsAtMs(NOW.toISOString())!;
    expect(new Date(end).toISOString()).toBe("2026-11-08T04:00:00.000Z");
    vi.setSystemTime(end);
    expect(await read(id, host)).toEqual({ visibility: "member", live: false, endsAt: null, sharing: false, people: [] });
    const late = await PUT(request(id, guest, "PUT", FIX), context(id));
    expect(late.status).toBe(409);
    vi.setSystemTime(end - 1);
    expect(await read(id, host)).toMatchObject({ live: true, people: [] });
  });

  it("does not open sharing for a night that has not started", async () => {
    const { id, guest } = await night("2026-11-09T19:00:00.000Z");
    expect((await PUT(request(id, guest, "PUT", FIX), context(id))).status).toBe(409);
  });

  it("closes an 08:00 winter Plan at the intervening 06:00", async () => {
    vi.setSystemTime(new Date("2026-11-08T05:00:00Z"));
    const { id, host, guest } = await night("2026-11-08T08:00:00Z");
    expect((await PUT(request(id, guest, "PUT", FIX), context(id))).status).toBe(200);
    expect(await read(id, host)).toMatchObject({ live: true, endsAt: "2026-11-08T06:00:00.000Z", people: [{ latitude: FIX.latitude }] });
    vi.setSystemTime(new Date("2026-11-08T06:00:00Z"));
    expect(await read(id, host)).toMatchObject({ live: false, people: [] });
    expect((await PUT(request(id, guest, "PUT", FIX), context(id))).status).toBe(409);
  });

  it("rejects a fix that is not on Earth without moving the old one", async () => {
    const { id, host, guest } = await night();
    await PUT(request(id, guest, "PUT", FIX), context(id));
    for (const body of [{ latitude: 91, longitude: 0 }, { latitude: "51.5", longitude: 0 }, { latitude: 51.5, longitude: Number.NaN }]) {
      expect((await PUT(request(id, guest, "PUT", body), context(id))).status).toBe(400);
    }
    expect(await read(id, host)).toMatchObject({ people: [{ latitude: 51.5138 }] });
  });

  it("refuses every operation in production without durable storage", async () => {
    const { id, guest } = await night();
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await GET(request(id, guest), context(id))).status).toBe(503);
    expect((await PUT(request(id, guest, "PUT", FIX), context(id))).status).toBe(503);
  });
});

describe("the night's end", () => {
  it.each([
    ["2026-11-07T20:00:00Z", "2026-11-08T04:00:00.000Z"],
    ["2026-11-08T01:00:00Z", "2026-11-08T06:00:00.000Z"],
    ["2026-11-08T08:00:00Z", "2026-11-08T06:00:00.000Z"],
    ["2026-11-08T09:00:00Z", "2026-11-08T17:00:00.000Z"],
    ["2026-07-11T00:30:00Z", "2026-07-11T05:00:00.000Z"],
    ["2026-07-11T12:00:00Z", "2026-07-11T20:00:00.000Z"],
    ["2026-03-29T00:30:00Z", "2026-03-29T05:00:00.000Z"],
  ])("a start at %s ends at %s, matching 0226", (start, end) => {
    expect(new Date(planLiveLocationEndsAtMs(start)!).toISOString()).toBe(end);
  });
});
