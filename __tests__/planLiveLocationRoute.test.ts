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
import { __resetMemoryPlans, memoryPlanStore, removeMemoryPlanInviteRsvpMember } from "@/lib/planStore";

const NOW = new Date("2026-11-07T20:00:00.000Z");
const FIX = { latitude: 51.5138, longitude: -0.1318, accuracyM: 14.6 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  __resetMemoryPlans();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function night(startTime = NOW.toISOString()) {
  const created = await memoryPlanStore.create({ title: "Our night", startTime, creatorName: "Host", stops: [{ venueId: "a", venueName: "Pub a", position: 0 }] });
  if (!created.ok) throw new Error("Could not create the test plan.");
  const id = created.plan.plan.id;
  const joined = await memoryPlanStore.join(id, "Guest", { collaborationAuthorized: true, userId: "live-guest-account" });
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

  it("removes the dot for everyone as soon as the member stops", async () => {
    const { id, host, guest } = await night();
    await PUT(request(id, guest, "PUT", FIX), context(id));
    const stopped = await DELETE(request(id, guest, "DELETE"), context(id));
    expect(await stopped.json()).toMatchObject({ sharing: false });
    expect(await read(id, host)).toMatchObject({ people: [] });
  });

  it("revokes another client's uploads until an explicit new start", async () => {
    const { id, host, guest } = await night();
    expect((await PUT(request(id, guest, "PUT", { ...FIX, start: true }), context(id))).status).toBe(200);
    expect((await PUT(request(id, guest, "PUT", { ...FIX, start: true }), context(id))).status).toBe(200);
    expect((await DELETE(request(id, guest, "DELETE"), context(id))).status).toBe(200);
    for (const start of [undefined, false]) {
      const refused = await PUT(request(id, guest, "PUT", { ...FIX, start }), context(id));
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: "PLAN_LIVE_LOCATION_STOPPED", retryable: false });
      expect(await read(id, host)).toMatchObject({ people: [] });
    }
    expect((await PUT(request(id, guest, "PUT", { ...FIX, start: "true" }), context(id))).status).toBe(400);
    expect((await PUT(request(id, guest, "PUT", { ...FIX, start: true }), context(id))).status).toBe(200);
    expect((await PUT(request(id, guest, "PUT", FIX), context(id))).status).toBe(200);
    expect(await read(id, host)).toMatchObject({ people: [{ latitude: FIX.latitude }] });
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
