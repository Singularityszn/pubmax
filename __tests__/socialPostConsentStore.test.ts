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
      created_at: "2026-08-05T12:00:00.000Z",
    }]);
    state.rows.set("read_social_post_outbox", []);
    state.rows.set("read_social_post_moderation_queue", []);
    state.rows.set("moderate_social_post", true);

    await store.actOnTag(viewer, "proposal-a", "approve");
    await expect(store.tagInbox(viewer, 20)).resolves.toEqual([{
      id: "proposal-a",
      postId: "post-a",
      authorHandle: "bob",
      state: "proposed",
      createdAt: "2026-08-05T12:00:00.000Z",
    }]);
    await store.outbox(viewer, 20);
    await store.heldQueue(viewer, 20);
    await store.moderateHeld(viewer, "post-a", "media-a", "approve");

    expect(state.calls.map((call) => call.input.p_actor ?? call.input.p_owner ?? call.input.p_viewer))
      .toEqual(["profile-a", "profile-a", "profile-a", "profile-a", "profile-a"]);
  });
});
