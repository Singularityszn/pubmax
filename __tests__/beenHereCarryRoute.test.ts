// POST /api/saved-pubs with `action: "carryBeenHere"`: the first-run card's
// taps, moved to the signed-in account in one request (lib/beenHere.ts).
// It adds to "Been here" and nothing else, never toggles, refuses a caller
// with no verified account, and writes no diary entry.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const caller = vi.hoisted(() => ({ id: null as string | null }));
const limited = vi.hoisted(() => ({ value: false }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: () => Promise.resolve(caller.id) };
});
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return {
    ...actual,
    profileStore: () => actual.memoryProfileStore,
    supabaseProfileStore: actual.memoryProfileStore,
  };
});
vi.mock("@/lib/identityHandleStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/identityHandleStore")>();
  return { ...actual, identityHandleStore: () => actual.memoryIdentityHandleStore };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => limited.value };
});
const diaryWrites = vi.hoisted(() => vi.fn());
vi.mock("@/lib/diaryStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/diaryStore")>();
  return {
    ...actual,
    diaryStore: () => new Proxy(actual.diaryStore(), {
      get(target, property, receiver) {
        diaryWrites(property);
        return Reflect.get(target, property, receiver);
      },
    }),
  };
});

import { GET, POST } from "@/app/api/saved-pubs/route";
import { BEEN_HERE_CARRY_ACTION, BEEN_HERE_LIST } from "@/lib/beenHere";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";
import { __resetMemorySavedPubs } from "@/lib/savedPubsStore";
import { getVenueIndex, resolveVenue } from "@/lib/venueIndex";
import { nearbyVisitStore, resetNearbyVisitsForTests } from "@/lib/nearbyVisitStore";
import { readPointsBreakdown, readPointsStandingWithVisits } from "@/lib/points.server";

const URL_BASE = "http://localhost/api/saved-pubs";
let lamb = "";
let grapes = "";

beforeAll(async () => {
  const index = await getVenueIndex();
  // Two real pubs the card offers, so the route resolves them as it would live.
  lamb = index.has("venue-1yd70c7") ? "venue-1yd70c7" : [...index.keys()][0]!;
  grapes = index.has("venue-ekvkuv") ? "venue-ekvkuv" : [...index.keys()][1]!;
});

beforeEach(async () => {
  caller.id = null;
  limited.value = false;
  diaryWrites.mockReset();
  __resetMemoryProfiles();
  __resetMemorySavedPubs();
  resetNearbyVisitsForTests();
  await memoryProfileStore.createOwned("mia", "user-mia");
});

function carry(venueIds: unknown, handle = "mia"): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      body: JSON.stringify({ handle, action: BEEN_HERE_CARRY_ACTION, venueIds }),
    }),
  );
}

async function listFor(handle: string): Promise<Array<{ venueId: string; listType: string }>> {
  const res = await GET(new Request(`${URL_BASE}?handle=${handle}`));
  return ((await res.json()) as { saved: Array<{ venueId: string; listType: string }> }).saved;
}

