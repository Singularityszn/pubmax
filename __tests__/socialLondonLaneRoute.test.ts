// THE LONDON LANE, READ SIGNED OUT (captain decision 7, 1 Nov 2026; closes D2).
//
// `GET /api/social/posts?lane=london` against the REAL keyless stores: the
// memory post store, the memory profile store (account visibility) and the
// memory withdrawal seam. Only the edges are stubbed: the limiter (to read its
// key), the consent store (its reads need Supabase) and the verified-access
// seam (to prove the lane never asks it).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const state = vi.hoisted(() => ({
  limitKeys: [] as string[],
  limited: false,
  accessCalls: 0,
  tagViewers: [] as unknown[],
  tags: new Map<string, Array<{ handle: string }>>(),
}));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: async (key: string) => {
    state.limitKeys.push(key);
    return state.limited;
  },
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => {
    state.accessCalls += 1;
    return { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." };
  },
}));

vi.mock("@/lib/socialPostConsentStore", () => ({
  socialPostConsentStore: {
    approvedTags: async (viewer: unknown) => {
      state.tagViewers.push(viewer);
      return state.tags;
    },
  },
}));

import { GET } from "@/app/api/social/posts/route";
import { __setMemoryProfileWithdrawn } from "@/lib/accountPublicAccess.server";
import { profileStore } from "@/lib/profileStore";
import { hashIp } from "@/lib/supabase";
import { SOCIAL_LONDON_LANE_COPY, type SocialLondonLanePost } from "@/lib/socialLondonLane";
import { socialPostStore, type SocialPostActor } from "@/lib/socialPostStore";
import type { SocialPostFields } from "@/lib/socialPosts";

const LANE_FIELDS = [
  "area", "author", "body", "createdAt", "editedAt", "hashtags", "id", "kind", "nameHidden", "photo", "visibility",
].sort();

const posts: Record<string, string> = {};

async function actorFor(handle: string, visibility: "public" | "private" = "public"): Promise<SocialPostActor> {
  const profile = await profileStore().ensure(handle);
  if (visibility === "private") await profileStore().update(handle, { visibility: "private" });
  return { accountId: `account-${handle}`, profileId: profile.id, handle: profile.handle };
}

function fields(overrides: Partial<SocialPostFields>): SocialPostFields {
  return {
    kind: "standard",
    visibility: "public",
    body: "A pint",
    area: "camden",
    venueId: null,
    hashtags: [],
    commentPolicy: "open",
    photo: null,
    nameHidden: false,
    ...overrides,
  };
}

async function post(name: string, actor: SocialPostActor, overrides: Partial<SocialPostFields>, media = false): Promise<void> {
  const created = await socialPostStore().create(actor, fields({ body: name, ...overrides }), media
    ? { media: { mediaId: "media-lamb", objectKey: "social/media-lamb/1/image.jpg", sha256: "a".repeat(64), width: 640, height: 480, byteSize: 10 } }
    : {});
  posts[name] = created.id;
}

beforeAll(async () => {
  const pub = await actorFor("lane_pub");
  const shy = await actorFor("lane_shy", "private");
  const gone = await actorFor("lane_gone");
  const ghost: SocialPostActor = { accountId: "account-ghost", profileId: "no-such-profile", handle: "lane_ghost" };

  await post("london public", pub, { hashtags: ["roast"] });
  await post("london photo at the lamb", pub, {
    venueId: "venue-lamb",
    photo: { mediaId: "media-lamb", altText: "A pint on the bar" },
  }, true);
  await post("london hidden name", pub, { nameHidden: true });
  await post("manchester public", pub, { area: "manchester-city-centre" });
  await post("no area public", pub, { area: null });
  await post("london mutuals only", pub, { visibility: "friends" });
  await post("london only me", pub, { visibility: "private" });
  await post("london held for review", pub, {});
  await post("london removed", pub, {});
  await post("london private account", shy, {});
  await post("london withdrawn author", gone, {});
  await post("london withdrawn hidden name", gone, { nameHidden: true });
  await post("london no profile row", ghost, {});

  await socialPostStore().processModerationQueue({
    moderate: async ({ text }) => ({ decision: text.includes("held") ? "needs_review" : "approved" }),
  }, 50);
  await socialPostStore().remove(posts["london removed"]!, pub, 0, "remove-london-removed");
  // Never moderated: still pending when the lane is read.
  await post("london pending", pub, {});

  __setMemoryProfileWithdrawn(gone.profileId, true);
});

