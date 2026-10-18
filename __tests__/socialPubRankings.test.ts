import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerSocialPubComparison,
  nextSocialPubOpponent,
  socialPubBandScore,
  socialPubComparisonNeighbours,
  socialPubRankingEntries,
  startSocialPubComparison,
  type SocialPubComparison,
} from "@/lib/socialPubRankings";
import { createMemorySocialPubRankingStore } from "@/lib/socialPubRankingStore";

/** Runs a whole session against a hidden true order, counting the questions. */
function settle(band: string[], truth: string[], newVenue: string): { slot: number; asked: number } {
  let session: SocialPubComparison = startSocialPubComparison(band, newVenue);
  let asked = 0;
  for (let opponent = nextSocialPubOpponent(session); opponent; opponent = nextSocialPubOpponent(session)) {
    asked += 1;
    session = answerSocialPubComparison(session, truth.indexOf(newVenue) < truth.indexOf(opponent) ? "new" : "existing");
  }
  return { slot: session.low, asked };
}

describe("which did you prefer", () => {
  it("finds the true slot in about log2(n) questions", () => {
    const truth = Array.from({ length: 16 }, (_, i) => `pub-${i}`);
    for (const [index, newVenue] of truth.entries()) {
      const band = truth.filter((id) => id !== newVenue);
      const { slot, asked } = settle(band, truth, newVenue);
      expect(slot).toBe(index);
      expect(asked).toBeLessThanOrEqual(4);
    }
  });

  it("asks nothing for an empty band, and names the neighbours of the slot", () => {
    const empty = startSocialPubComparison([], "harp");
    expect(nextSocialPubOpponent(empty)).toBeNull();
    expect(socialPubComparisonNeighbours(empty)).toEqual({ aboveVenueId: null, belowVenueId: null });
    const session: SocialPubComparison = { band: ["a", "b", "c"], low: 2, high: 2 };
    expect(socialPubComparisonNeighbours(session)).toEqual({ aboveVenueId: "b", belowVenueId: "c" });
    expect(socialPubComparisonNeighbours({ band: ["a"], low: 1, high: 1 })).toEqual({ aboveVenueId: "a", belowVenueId: null });
  });

  it("leaves the pub being re-ranked out of its own questions, and settles a tie just below", () => {
    const session = startSocialPubComparison(["a", "harp", "b"], "harp");
    expect(session.band).toEqual(["a", "b"]);
    const tied = answerSocialPubComparison(session, "tie");
    expect(nextSocialPubOpponent(tied)).toBeNull();
    expect(socialPubComparisonNeighbours(tied)).toEqual({ aboveVenueId: "b", belowVenueId: null });
  });
});

describe("derived 0-10 scores", () => {
  it("spreads each band over its own stretch, top place first", () => {
    expect(socialPubBandScore("loved", 0, 1)).toBe(10);
    expect([0, 1, 2].map((i) => socialPubBandScore("loved", i, 3))).toEqual([10, 8.4, 6.8]);
    expect(socialPubBandScore("fine", 0, 2)).toBe(6.7);
    expect(socialPubBandScore("not_for_me", 1, 2)).toBe(0);
  });

  it("orders bands loved, fine, not for me and numbers places across them", () => {
    const entries = socialPubRankingEntries([
      { venueId: "spoons", band: "not_for_me", rankKey: 1, updatedAt: "" },
      { venueId: "lamb", band: "loved", rankKey: 2000, updatedAt: "" },
      { venueId: "harp", band: "loved", rankKey: 1000, updatedAt: "" },
      { venueId: "bell", band: "fine", rankKey: 5, updatedAt: "" },
    ], new Map([["harp", "The Harp"]]));
    expect(entries.map((entry) => `${entry.place}:${entry.venueId}:${entry.score}`)).toEqual([
      "1:harp:10", "2:lamb:6.8", "3:bell:6.7", "4:spoons:3.3",
    ]);
    expect(entries[0]?.venueName).toBe("The Harp");
  });
});

describe("memory pub ranking store", () => {
  let store = createMemorySocialPubRankingStore();
  const me = { profileId: "me" };
  beforeEach(() => {
    store = createMemorySocialPubRankingStore();
  });

  it("places between adjacent neighbours, refuses a stale pair, and moves a ranked pub", async () => {
    await store.place(me, "harp", "loved", null, null);
    await store.place(me, "lamb", "loved", "harp", null);
    await store.place(me, "crown", "loved", "harp", "lamb");
    await expect(store.place(me, "plough", "loved", null, "lamb")).rejects.toThrow(/changed/);
    await store.place(me, "harp", "fine", null, null);
    const order = socialPubRankingEntries(await store.read(me)).map((entry) => entry.venueId);
    expect(order).toEqual(["crown", "lamb", "harp"]);
    expect(await store.read({ profileId: "you" })).toEqual([]);
    expect(await store.remove(me, "lamb")).toBe(true);
  });

  it("puts a pub back where it was when its move is refused", async () => {
    await store.place(me, "harp", "loved", null, null);
    await store.place(me, "lamb", "loved", "harp", null);
    await expect(store.place(me, "harp", "loved", "nowhere", null)).rejects.toThrow(/changed/);
    expect((await store.read(me)).map((row) => row.venueId).sort()).toEqual(["harp", "lamb"]);
  });
});

const routeState = vi.hoisted(() => ({ access: { ok: true, actor: { accountId: "a", profileId: "me", handle: "me" } } as unknown }));
vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: async () => routeState.access }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: () => null }));
vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => id === "nowhere"
    ? { status: "missing" }
    : { status: "found", canonicalId: id, venue: { id, name: `Pub ${id}`, kind: "pub" } },
}));

describe("/api/social/rankings", () => {
  function json(method: string, body: unknown): Request {
    return new Request("http://localhost/api/social/rankings", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  it("places pubs, answers the list with places and scores, and refuses a stale pair with 409", async () => {
    const { POST, GET, DELETE } = await import("@/app/api/social/rankings/route");
    expect((await POST(json("POST", { venueId: "r-harp", band: "loved", aboveVenueId: null, belowVenueId: null }))).status).toBe(200);
    const second = await POST(json("POST", { venueId: "r-lamb", band: "loved", aboveVenueId: "r-harp", belowVenueId: null }));
    expect((await second.json()).entries.map((entry: { venueName: string; score: number }) => `${entry.venueName}:${entry.score}`))
      .toEqual(["Pub r-harp:10", "Pub r-lamb:6.8"]);
    const stale = await POST(json("POST", { venueId: "r-crown", band: "loved", aboveVenueId: null, belowVenueId: "r-lamb" }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE_RANKING");
    expect((await POST(json("POST", { venueId: "nowhere", band: "loved", aboveVenueId: null, belowVenueId: null }))).status).toBe(400);
    expect((await POST(json("POST", { venueId: "r-x", band: "great", aboveVenueId: null, belowVenueId: null }))).status).toBe(400);
    expect((await DELETE(json("DELETE", { venueId: "r-lamb" }))).status).toBe(200);
    const listed = await GET(new Request("http://localhost/api/social/rankings"));
    expect((await listed.json()).entries).toHaveLength(1);
  });
});
