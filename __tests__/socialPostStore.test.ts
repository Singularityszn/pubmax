import { describe, expect, it } from "vitest";

import {
  createMemorySocialPostStore,
  socialPostStore,
  supabaseSocialPostStore,
  type SocialPostActor,
} from "@/lib/socialPostStore";
import { validateSocialPostCreate } from "@/lib/socialPosts";

const alice: SocialPostActor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const bob: SocialPostActor = { accountId: "account-b", profileId: "profile-b", handle: "bob" };
const carol: SocialPostActor = { accountId: "account-c", profileId: "profile-c", handle: "carol" };

function fields(overrides: Record<string, unknown> = {}) {
  const result = validateSocialPostCreate({
    kind: "standard",
    visibility: "public",
    body: "A post",
    area: "camden",
    hashtags: [],
    commentPolicy: "open",
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("Social post store visibility and feeds", () => {
  it("holds durable submissions until deterministic moderation approves them", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields());

    expect(post.moderationState).toBe("pending");
    await expect(store.read(post.id, bob)).resolves.toBeNull();
    expect(await store.processModerationQueue({
      moderate: async () => ({ decision: "approved" }),
    })).toEqual({ processed: 1, approved: 1, needsReview: 0, retried: 0 });
    await expect(store.read(post.id, bob)).resolves.toMatchObject({
      id: post.id,
      author: { handle: "alice" },
    });
  });

  it("keeps moderation outages queued and never treats them as clean", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields());

    expect(await store.processModerationQueue({
      moderate: async () => { throw new Error("offline"); },
    })).toEqual({ processed: 1, approved: 0, needsReview: 0, retried: 1 });
    await expect(store.read(post.id, bob)).resolves.toBeNull();
  });

  it("keeps non-retryable provider failures held without a hot retry loop", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields());
    const error = Object.assign(new Error("bad credentials"), { retryable: false });
    expect(await store.processModerationQueue({
      moderate: async () => { throw error; },
    })).toEqual({ processed: 1, approved: 0, needsReview: 0, retried: 0 });
    await expect(store.read(post.id, bob)).resolves.toBeNull();
    expect(await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) }))
      .toEqual({ processed: 0, approved: 0, needsReview: 0, retried: 0 });
  });

  it("applies public, mutual-friend, private, hidden, and removed gates on direct reads", async () => {
    const store = createMemorySocialPostStore({
      relationships: async (viewer) => viewer.profileId === bob.profileId
        ? { followingProfileIds: new Set([alice.profileId]), mutualProfileIds: new Set([alice.profileId]) }
        : { followingProfileIds: new Set(), mutualProfileIds: new Set() },
    });
    const friendPost = await store.create(alice, fields({ visibility: "friends", venueId: "venue-1" }));
    const privatePost = await store.create(alice, fields({ visibility: "private" }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    await expect(store.read(friendPost.id, bob)).resolves.toMatchObject({ venueId: "venue-1" });
    await expect(store.read(friendPost.id, carol)).resolves.toBeNull();
    await expect(store.read(privatePost.id, bob)).resolves.toBeNull();
    await expect(store.read(privatePost.id, alice)).resolves.not.toBeNull();
    await store.remove(friendPost.id, alice);
    await expect(store.read(friendPost.id, alice)).resolves.toBeNull();
  });

  it("returns discover, nearby, and following lanes newest-first with scoped cursors", async () => {
    let tick = Date.parse("2026-08-05T18:00:00.000Z");
    const store = createMemorySocialPostStore({
      now: () => new Date(tick += 1_000),
      relationships: async (viewer) => viewer.profileId === bob.profileId
        ? { followingProfileIds: new Set([alice.profileId]), mutualProfileIds: new Set([alice.profileId]) }
        : { followingProfileIds: new Set(), mutualProfileIds: new Set() },
    });
    await store.create(alice, fields({ body: "older public", area: "camden" }));
    await store.create(alice, fields({ body: "newer friends", visibility: "friends", area: "camden" }));
    await store.create(carol, fields({ body: "newest public", area: "shoreditch" }));
    await store.create(bob, fields({ body: "viewer's private", visibility: "private", area: "camden" }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    const discover = await store.feed(bob, { lane: "discover", limit: 1 });
    expect(discover.posts.map((post) => post.body)).toEqual(["newest public"]);
    expect(discover.nextCursor).toEqual(expect.any(String));
    const cursorParts = discover.nextCursor!.split(".");
    expect(cursorParts).toHaveLength(2);
    expect(JSON.parse(Buffer.from(cursorParts[0], "base64url").toString("utf8")))
      .not.toHaveProperty("viewer");
    const page2 = await store.feed(bob, { lane: "discover", limit: 1, cursor: discover.nextCursor });
    expect(page2.posts.map((post) => post.body)).toEqual(["older public"]);
    await expect(store.feed(carol, { lane: "discover", limit: 1, cursor: discover.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });

    expect((await store.feed(bob, { lane: "nearby", area: "camden", limit: 20 })).posts
      .map((post) => post.body)).toEqual(["older public"]);
    expect((await store.feed(bob, { lane: "following", limit: 20 })).posts
      .map((post) => post.body)).toEqual(["newer friends", "older public"]);
  });

  it("requeues real edits, increments revision, and never exposes account IDs", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields());
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    const edited = await store.edit(post.id, alice, { body: "Changed" }, true);

    expect(edited).toMatchObject({ body: "Changed", revision: 1, moderationState: "pending" });
    expect(JSON.stringify(edited)).not.toContain(alice.accountId);
    await expect(store.read(post.id, bob)).resolves.toBeNull();
  });

  it("does not mark an unchanged content value as an edit", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields({ body: "Same words" }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    const unchanged = await store.edit(post.id, alice, { body: "Same words" }, true);
    expect(unchanged).toMatchObject({
      revision: 0,
      editedAt: null,
      moderationState: "approved",
    });
    await expect(store.read(post.id, bob)).resolves.not.toBeNull();
  });

  it("cannot approve a newer edit with an older in-flight moderation result", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields({ body: "First version" }));
    let release: (() => void) | undefined;
    const moderation = store.processModerationQueue({
      moderate: () => new Promise((resolve) => {
        release = () => resolve({ decision: "approved" });
      }),
    });
    while (!release) await Promise.resolve();
    await store.edit(post.id, alice, { body: "Second version" }, true);
    release();
    await moderation;

    await expect(store.read(post.id, bob)).resolves.toBeNull();
    expect(await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) }))
      .toMatchObject({ approved: 1 });
    await expect(store.read(post.id, bob)).resolves.toMatchObject({ body: "Second version" });
  });
});

describe("Social post backend selection", () => {
  it("selects the fail-closed durable store in deployed production without keys", () => {
    const previousVercel = process.env.VERCEL_ENV;
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.VERCEL_ENV = "production";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(socialPostStore()).toBe(supabaseSocialPostStore);
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previousVercel;
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    }
  });
});