beforeEach(() => {
  state.limitKeys = [];
  state.limited = false;
  state.accessCalls = 0;
  state.tagViewers = [];
  state.tags = new Map([[posts["london photo at the lamb"]!, [{ handle: "bob" }]]]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function lane(query = "", headers: HeadersInit = { "x-forwarded-for": "203.0.113.7" }): Promise<Response> {
  return GET(new Request(`http://localhost/api/social/posts?lane=london${query}`, { headers }));
}

async function lanePosts(query = ""): Promise<SocialLondonLanePost[]> {
  const response = await lane(query);
  expect(response.status).toBe(200);
  return (await response.json()).posts as SocialLondonLanePost[];
}

describe("GET /api/social/posts?lane=london (signed out)", () => {
  it("returns public, moderated, London posts from public accounts only", async () => {
    const bodies = (await lanePosts()).map((item) => item.body).sort();
    expect(bodies).toEqual(["london hidden name", "london photo at the lamb", "london public"]);
  });

  it("never returns a private account, a mutuals or private post, a held, pending or removed post, or a withdrawn author", async () => {
    const bodies = (await lanePosts()).map((item) => item.body);
    for (const excluded of [
      "london private account",
      "london no profile row",
      "london mutuals only",
      "london only me",
      "london held for review",
      "london pending",
      "london removed",
      "london withdrawn author",
      "london withdrawn hidden name",
      "manchester public",
      "no area public",
    ]) {
      expect(bodies, excluded).not.toContain(excluded);
    }
  });

  it("carries only the allow-listed fields, with no viewer field, no pub, no score and no face", async () => {
    const response = await lane();
    const raw = JSON.stringify(await response.clone().json());
    for (const withheld of ["ownedByViewer", "mutationVersion", "revision", "venueId", "venueName", "venueProjected", "review", "avatarUrl", "commentPolicy", "moderationState", "venue-lamb", "lane_shy", "account-"]) {
      expect(raw, withheld).not.toContain(withheld);
    }
    for (const item of (await response.json()).posts as SocialLondonLanePost[]) {
      expect(Object.keys(item).sort()).toEqual(LANE_FIELDS);
      expect(Object.keys(item.author)).toEqual(["handle"]);
      expect(item.visibility).toBe("public");
    }
  });

  it("names nobody behind a hidden-name post", async () => {
    const hidden = (await lanePosts()).find((item) => item.body === "london hidden name");
    expect(hidden).toMatchObject({ nameHidden: true, author: { handle: null } });
    const named = (await lanePosts()).find((item) => item.body === "london public");
    expect(named).toMatchObject({ nameHidden: false, author: { handle: "lane_pub" } });
  });

  it("carries photo tags only as the consent store reads them for nobody", async () => {
    const photo = (await lanePosts()).find((item) => item.body === "london photo at the lamb");
    expect(photo?.photo).toEqual({ mediaId: "media-lamb", altText: "A pint on the bar", tags: [{ handle: "bob" }] });
    expect(state.tagViewers).toEqual([null]);
  });

  it("answers every caller the same and never asks who they are", async () => {
    const stranger = await (await lane()).json();
    const withBearer = await (await lane("", {
      authorization: "Bearer someone-signed-in",
      cookie: "pubmax_resume=whatever",
      "x-forwarded-for": "203.0.113.7",
    })).json();
    expect(withBearer).toEqual(stranger);
    expect(state.accessCalls).toBe(0);
  });

  it("answers no-store, in pages, with a cursor only this lane accepts", async () => {
    const first = await lane("&limit=2");
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    const page = await first.json();
    expect(page.posts).toHaveLength(2);
    expect(typeof page.nextCursor).toBe("string");
    const second = await (await lane(`&limit=2&cursor=${encodeURIComponent(page.nextCursor)}`)).json();
    expect(second.posts).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = [...page.posts, ...second.posts].map((item: SocialLondonLanePost) => item.id);
    expect(new Set(seen).size).toBe(3);

    const forged = await lane(`&cursor=${encodeURIComponent(`${page.nextCursor}x`)}`);
    expect(forged.status).toBe(400);
    await expect(forged.json()).resolves.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("refuses a signed-in lane's filters and a bad size in the error envelope", async () => {
    for (const query of ["&area=camden", "&tag=roast", "&author=lane_pub"]) {
      const response = await lane(query);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({ code: "INVALID_LANE", error: "Choose a Social feed.", retryable: false });
    }
    const tooMany = await lane("&limit=51");
    expect(tooMany.status).toBe(400);
    expect(tooMany.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(tooMany.json()).resolves.toMatchObject({ code: "INVALID_LIMIT" });
  });

  it("rate-limits per hashed IP before the store is read", async () => {
    await lane();
    expect(state.limitKeys).toEqual([`social-london-lane:${hashIp("203.0.113.7")}`]);
    expect(state.limitKeys[0]).not.toContain("203.0.113.7");

    state.tagViewers = [];
    state.limited = true;
    const response = await lane();
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      code: "RATE_LIMITED",
      error: "Too many Social feed requests. Slow down.",
      retryable: true,
    });
    expect(state.tagViewers).toEqual([]);
  });

  it.each([
    ["the launch rollback", "PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0"],
    ["the freeze", "PUBMAX_SOCIAL_FREEZE", "social"],
  ])("pauses under %s, before the limiter or the store", async (_label, name, value) => {
    vi.stubEnv(name, value);
    const response = await lane();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      code: "SOCIAL_LANE_PAUSED",
      error: SOCIAL_LONDON_LANE_COPY.paused,
      retryable: true,
    });
    expect(state.limitKeys).toEqual([]);
    expect(state.tagViewers).toEqual([]);
  });

  it("keeps every other lane behind verified Social access", async () => {
    const response = await GET(new Request("http://localhost/api/social/posts?lane=discover"));
    expect(response.status).toBe(401);
    expect(state.accessCalls).toBe(1);
    expect(state.limitKeys).toEqual([]);
  });
});
