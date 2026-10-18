// Hidden-name Social posts. A reader sees "a PUBMAXXER" and nothing that leads
// to the author; the author, a moderator and the store still know who it is.
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  error: null as { code?: string; message: string } | null,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    requireSupabaseAdmin: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        supabase.calls.push({ name, args });
        if (supabase.error) return { data: null, error: supabase.error };
        return {
          data: [{
            id: "22222222-2222-4222-8222-222222222222",
            author_profile_id: "profile-a",
            author_handle: "alice",
            kind: "standard",
            visibility: "public",
            status: "visible",
            body: "Hidden words",
            area_slug: "camden",
            venue_id: null,
            hashtags: [],
            comment_policy: "open",
            moderation_state: "pending",
            revision: 0,
            created_at: "2026-10-18T12:00:00.000Z",
            updated_at: "2026-10-18T12:00:00.000Z",
            author_name_hidden: true,
          }],
          error: null,
        };
      },
    }),
  };
});

import {
  HIDDEN_NAME_AUTHOR_LABEL,
  HIDDEN_NAME_NO_PUB_MESSAGE,
  HIDDEN_NAME_PUBLIC_ONLY_MESSAGE,
  hiddenNamePostRefusal,
} from "@/lib/socialHiddenName";
import { parseSocialCreateSubmission } from "@/lib/socialPostSubmission";
import { socialPostRequestDigest } from "@/lib/socialPostIdempotency.server";
import {
  createMemorySocialPostStore,
  supabaseSocialPostStore,
  type SocialPostActor,
} from "@/lib/socialPostStore";
import { socialPostDTO, validateSocialPostCreate, type SocialPost } from "@/lib/socialPosts";

const alice: SocialPostActor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const bob: SocialPostActor = { accountId: "account-b", profileId: "profile-b", handle: "bob" };

