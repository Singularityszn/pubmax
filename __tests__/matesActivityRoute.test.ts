import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mates' activity on the Social Following lane: the route answers a verified
// reader with the pints their MUTUAL friends logged, newest first. These run on
// the keyless memory stores, so the follow graph, the profiles, the drops, the
// mutes and the blocks are the real ones.

const routeState = vi.hoisted(() => ({
  access: null as unknown,
  limited: false,
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => routeState.access,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => routeState.limited };
});

import { GET } from "@/app/api/social/mates-activity/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { MATES_ACTIVITY_LIMIT, parseMatesActivity, type MatesActivityItem } from "@/lib/matesActivity";
import { readMatesActivity } from "@/lib/matesActivity.server";
import * as pointsReader from "@/lib/points.server";
import { __resetDiary, diaryStore } from "@/lib/diaryStore";
import * as passportReader from "@/lib/profilePassport.server";
import * as venueIndex from "@/lib/venueIndex";
import * as venueAliases from "@/lib/venueAliases";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile, profileStore } from "@/lib/profileStore";
import {
  clearSocialMemoryBlocks,
  setSocialMemoryBlock,
  setSocialMemoryMute,
} from "@/lib/socialBlockMemory";

const THE_LAMB = "venue-1yd70c7";
const ME = "mates_feed_me";

function drop(id: string, handle: string, createdAt: string, extra: Partial<PintDrop> = {}): PintDrop {
  return {
    id,
    venueId: THE_LAMB,
    handle,
    drink: "Guinness",
    priceGbp: 6.2,
    priceEvidence: "unchecked",
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt,
    ...extra,
  };
}

function seed(handle: string) {
  return __seedMemoryOwnedProfile(handle, `user-${handle}`);
}

async function mutual(handle: string) {
  await followStore().follow(ME, handle);
  await followStore().follow(handle, ME);
}

async function ask(): Promise<{ status: number; items: MatesActivityItem[] }> {
  const response = await GET(new Request("http://localhost/api/social/mates-activity"));
  const body = (await response.json()) as { items?: MatesActivityItem[] };
  return { status: response.status, items: body.items ?? [] };
}

let me: ReturnType<typeof __seedMemoryOwnedProfile>;

beforeEach(() => {
  me = seed(ME);
  routeState.access = { ok: true, actor: { accountId: `user-${ME}`, profileId: me.id, handle: ME } };
  routeState.limited = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetPintDrops();
  __resetDiary();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
});