describe("carryBeenHere", () => {
  it.each([0, 20])("does not award points or league visits for fabricated coordinates with accuracy %s", async (accuracy) => {
    caller.id = "user-mia";
    for (const venueId of [lamb, grapes]) {
      const venue = (await resolveVenue(venueId))!;
      const response = await POST(new Request(URL_BASE, {
        method: "POST",
        body: JSON.stringify({
          action: "nearbyCheckIn", venueId,
          location: { lat: venue.lat, lng: venue.lng, accuracy, timestamp: Date.now() },
        }),
      }));
      expect(response.status).toBe(200);
    }
    expect(await nearbyVisitStore().list(caller.id)).toHaveLength(2);
    const points = await readPointsBreakdown({ handle: "mia", userId: caller.id });
    expect(points.lines.find((line) => line.key === "been")).toMatchObject({ count: 0, points: 0 });
    const standing = await readPointsStandingWithVisits({ handle: "mia", userId: caller.id });
    expect(standing.total).toBe(0);
    expect([...standing.visited]).toEqual([]);
  });

  it("checks proximity on the server, saves Been idempotently, and awards five points", async () => {
    caller.id = "user-mia";
    const venue = (await resolveVenue(lamb))!;
    const checkIn = () => POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify({
      handle: "mia", action: "nearbyCheckIn", venueId: lamb,
      location: { lat: venue.lat, lng: venue.lng, accuracy: 20, timestamp: Date.now() },
    }) }));
    expect((await checkIn()).status).toBe(200);
    expect((await checkIn()).status).toBe(200);
    expect((await listFor("mia")).filter((row) => row.venueId === lamb && row.listType === BEEN_HERE_LIST)).toHaveLength(1);
    const points = await readPointsBreakdown({ handle: "mia", userId: caller.id });
    expect(points.lines.find((line) => line.key === "been")).toMatchObject({ count: 1, points: 5 });
    expect((await readPointsBreakdown({ handle: "sam", userId: "user-sam" })).total).toBe(0);
  });

  it("returns 503 without saving Been when proof storage fails", async () => {
    caller.id = "user-mia";
    const venue = (await resolveVenue(lamb))!;
    const proof = vi.spyOn(nearbyVisitStore(), "record").mockRejectedValueOnce(new Error("Proof unavailable"));
    try {
      const response = await POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify({
        handle: "mia", action: "nearbyCheckIn", venueId: lamb,
        location: { lat: venue.lat, lng: venue.lng, accuracy: 20, timestamp: Date.now() },
      }) }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "STORE_UNAVAILABLE" });
      expect(await listFor("mia")).toEqual([]);
      expect(await nearbyVisitStore().list(caller.id)).toEqual([]);
    } finally {
      proof.mockRestore();
    }
  });

  it.each([
    ["venue tag alone", undefined],
    ["distant location", { lat: 0, lng: 0, accuracy: 10 }],
    ["poor accuracy", { lat: 51.5, lng: -0.1, accuracy: 5000 }],
    ["stale location", { lat: 51.5, lng: -0.1, accuracy: 10, timestamp: 1 }],
  ])("refuses %s as nearby proof", async (_name, location) => {
    caller.id = "user-mia";
    const response = await POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify({
      handle: "mia", action: "nearbyCheckIn", venueId: lamb, location,
      note: "verified", proven: true, userId: "user-sam",
    }) }));
    expect(response.status).toBe(400);
    expect(await listFor("mia")).toEqual([]);
    expect((await readPointsBreakdown({ handle: "mia", userId: caller.id })).total).toBe(0);
  });

  it("refuses an anonymous nearby check-in", async () => {
    await memoryProfileStore.ensure("demo");
    const venue = (await resolveVenue(lamb))!;
    const response = await POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify({
      handle: "demo", action: "nearbyCheckIn", venueId: lamb,
      location: { lat: venue.lat, lng: venue.lng, accuracy: 10, timestamp: Date.now() },
    }) }));
    expect(response.status).toBe(401);
    expect(await listFor("demo")).toEqual([]);
  });

  it("adds every tapped pub to the account's Been here list in one request", async () => {
    caller.id = "user-mia";
    const res = await carry([lamb, grapes]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: Array<{ venueId: string; listType: string }>; carried: string[]; refused: string[] };
    expect(body.carried).toEqual([lamb, grapes]);
    expect(body.refused).toEqual([]);
    expect((await readPointsBreakdown({ handle: "mia", userId: caller.id! })).total).toBe(0);
    expect(body.saved.filter((row) => row.listType === BEEN_HERE_LIST).map((row) => row.venueId).sort()).toEqual(
      [lamb, grapes].sort(),
    );
    expect(body.saved.every((row) => row.listType === BEEN_HERE_LIST)).toBe(true);
  });

  it("adds and never toggles, so a repeat after a lost answer keeps every pub", async () => {
    caller.id = "user-mia";
    await carry([lamb]);
    const again = await carry([lamb, grapes]);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { carried: string[] }).carried).toEqual([lamb, grapes]);
    const saved = await listFor("mia");
    expect(saved.filter((row) => row.venueId === lamb && row.listType === BEEN_HERE_LIST)).toHaveLength(1);
    expect(saved.some((row) => row.venueId === grapes)).toBe(true);
  });

  it("names a pub it cannot find, so the device can let it go", async () => {
    caller.id = "user-mia";
    const res = await carry([lamb, "venue-not-a-pub-we-know"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { carried: string[]; refused: string[] };
    expect(body.carried).toEqual([lamb]);
    expect(body.refused).toEqual(["venue-not-a-pub-we-know"]);
  });

  it("refuses a caller with no verified account and writes nothing", async () => {
    await memoryProfileStore.ensure("demo");
    const res = await carry([lamb], "demo");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await listFor("demo")).toEqual([]);
  });

  it("writes to the caller's own list, never the handle the body names", async () => {
    await memoryProfileStore.createOwned("sam", "user-sam");
    caller.id = "user-mia";
    const res = await carry([lamb], "sam");
    expect(res.status).toBe(200);
    expect(await listFor("sam")).toEqual([]);
    expect((await listFor("mia")).map((row) => row.venueId)).toEqual([lamb]);
  });

  it.each([
    ["no ids", []],
    ["a malformed id", ["venue a"]],
    ["a list that is not a list", "venue-1"],
  ])("refuses %s", async (_label, venueIds) => {
    caller.id = "user-mia";
    const res = await carry(venueIds);
    expect(res.status).toBe(400);
    expect(await listFor("mia")).toEqual([]);
  });

  it("spends the save budget and answers 429 when it is gone", async () => {
    caller.id = "user-mia";
    limited.value = true;
    const res = await carry([lamb]);
    expect(res.status).toBe(429);
    expect(await listFor("mia")).toEqual([]);
  });

  it("never touches the diary: a tap has no date", async () => {
    caller.id = "user-mia";
    await carry([lamb, grapes]);
    expect(diaryWrites).not.toHaveBeenCalled();
  });
});