function fields(overrides: Record<string, unknown> = {}) {
  const result = validateSocialPostCreate({
    kind: "standard",
    visibility: "public",
    body: "Hidden words",
    area: "camden",
    hashtags: [],
    commentPolicy: "open",
    nameHidden: true,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function storedPost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-1",
    authorProfileId: alice.profileId,
    authorHandle: alice.handle,
    kind: "standard",
    visibility: "public",
    body: "Hidden words",
    area: "camden",
    venueId: null,
    hashtags: [],
    commentPolicy: "open",
    photo: null,
    nameHidden: true,
    status: "visible",
    moderationState: "approved",
    featureRequest: null,
    revision: 0,
    mutationVersion: 0,
    editedAt: null,
    moderatedAt: null,
    createdAt: "2026-10-18T12:00:00.000Z",
    updatedAt: "2026-10-18T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  supabase.calls = [];
  supabase.error = null;
});

describe("the hidden-name shape rule", () => {
  it("says the reader-facing label in the house word for an unnamed contributor", () => {
    expect(HIDDEN_NAME_AUTHOR_LABEL).toBe("a PUBMAXXER");
  });

  it("asks nothing of a named post", () => {
    expect(hiddenNamePostRefusal({ nameHidden: false, visibility: "friends", venueId: "venue-1" })).toBeNull();
  });

  it("holds a hidden-name post to public and no pub", () => {
    expect(hiddenNamePostRefusal({ nameHidden: true, visibility: "public", venueId: null })).toBeNull();
    expect(hiddenNamePostRefusal({ nameHidden: true, visibility: "friends", venueId: null }))
      .toBe(HIDDEN_NAME_PUBLIC_ONLY_MESSAGE);
    expect(hiddenNamePostRefusal({ nameHidden: true, visibility: "private", venueId: null }))
      .toBe(HIDDEN_NAME_PUBLIC_ONLY_MESSAGE);
    expect(hiddenNamePostRefusal({ nameHidden: true, visibility: "public", venueId: "venue-1" }))
      .toBe(HIDDEN_NAME_NO_PUB_MESSAGE);
  });
});

describe("creating a hidden-name post", () => {
  it("defaults to a named post and reads the flag only as a boolean", () => {
    const named = validateSocialPostCreate({ kind: "standard", visibility: "friends", body: "x", commentPolicy: "open" });
    expect(named).toMatchObject({ ok: true, value: { nameHidden: false } });
    expect(validateSocialPostCreate({ kind: "standard", visibility: "public", body: "x", commentPolicy: "open", nameHidden: "yes" }))
      .toMatchObject({ ok: false });
  });

  it("refuses a friends-only or pub-naming hidden-name post at the boundary", () => {
    expect(validateSocialPostCreate({ kind: "standard", visibility: "friends", body: "x", commentPolicy: "open", nameHidden: true }))
      .toEqual({ ok: false, code: "INVALID_POST", error: HIDDEN_NAME_PUBLIC_ONLY_MESSAGE });
    expect(validateSocialPostCreate({ kind: "standard", visibility: "public", body: "x", venueId: "venue-1", commentPolicy: "open", nameHidden: true }))
      .toEqual({ ok: false, code: "INVALID_POST", error: HIDDEN_NAME_NO_PUB_MESSAGE });
  });

  it("refuses photo tags, because a tag shows the tagged person the author", () => {
    const submission = parseSocialCreateSubmission({
      kind: "standard", visibility: "public", body: "x", commentPolicy: "open",
      nameHidden: true, photoAltText: "A pint", tagHandles: ["bob"],
    }, true);
    expect(submission).toMatchObject({ ok: false, code: "INVALID_TAGS" });
  });

  it("refuses a pub score, which needs a named pub", () => {
    const submission = parseSocialCreateSubmission({
      kind: "standard", visibility: "public", body: "x", commentPolicy: "open",
      nameHidden: true, reviewRating: 4,
    }, false);
    expect(submission).toMatchObject({ ok: false });
  });
});

describe("what a reader receives", () => {
  it("takes the handle off for everybody but the author", () => {
    const post = storedPost();
    expect(socialPostDTO(post, { exactVenue: false, viewerProfileId: bob.profileId })).toMatchObject({
      author: { handle: null },
      nameHidden: true,
      ownedByViewer: false,
    });
    expect(socialPostDTO(post, { exactVenue: false })).toMatchObject({ author: { handle: null } });
    expect(socialPostDTO(post, { exactVenue: true, viewerProfileId: alice.profileId })).toMatchObject({
      author: { handle: "alice" },
      nameHidden: true,
      ownedByViewer: true,
    });
  });

  it("never serialises the handle anywhere in a reader's copy", () => {
    const json = JSON.stringify(socialPostDTO(storedPost(), { exactVenue: false, viewerProfileId: bob.profileId }));
    expect(json).not.toContain("alice");
    expect(json).not.toContain("profile-a");
  });

  it("leaves a named post exactly as it was", () => {
    expect(socialPostDTO(storedPost({ nameHidden: false }), { exactVenue: false, viewerProfileId: bob.profileId }))
      .toMatchObject({ author: { handle: "alice" }, nameHidden: false });
  });
});

describe("hidden-name posts in the memory store", () => {
  function storeWhereBobFollowsAlice() {
    return createMemorySocialPostStore({
      relationships: async (viewer) => viewer.profileId === bob.profileId
        ? { followingProfileIds: new Set([alice.profileId]), mutualProfileIds: new Set([alice.profileId]) }
        : { followingProfileIds: new Set(), mutualProfileIds: new Set() },
    });
  }

  it("shows the post to the town with no name and keeps it out of Following", async () => {
    const store = storeWhereBobFollowsAlice();
    const hidden = await store.create(alice, fields());
    await store.create(alice, fields({ body: "Named words", nameHidden: false }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    const following = await store.feed(bob, { lane: "following" });
    expect(following.posts.map((post) => post.body)).toEqual(["Named words"]);

    const discover = await store.feed(bob, { lane: "discover" });
    const seen = discover.posts.find((post) => post.id === hidden.id);
    expect(seen).toMatchObject({ author: { handle: null }, nameHidden: true });

    const nearby = await store.feed(bob, { lane: "nearby", area: "camden" });
    expect(nearby.posts.find((post) => post.id === hidden.id)?.author.handle).toBeNull();

    await expect(store.read(hidden.id, bob)).resolves.toMatchObject({ author: { handle: null } });
    await expect(store.read(hidden.id, alice)).resolves.toMatchObject({ author: { handle: "alice" } });
  });

  it("returns the author's own handle on create, so the composer can say whose post it is", async () => {
    const store = storeWhereBobFollowsAlice();
    await expect(store.create(alice, fields())).resolves.toMatchObject({
      author: { handle: "alice" },
      ownedByViewer: true,
      nameHidden: true,
    });
  });

  it("refuses tags on create and keeps the post public with no pub on edit", async () => {
    const store = storeWhereBobFollowsAlice();
    await expect(store.create(alice, fields(), { tagHandles: ["bob"] }))
      .rejects.toMatchObject({ code: "INVALID_POST" });
    const post = await store.create(alice, fields());
    await expect(store.edit(post.id, alice, 0, { visibility: "friends" }, false))
      .rejects.toMatchObject({ code: "INVALID_POST", message: HIDDEN_NAME_PUBLIC_ONLY_MESSAGE });
    await expect(store.edit(post.id, alice, 0, { venueId: "venue-1" }, false))
      .rejects.toMatchObject({ code: "INVALID_POST", message: HIDDEN_NAME_NO_PUB_MESSAGE });
    const edited = await store.edit(post.id, alice, 0, { body: "Changed words" }, true);
    expect(edited).toMatchObject({ body: "Changed words", nameHidden: true });
  });

  it("cannot be switched on or off by an edit", async () => {
    const store = storeWhereBobFollowsAlice();
    const named = await store.create(alice, fields({ nameHidden: false, visibility: "friends" }));
    const edited = await store.edit(
      named.id, alice, 0,
      { body: "Changed", nameHidden: true } as Parameters<typeof store.edit>[3],
      true,
    );
    expect(edited.nameHidden).toBe(false);
  });
});

describe("hidden-name posts in the durable store", () => {
  it("creates through the 0191 door, which stamps the flag in the same transaction", async () => {
    const post = await supabaseSocialPostStore.create(alice, fields(), {
      idempotencyKey: "hidden-key-0000000001",
      requestDigest: "a".repeat(64),
    });
    expect(supabase.calls.map((call) => call.name)).toEqual(["create_social_post_hidden_name"]);
    expect(supabase.calls[0]?.args).toMatchObject({ p_visibility: "public", p_venue_id: null, p_tag_handles: [] });
    expect(post).toMatchObject({ nameHidden: true, author: { handle: "alice" }, ownedByViewer: true });
  });

  it("refuses rather than publishing under a name when 0191 is not applied", async () => {
    supabase.error = { code: "PGRST202", message: "Could not find the function public.create_social_post_hidden_name" };
    await expect(supabaseSocialPostStore.create(alice, fields(), {
      idempotencyKey: "hidden-key-0000000002",
      requestDigest: "a".repeat(64),
    })).rejects.toMatchObject({ code: "HIDDEN_NAME_UNAVAILABLE" });
    expect(supabase.calls.map((call) => call.name)).toEqual(["create_social_post_hidden_name"]);
  });

  it("will not create a hidden-name post without a request key", async () => {
    await expect(supabaseSocialPostStore.create(alice, fields()))
      .rejects.toMatchObject({ code: "INVALID_POST" });
    expect(supabase.calls).toEqual([]);
  });

  it("sends a named post through the same door as before", async () => {
    await supabaseSocialPostStore.create(alice, fields({ nameHidden: false }), {
      idempotencyKey: "named-key-00000000001",
      requestDigest: "a".repeat(64),
    }).catch(() => undefined);
    expect(supabase.calls.map((call) => call.name)).toEqual(["create_social_post_idempotent"]);
  });
});

describe("the request key digest", () => {
  it("digests a named post exactly as it did before the flag existed", () => {
    const named = fields({ nameHidden: false });
    const before: Partial<typeof named> = { ...named };
    delete before.nameHidden;
    const legacy = createHash("sha256")
      .update(JSON.stringify({ fields: before, mediaSha256: null, tags: [] }))
      .digest("hex");
    expect(socialPostRequestDigest(named, null, [])).toBe(legacy);
  });

  it("gives the same words a different digest once the name is hidden", () => {
    expect(socialPostRequestDigest(fields(), null, []))
      .not.toBe(socialPostRequestDigest(fields({ nameHidden: false }), null, []));
  });
});
