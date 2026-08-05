import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  completionPostIds: [] as string[],
}));

vi.mock("@/lib/supabase", () => ({
  requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => ({
    rpc: async (name: string, input: Record<string, unknown>) => {
      if (name === "claim_social_post_moderation_jobs") {
        return {
          data: [
            { post_id: "post-1", revision: 0, moderation_claim: "First", attempts: 1 },
            { post_id: "post-2", revision: 0, moderation_claim: "Second", attempts: 1 },
          ],
          error: null,
        };
      }
      if (name === "complete_social_post_moderation_job") {
        const postId = String(input.p_post_id);
        state.completionPostIds.push(postId);
        return postId === "post-1"
          ? { data: null, error: new Error("completion unavailable") }
          : { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  }),
}));

import { supabaseSocialPostStore } from "@/lib/socialPostStore";

beforeEach(() => {
  state.completionPostIds = [];
});

describe("durable Social post moderation isolation", () => {
  it("finishes unaffected leased items then fails the drain when one completion is unavailable", async () => {
    await expect(supabaseSocialPostStore.processModerationQueue({
      moderate: async () => ({ decision: "approved" }),
    })).rejects.toThrow(/moderation item/i);

    expect(state.completionPostIds).toContain("post-2");
  });
});
