import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  manifest: null as unknown, error: null as unknown, completed: true,
  completions: [] as Record<string, unknown>[],
  events: [] as string[],
}));
vi.mock("@/lib/supabase", () => ({
  requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => ({ rpc: async (name: string, input: Record<string, unknown>) => {
    if (name === "claim_social_post_moderation_jobs") return { data: [{ post_id: "post", revision: 4, media_id: "first", lease_token: "lease", object_key: "first.jpg", moderation_claim: "A day out", attempts: 1 }], error: null };
    if (name === "read_social_gallery_moderation_manifest") {
      expect(input).toEqual({ p_post_id: "post", p_revision: 4, p_lease_token: "lease" });
      return { data: state.manifest, error: state.error };
    }
    if (name === "complete_social_post_moderation_job") { state.completions.push(input); return { data: state.completed, error: null }; }
    throw new Error(`Unexpected RPC ${name}`);
  } }),
}));
vi.mock("@/lib/socialPostMedia.server", () => ({
  signSocialPhotoObject: async (key: string) => { state.events.push(`sign:${key}`); return `https://signed.test/${key}`; },
  supabaseSocialPhotoStorage: {},
}));
import { supabaseSocialPostStore } from "@/lib/socialPostStore";

beforeEach(() => {
  state.manifest = { gallery: true, items: [{ objectKey: "first.jpg", altText: "Canal", mediaId: "first", position: 1 }, { objectKey: "second.jpg", altText: "Garden", mediaId: "second", position: 2 }] };
  state.error = null;
  state.completed = true;
  state.completions = [];
  state.events = [];
});

describe("gallery moderation leases", () => {
  it("scans every signed photo and holds the whole post if any photo needs review", async () => {
    const inputs: Array<{ text: string; imageUrl?: string }> = [];
    const result = await supabaseSocialPostStore.processModerationQueue({ moderate: async input => {
      state.events.push(`scan:${input.imageUrl!.split("/").at(-1)}`);
      inputs.push(input); return { decision: inputs.length === 2 ? "needs_review" : "approved" };
    } });
    expect(inputs).toMatchObject([{ imageUrl: "https://signed.test/first.jpg", text: "A day out\nPhoto description: Canal" }, { imageUrl: "https://signed.test/second.jpg", text: "A day out\nPhoto description: Garden" }]);
    expect(result).toMatchObject({ approved: 0, needsReview: 1 });
    expect(state.events).toEqual(["sign:first.jpg", "scan:first.jpg", "sign:second.jpg", "scan:second.jpg"]);
    expect(state.completions).toMatchObject([{ p_revision: 4, p_lease_token: "lease", p_decision: "needs_review" }]);
  });

  it.each([
    { manifest: null, error: { code: "PGRST202", message: "RPC missing" } },
    { manifest: null, error: null },
    { manifest: { gallery: true, items: [] }, error: null },
    { manifest: { gallery: false, items: [{ objectKey: "hidden.jpg" }] }, error: null },
  ])("never falls back to the primary image after an invalid manifest: %j", async scenario => {
    Object.assign(state, scenario);
    const moderate = vi.fn(async () => ({ decision: "approved" as const }));
    const result = await supabaseSocialPostStore.processModerationQueue({ moderate });
    expect(moderate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ approved: 0, retried: 1 });
    expect(state.completions).toMatchObject([{ p_decision: null }]);
  });

  it("discards provider approval when the revision or lease changed", async () => {
    state.completed = false;
    const result = await supabaseSocialPostStore.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    expect(result).toMatchObject({ approved: 0, needsReview: 0 });
  });

  it("keeps a later-photo outage pending instead of approving the earlier photos", async () => {
    let seen = 0;
    const result = await supabaseSocialPostStore.processModerationQueue({ moderate: async () => {
      if (++seen === 2) throw new Error("Provider unavailable");
      return { decision: "approved" };
    } });
    expect(result).toMatchObject({ approved: 0, retried: 1 });
    expect(state.completions).toMatchObject([{ p_decision: null }]);
  });
});