describe("GET /api/social/mates-activity", () => {
  it.each([
    { status: 200, body: { items: [] } },
    { status: 403, body: { code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", retryable: false } },
    { status: 429, body: { code: "RATE_LIMITED", retryable: true } },
    { status: 503, body: { code: "MATES_ACTIVITY_UNAVAILABLE", retryable: true } },
  ])("returns the rotated resume cookie with a $status response", async ({ status, body }) => {
    const resumeCookie = "pubmax_session_resume=rotated-token; Path=/; HttpOnly; SameSite=Lax";
    routeState.access = {
      ok: true,
      actor: { accountId: `user-${ME}`, profileId: me.id, handle: ME },
      resumeCookie,
    };
    if (status === 403) {
      routeState.access = {
        ok: false,
        error: "Adult verification is needed for Social.",
        code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
        status,
        resumeCookie,
      };
    }
    routeState.limited = status === 429;
    if (status === 503) {
      vi.spyOn(followStore(), "listMutuals").mockRejectedValueOnce(new Error("Feed unavailable"));
    }

    const response = await GET(new Request("http://localhost/api/social/mates-activity"));

    expect(response.status).toBe(status);
    expect(response.headers.get("Set-Cookie")).toBe(resumeCookie);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject(body);
  });

  it("refuses a reader with no verified session, privately", async () => {
    routeState.access = { ok: false, error: "Sign in to use Social.", code: "SOCIAL_SIGN_IN_REQUIRED", status: 401 };
    const response = await GET(new Request("http://localhost/api/social/mates-activity"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("answers a rate-limited reader with 429", async () => {
    routeState.limited = true;
    expect((await ask()).status).toBe(429);
  });

  it("shows only mutual friends' pints, newest first, with the pub and the price as logged", async () => {
    seed("mate_a");
    seed("mate_b");
    seed("one_way");
    seed("stranger");
    await mutual("mate_a");
    await mutual("mate_b");
    await followStore().follow(ME, "one_way");

    addPintDrop(drop("a-old", "mate_a", "2026-11-10T19:00:00.000Z"));
    addPintDrop(drop("b-new", "mate_b", "2026-11-11T20:00:00.000Z", { visibility: "friends", priceGbp: null, priceEvidence: undefined }));
    addPintDrop(drop("a-anon", "mate_a", "2026-11-11T21:00:00.000Z", { visibility: "anonymous" }));
    addPintDrop(drop("a-hidden", "mate_a", "2026-11-11T22:00:00.000Z", { status: "hidden" }));
    addPintDrop(drop("a-demo", "mate_a", "2026-11-11T23:00:00.000Z", { provenance: "demo" }));
    addPintDrop(drop("one-way", "one_way", "2026-11-11T22:00:00.000Z"));
    addPintDrop(drop("stranger", "stranger", "2026-11-11T22:00:00.000Z"));
    addPintDrop(drop("mine", ME, "2026-11-11T23:00:00.000Z"));

    const { status, items } = await ask();
    expect(status).toBe(200);
    expect(items.map((item) => item.id)).toEqual(["b-new", "a-old"]);
    expect(items[0]).toMatchObject({ handle: "mate_b", priceGbp: null, venueName: "The Lamb" });
    expect(items[0]).not.toHaveProperty("priceEvidence");
    expect(items[1]).toMatchObject({ handle: "mate_a", priceGbp: 6.2, priceEvidence: "unchecked", venueId: THE_LAMB });
    expect(items[1]).toHaveProperty("venueMapUrl", expect.stringContaining(THE_LAMB));
  });

  it("leaves out a mate the reader muted and a mate blocked either way", async () => {
    const muted = seed("muted_mate");
    const blocked = seed("blocked_mate");
    const blocker = seed("blocker_mate");
    seed("kept_mate");
    for (const handle of ["muted_mate", "blocked_mate", "blocker_mate", "kept_mate"]) await mutual(handle);
    setSocialMemoryMute(me.id, muted.id, true);
    setSocialMemoryBlock(me.id, blocked.id, true);
    setSocialMemoryBlock(blocker.id, me.id, true);
    for (const handle of ["muted_mate", "blocked_mate", "blocker_mate", "kept_mate"]) {
      addPintDrop(drop(`drop-${handle}`, handle, "2026-11-11T20:00:00.000Z"));
    }

    const { items } = await ask();
    expect(items.map((item) => item.handle)).toEqual(["kept_mate"]);
  });

  it("answers an empty list for a reader with no mates", async () => {
    seed("stranger");
    addPintDrop(drop("stranger", "stranger", "2026-11-11T22:00:00.000Z"));
    const { status, items } = await ask();
    expect(status).toBe(200);
    expect(items).toEqual([]);
  });

  it("excludes a muted mate beyond 500 mutes without hiding a mate who muted the reader", async () => {
    for (let index = 0; index < 500; index += 1) {
      const unrelated = seed(`muted_other_${index}`);
      setSocialMemoryMute(me.id, unrelated.id, true);
    }
    const muted = seed("muted_mate");
    const kept = seed("kept_mate");
    await mutual("muted_mate");
    await mutual("kept_mate");
    setSocialMemoryMute(me.id, muted.id, true);
    setSocialMemoryMute(kept.id, me.id, true);
    addPintDrop(drop("muted", "muted_mate", "2026-11-11T21:00:00.000Z"));
    addPintDrop(drop("kept", "kept_mate", "2026-11-11T20:00:00.000Z", { visibility: "friends" }));

    const { status, items } = await ask();
    expect(status).toBe(200);
    expect(items.map((item) => item.id)).toEqual(["kept"]);
  });

  it("does not read or return drops when a candidate mute check fails", async () => {
    seed("mate_a");
    await mutual("mate_a");
    const listMateDrops = vi.fn(async () => [{
      ...drop("mate-drop", "mate_a", "2026-11-11T20:00:00.000Z"),
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      receiptPhotoUrl: null,
    }]);

    await expect(readMatesActivity({ profileId: me.id, handle: ME }, {
      isMuted: async () => { throw new Error("Mute read unavailable"); },
      listMateDrops,
    })).rejects.toThrow("Mute read unavailable");
    expect(listMateDrops).not.toHaveBeenCalled();
  });

  it("caps the answer at the newest rows", async () => {
    seed("busy_mate");
    await mutual("busy_mate");
    for (let index = 0; index < MATES_ACTIVITY_LIMIT + 3; index += 1) {
      const minute = String(index).padStart(2, "0");
      addPintDrop(drop(`busy-${minute}`, "busy_mate", `2026-11-11T20:${minute}:00.000Z`));
    }
    const { items } = await ask();
    expect(items).toHaveLength(MATES_ACTIVITY_LIMIT);
    expect(items[0]?.id).toBe(`busy-${String(MATES_ACTIVITY_LIMIT + 2).padStart(2, "0")}`);
  });

  function challengePubs() {
    const pubs = ["lion-one", "lion-two"].map((id) => ({
      id, name: "The Red Lion", borough: "Camden", lat: 51.5, lng: -0.1,
    }));
    vi.spyOn(venueIndex, "readCityVenueIndex").mockResolvedValue(new Map(pubs.map((pub) => [pub.id, {
      venue: pub, slimVenue: { ...pub, cheapestPrice: null },
    }])));
    return pubs;
  }

  it("shows a challenge finish dated only by reader-visible drops", async () => {
    const mate = seed("finisher");
    await mutual("finisher");
    const pubs = challengePubs();
    for (const pub of pubs) {
      await diaryStore().create({
        ownerUserId: mate.userId!, venueId: pub.id, venueName: pub.name,
        visitedOn: "2026-08-01", rating: null, review: "", visibility: "private",
      });
    }
    addPintDrop(drop("first-pint", "finisher", "2026-09-01T19:00:00.000Z", { venueId: pubs[0]!.id }));
    addPintDrop(drop("last-pint", "finisher", "2026-09-02T19:00:00.000Z", {
      venueId: pubs[1]!.id, visibility: "friends",
    }));
    addPintDrop(drop("repeat-pint", "finisher", "2026-09-03T19:00:00.000Z", { venueId: pubs[0]!.id }));
    const own = await pointsReader.readPointsBreakdown(mate);
    expect(own.challenges.find(({ id }) => id === "red-lion")?.finishedAt).toBe("2026-08-01T00:00:00.000Z");

    const answer = await ask();
    expect(answer.status).toBe(200);
    const finish = answer.items.find((item) => item.kind === "challenge_finished");
    expect(finish).toMatchObject({
      kind: "challenge_finished", handle: "finisher", challengeId: "red-lion", loggedAt: "2026-09-02T19:00:00.000Z",
    });
    expect(finish).not.toHaveProperty("total");
    expect(finish).not.toHaveProperty("userId");
    expect(answer.items[0]?.id).toBe("repeat-pint");
    expect(parseMatesActivity({ items: answer.items })).toEqual(answer.items);
  });

  it.each(["diary", "anonymous", "plan", "been-here"])(
    "keeps a challenge finished through private %s records in the owner's progress alone",
    async (source) => {
      const mate = seed("finisher");
      await mutual("finisher");
      const pubs = challengePubs();
      const passport = passportReader.defaultPassportDeps();
      if (source === "plan" || source === "been-here") {
        vi.spyOn(passportReader, "defaultPassportDeps").mockImplementation(() => ({
          ...passport,
          ...(source === "plan" ? { plans: async () => pubs.map((pub) => ({
            venueId: pub.id, venueName: pub.name, date: "2026-09-01", source: "plan" as const,
          })) } : { beenHere: async () => pubs.map((pub) => ({
            venueId: pub.id, venueName: pub.name, savedAt: "2026-09-01T19:00:00.000Z",
          })) }),
        }));
      }
      for (const pub of pubs) {
        if (source === "diary") {
          await diaryStore().create({
            ownerUserId: mate.userId!, venueId: pub.id, venueName: pub.name,
            visitedOn: "2026-09-01", rating: null, review: "", visibility: "private",
          });
        }
        if (source === "anonymous") {
          addPintDrop(drop(`anon-${pub.id}`, "finisher", "2026-09-01T19:00:00.000Z", {
            venueId: pub.id, visibility: "anonymous",
          }));
        }
      }
      const own = await pointsReader.readPointsBreakdown(mate);
      expect(own.status).toBe("ready");
      expect(own.challenges.find(({ id }) => id === "red-lion")).toMatchObject({ done: 2, total: 2, finished: true });
      expect(own.lines.find(({ key }) => key === "challenge")).toMatchObject({ count: 1, points: 500 });
      const answer = await ask();
      expect(answer.status).toBe(200);
      expect(answer.items).toEqual([]);
    },
  );

  it("does not complete a shared challenge with one private target", async () => {
    const mate = seed("finisher");
    await mutual("finisher");
    const pubs = challengePubs();
    addPintDrop(drop("public-lion", "finisher", "2026-09-01T19:00:00.000Z", { venueId: pubs[0]!.id }));
    await diaryStore().create({
      ownerUserId: mate.userId!, venueId: pubs[1]!.id, venueName: pubs[1]!.name,
      visitedOn: "2026-09-02", rating: null, review: "", visibility: "private",
    });
    const answer = await ask();
    expect(answer.status).toBe(200);
    expect(answer.items.map((item) => item.id)).toEqual(["public-lion"]);
  });

  it("folds visible sightings on former venue ids before dating a finish", async () => {
    seed("finisher");
    await mutual("finisher");
    const pubs = challengePubs();
    const aliases = await venueAliases.loadVenueAliasResolver();
    vi.spyOn(venueAliases, "loadVenueAliasResolver").mockResolvedValue({
      ...aliases,
      status: "ready",
      canonical: (id) => id === "former-lion" ? pubs[0]!.id : id,
    });
    addPintDrop(drop("former-pint", "finisher", "2026-09-01T19:00:00.000Z", { venueId: "former-lion" }));
    addPintDrop(drop("last-pint", "finisher", "2026-09-02T19:00:00.000Z", { venueId: pubs[1]!.id }));
    const answer = await ask();
    expect(answer.status).toBe(200);
    expect(answer.items.find((item) => item.kind === "challenge_finished")).toMatchObject({
      challengeId: "red-lion", loggedAt: "2026-09-02T19:00:00.000Z",
    });
  });

  it.each(["private", "muted", "blocked", "blocked-by-mate", "unavailable", "aliases", "undated"])(
    "omits a challenge finish when the mate or history is %s",
    async (reason) => {
      const mate = seed("finisher");
      await mutual("finisher");
      const pubs = challengePubs();
      for (const pub of pubs) {
        addPintDrop(drop(`pint-${pub.id}`, "finisher", reason === "undated" ? "" : "2026-09-01T19:00:00.000Z", {
          venueId: pub.id,
        }));
      }
      if (reason === "private") await profileStore().update("finisher", { visibility: "private" });
      if (reason === "muted") setSocialMemoryMute(me.id, mate.id, true);
      if (reason === "blocked") setSocialMemoryBlock(me.id, mate.id, true);
      if (reason === "blocked-by-mate") setSocialMemoryBlock(mate.id, me.id, true);
      if (reason === "unavailable") vi.mocked(venueIndex.readCityVenueIndex).mockResolvedValue(null);
      if (reason === "aliases") {
        const aliases = await venueAliases.loadVenueAliasResolver();
        vi.spyOn(venueAliases, "loadVenueAliasResolver").mockResolvedValue({ ...aliases, status: "unavailable" });
      }
      const answer = await ask();
      expect(answer.status).toBe(200);
      expect(answer.items.filter((item) => item.kind === "challenge_finished")).toEqual([]);
    },
  );

  it("rejects an unknown challenge in the activity response", () => {
    expect(parseMatesActivity({ items: [{ kind: "challenge_finished", id: "finish", handle: "mate",
      challengeId: "invented", loggedAt: "2026-09-01T19:00:00.000Z" }] })).toBeNull();
  });
});
