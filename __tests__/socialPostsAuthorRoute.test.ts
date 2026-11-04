import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A person's posts on their own profile (launch review 2026-10-30, item 9),
// and the Across-town tag filter. The real in-memory stores carry the posts,
// the follows and the blocks; only Social access is set by hand, because it is
// the verified viewer the read is about.
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

type Viewer = { accountId: string; profileId: string; handle: string };
const access = vi.hoisted(() => ({ viewer: null as Viewer | null }));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => access.viewer
    ? { ok: true, actor: access.viewer }
    : { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." },
}));

import { GET } from "@/app/api/social/posts/route";
import { followStore } from "@/lib/followStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __seedMemoryOwnedProfile, type ProfileRecord } from "@/lib/profileStore";
import { setSocialMemoryBlock } from "@/lib/socialBlockMemory";
import { socialPostStore } from "@/lib/socialPostStore";
import { validateSocialPostCreate, type SocialPostDTO } from "@/lib/socialPosts";

const people: Record<string, ProfileRecord> = {};

function actor(handle: string): Viewer {
  const profile = people[handle];
  if (!profile) throw new Error(`no ${handle}`);
  return { accountId: `user-${handle}`, profileId: profile.id, handle: profile.handle };
}

function fields(overrides: Record<string, unknown>) {
  const result = validateSocialPostCreate({
    kind: "standard",
    visibility: "public",
    body: "A post",
    area: null,
    hashtags: [],
    commentPolicy: "open",
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function read(query: string): Promise<{ status: number; body: { posts?: SocialPostDTO[]; nextCursor?: string | null; status?: string; code?: string } }> {
  const res = await GET(new Request(`http://localhost/api/social/posts?${query}`));
  return { status: res.status, body: await res.json() };
}

async function authorBodies(viewer: string | null, author = "ownerpa"): Promise<string[]> {
  access.viewer = viewer ? actor(viewer) : null;
  const { status, body } = await read(`author=${author}`);
  expect(status).toBe(200);
  return (body.posts ?? []).map((post) => post.body).sort();
}

beforeAll(async () => {
  for (const handle of ["ownerpa", "mutualpa", "strangerpa", "blockedpa", "taggerpa"]) {
    people[handle] = __seedMemoryOwnedProfile(handle, `user-${handle}`);
  }
  await followStore().follow("ownerpa", "mutualpa");
  await followStore().follow("mutualpa", "ownerpa");
  // A one-way follow is not a mutual.
  await followStore().follow("strangerpa", "ownerpa");
  setSocialMemoryBlock(actor("ownerpa").profileId, actor("blockedpa").profileId, true);

  const store = socialPostStore();
  const owner = actor("ownerpa");
  await store.create(owner, fields({ body: "public one" }));
  await store.create(owner, fields({ body: "friends one", visibility: "friends" }));
  await store.create(owner, fields({ body: "private one", visibility: "private" }));
  await store.create(owner, fields({ body: "hidden name one", nameHidden: true }), {
    idempotencyKey: "hidden-name-key-1234",
  });
  await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

  const tagger = actor("taggerpa");
  await store.create(tagger, fields({ body: "camden pint", hashtags: ["Camden"] }));
  await store.create(tagger, fields({ body: "soho pint", hashtags: ["soho"] }));
  await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
  // Still in review: the owner sees it, nobody else does.
  await store.create(owner, fields({ body: "pending one" }));
});

beforeEach(() => {
  __resetPintDrops();
  access.viewer = null;
});

describe("GET /api/social/posts?author= : the visibility matrix", () => {
  it("refuses a signed-out reader the same way the lanes do", async () => {
    access.viewer = null;
    const { status, body } = await read("author=ownerpa");
    expect(status).toBe(401);
    expect(body.code).toBe("SOCIAL_SIGN_IN_REQUIRED");
  });

  it("shows a non-mutual reader the public posts only", async () => {
    expect(await authorBodies("strangerpa")).toEqual(["public one"]);
  });

  it("shows a mutual follow the friends posts too", async () => {
    expect(await authorBodies("mutualpa")).toEqual(["friends one", "public one"]);
  });

  it("shows the owner everything, private, hidden-name and in-review included", async () => {
    expect(await authorBodies("ownerpa")).toEqual([
      "friends one",
      "hidden name one",
      "pending one",
      "private one",
      "public one",
    ]);
  });

  it("never lists a hidden-name post under the author's name to anybody else", async () => {
    for (const viewer of ["mutualpa", "strangerpa"]) {
      expect(await authorBodies(viewer)).not.toContain("hidden name one");
    }
  });

  it("reads as empty across a block, in either direction", async () => {
    expect(await authorBodies("blockedpa")).toEqual([]);
    access.viewer = actor("ownerpa");
    expect(await authorBodies("ownerpa", "blockedpa")).toEqual([]);
  });

  it("pages the same way as the feed", async () => {
    access.viewer = actor("ownerpa");
    const first = await read("author=ownerpa&limit=2");
    expect(first.body.posts).toHaveLength(2);
    expect(typeof first.body.nextCursor).toBe("string");
    const seen = new Set((first.body.posts ?? []).map((post) => post.id));
    let cursor = first.body.nextCursor;
    while (cursor) {
      const next = await read(`author=ownerpa&limit=2&cursor=${encodeURIComponent(cursor)}`);
      expect(next.status).toBe(200);
      for (const post of next.body.posts ?? []) {
        expect(seen.has(post.id)).toBe(false);
        seen.add(post.id);
      }
      cursor = next.body.nextCursor;
    }
    expect(seen.size).toBe(5);
  });

  it("answers 404 for a handle nobody holds", async () => {
    access.viewer = actor("strangerpa");
    expect((await read("author=nobodyhere")).status).toBe(404);
  });
});

describe("GET /api/social/posts?lane=discover&tag= : the tag filter", () => {
  it("narrows Across town to one tag, case-insensitively and with or without #", async () => {
    access.viewer = actor("strangerpa");
    for (const raw of ["camden", "CAMDEN", "%23Camden"]) {
      const { status, body } = await read(`lane=discover&tag=${raw}`);
      expect(status).toBe(200);
      const bodies = (body.posts ?? []).map((post) => post.body);
      expect(bodies).toContain("camden pint");
      expect(bodies).not.toContain("soho pint");
      expect(bodies).not.toContain("public one");
    }
  });

  it("refuses a tag that is not one, and a tag on another lane", async () => {
    access.viewer = actor("strangerpa");
    expect((await read("lane=discover&tag=no%20spaces")).status).toBe(400);
    expect((await read("lane=following&tag=camden")).status).toBe(400);
  });
});
