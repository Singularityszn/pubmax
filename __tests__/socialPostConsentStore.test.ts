import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  calls: [] as Array<{ name: string; input: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({
    rpc: async (name: string, input: Record<string, unknown>) => {
      state.calls.push({ name, input });
      return { data: state.rows.get(name) ?? [], error: null };
    },
  }),
}));

import { createSocialPostConsentStore } from "@/lib/socialPostConsentStore";

const viewer = { accountId: "account-a", profileId: "profile-a", handle: "alice" };

beforeEach(() => {
  state.rows = new Map();
  state.calls = [];
});

describe("Social post consent and private read store", () => {
  it("batches only approved current-handle tags by visible post", async () => {
    state.rows.set("read_social_post_tags_many", [
      { post_id: "post-a", proposal_id: "proposal-a", handle: "bob_new" },
      { post_id: "post-a", proposal_id: "proposal-b", handle: "carol" },
    ]);
    const result = await createSocialPostConsentStore().approvedTags(viewer, ["post-a", "post-b"]);

    expect(result).toEqual(new Map([
      ["post-a", [{ handle: "bob_new" }, { handle: "carol" }]],
    ]));
    expect(state.calls[0]).toEqual({
      name: "read_social_post_tags_many",
      input: { p_viewer: "profile-a", p_post_ids: ["post-a", "post-b"] },
    });
  });

  it("reauthorises each media read and exposes no object key on denial", async () => {
    const store = createSocialPostConsentStore();
    state.rows.set("read_social_post_media", [{ object_key: "social/profile-a/media-a/image.jpg" }]);
    await expect(store.mediaObjectKey(viewer, "media-a")).resolves.toBe("social/profile-a/media-a/image.jpg");
    state.rows.set("read_social_post_media", []);
    await expect(store.mediaObjectKey(viewer, "media-a")).resolves.toBeNull();
    expect(state.calls).toHaveLength(2);
  });

  it("scopes tag actions, pending outbox, and held moderation to the verified actor", async () => {
    const store = createSocialPostConsentStore();
    state.rows.set("act_social_post_tag", true);
    state.rows.set("read_social_tag_inbox", [{
      proposal_id: "proposal-a",
      post_id: "post-a",
      media_id: "media-a",
      author_handle: "bob",
      state: "proposed",
      body: "Private photo",
      visibility: "private",
      photo_alt_text: "Bob beside the bar",
      review_revision: 4,
      audience_visibility: null,
      audience_revision: null,
      audience_shown_at: null,
      created_at: "2026-08-05T12:00:00.000Z",
    }]);
    state.rows.set("read_social_post_outbox", []);
    state.rows.set("read_social_post_moderation_queue", []);
    state.rows.set("moderate_social_post", true);

    await store.actOnTag(viewer, "proposal-a", "approve", 4);
    await expect(store.tagInbox(viewer, { lane: "proposed", limit: 20 })).resolves.toEqual({
      proposals: [{
        id: "proposal-a",
        postId: "post-a",
        mediaId: "media-a",
        authorHandle: "bob",
        state: "proposed",
        body: "Private photo",
        visibility: "private",
        photoAltText: "Bob beside the bar",
        reviewRevision: 4,
        audienceAtApproval: null,
        createdAt: "2026-08-05T12:00:00.000Z",
      }],
      nextCursor: null,
    });
    await store.outbox(viewer, { limit: 20 });
    await store.heldQueue(viewer, 20);
    await store.moderateHeld(viewer, "post-a", "media-a", "approve");

    expect(state.calls.map((call) => call.input.p_actor ?? call.input.p_owner ?? call.input.p_viewer))
      .toEqual(["profile-a", "profile-a", "profile-a", "profile-a", "profile-a"]);
    expect(state.calls[0]?.input.p_expected_audience_revision).toBe(4);
    expect(state.calls[1]?.input).toMatchObject({
      p_lane: "proposed", p_before_created_at: null, p_before_id: null, p_limit: 21,
    });
  });

  it("binds consent cursors to stable viewer and lane", async () => {
    const proposal = (id: string, createdAt: string) => ({
      proposal_id: id,
      post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      author_handle: "bob",
      state: "proposed",
      body: "Private photo",
      visibility: "private",
      photo_alt_text: "Bob beside the bar",
      review_revision: 2,
      audience_visibility: null,
      audience_revision: null,
      audience_shown_at: null,
      created_at: createdAt,
    });
    state.rows.set("read_social_tag_inbox", [
      proposal("11111111-1111-4111-8111-111111111111", "2026-08-05T12:00:00.000Z"),
      proposal("22222222-2222-4222-8222-222222222222", "2026-08-05T11:00:00.000Z"),
    ]);
    const store = createSocialPostConsentStore();
    const first = await store.tagInbox(viewer, { lane: "proposed", limit: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(store.tagInbox({ ...viewer, profileId: "other-profile" }, {
      lane: "proposed", limit: 1, cursor: first.nextCursor,
    })).rejects.toThrow(/page is not valid/i);
    await expect(store.tagInbox(viewer, {
      lane: "approved", limit: 1, cursor: first.nextCursor,
    })).rejects.toThrow(/page is not valid/i);
    await expect(store.outbox(viewer, {
      limit: 1, cursor: first.nextCursor,
    })).rejects.toThrow(/page is not valid/i);
    await expect(store.tagInbox(viewer, {
      lane: "proposed", limit: 1, cursor: `${first.nextCursor}x`,
    })).rejects.toThrow(/page is not valid/i);
  });

  it("returns full stable-owned posts in the owner lane", async () => {
    state.rows.set("read_social_post_outbox", [{
      id: "33333333-3333-4333-8333-333333333333",
      author_profile_id: "profile-a",
      author_handle: "alice_renamed",
      kind: "standard",
      visibility: "private",
      status: "visible",
      body: "Owner copy",
      area_slug: null,
      venue_id: null,
      hashtags: [],
      comment_policy: "locked",
      photo_media_id: null,
      photo_alt_text: null,
      moderation_state: "approved",
      revision: 3,
      edited_at: null,
      moderated_at: "2026-08-05T12:00:00.000Z",
      created_at: "2026-08-05T11:00:00.000Z",
      updated_at: "2026-08-05T12:00:00.000Z",
    }]);
    const page = await createSocialPostConsentStore().outbox(viewer, { limit: 20 });
    expect(page).toMatchObject({
      posts: [{
        id: "33333333-3333-4333-8333-333333333333",
        author: { handle: "alice_renamed" },
        ownedByViewer: true,
        visibility: "private",
        moderationState: "approved",
      }],
      nextCursor: null,
    });
  });
});
