import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type SocialPostTag = { handle: string };
export type SocialPostTagProposal = {
  id: string;
  postId: string;
  authorHandle: string;
  state: "proposed" | "approved";
  createdAt: string;
};
export type SocialPostOutboxItem = {
  id: string;
  moderationState: "pending" | "needs_review";
  revision: number;
  createdAt: string;
};
export type SocialPostHeldItem = {
  staffDisplayName: string;
  postId: string;
  mediaId: string | null;
  moderationClaim: string;
  createdAt: string;
};

export class SocialPostConsentStoreError extends Error {}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SocialPostConsentStoreError("Social consent data is unavailable.");
  }
  return value as Record<string, unknown>;
}

async function rpc(name: string, input: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await requireSupabaseAdmin().rpc(name, input);
  if (error) throw new SocialPostConsentStoreError(error.message);
  return data;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new SocialPostConsentStoreError("Social consent data is unavailable.");
  return value.map(row);
}

export type SocialPostConsentStore = {
  approvedTags(viewer: SocialPostActor, postIds: string[]): Promise<Map<string, SocialPostTag[]>>;
  mediaObjectKey(viewer: SocialPostActor, mediaId: string): Promise<string | null>;
  tagInbox(viewer: SocialPostActor, limit: number): Promise<SocialPostTagProposal[]>;
  actOnTag(viewer: SocialPostActor, proposalId: string, action: "approve" | "decline" | "withdraw" | "cancel"): Promise<void>;
  outbox(viewer: SocialPostActor, limit: number): Promise<SocialPostOutboxItem[]>;
  heldQueue(viewer: SocialPostActor, limit: number): Promise<SocialPostHeldItem[]>;
  moderateHeld(viewer: SocialPostActor, postId: string, mediaId: string | null, action: "approve" | "hide"): Promise<void>;
};

export function createSocialPostConsentStore(): SocialPostConsentStore {
  return {
    async approvedTags(viewer, postIds) {
      if (postIds.length === 0) return new Map();
      const result = new Map<string, SocialPostTag[]>();
      for (const item of rows(await rpc("read_social_post_tags_many", {
        p_viewer: viewer.profileId,
        p_post_ids: postIds,
      }))) {
        if (typeof item.post_id !== "string" || typeof item.handle !== "string") {
          throw new SocialPostConsentStoreError("Social consent data is unavailable.");
        }
        const tags = result.get(item.post_id) ?? [];
        tags.push({ handle: item.handle });
        result.set(item.post_id, tags);
      }
      return result;
    },
    async mediaObjectKey(viewer, mediaId) {
      const result = rows(await rpc("read_social_post_media", {
        p_viewer: viewer.profileId,
        p_media_id: mediaId,
      }));
      if (result.length === 0) return null;
      return typeof result[0]?.object_key === "string" ? result[0].object_key : null;
    },
    async tagInbox(viewer, limit) {
      return rows(await rpc("read_social_tag_inbox", {
        p_viewer: viewer.profileId,
        p_limit: limit,
      })).map((item) => {
        if (
          typeof item.proposal_id !== "string" || typeof item.post_id !== "string" ||
          typeof item.author_handle !== "string" ||
          (item.state !== "proposed" && item.state !== "approved") ||
          typeof item.created_at !== "string"
        ) throw new SocialPostConsentStoreError("Social consent data is unavailable.");
        return {
          id: item.proposal_id,
          postId: item.post_id,
          authorHandle: item.author_handle,
          state: item.state,
          createdAt: item.created_at,
        };
      });
    },
    async actOnTag(viewer, proposalId, action) {
      const result = await rpc("act_social_post_tag", {
        p_actor: viewer.profileId,
        p_proposal_id: proposalId,
        p_action: action,
      });
      if (result !== true) throw new SocialPostConsentStoreError("Tag choice was not saved.");
    },
    async outbox(viewer, limit) {
      return rows(await rpc("read_social_post_outbox", {
        p_owner: viewer.profileId,
        p_limit: limit,
      })).map((item) => {
        if (
          typeof item.id !== "string" ||
          (item.moderation_state !== "pending" && item.moderation_state !== "needs_review") ||
          !Number.isInteger(item.revision) || typeof item.created_at !== "string"
        ) throw new SocialPostConsentStoreError("Social outbox is unavailable.");
        return {
          id: item.id,
          moderationState: item.moderation_state,
          revision: Number(item.revision),
          createdAt: item.created_at,
        };
      });
    },
    async heldQueue(viewer, limit) {
      return rows(await rpc("read_social_post_moderation_queue", {
        p_actor: viewer.profileId,
        p_limit: limit,
      })).map((item) => {
        if (
          typeof item.staff_display_name !== "string" || typeof item.post_id !== "string" ||
          (item.media_id !== null && typeof item.media_id !== "string") ||
          typeof item.moderation_claim !== "string" || typeof item.created_at !== "string"
        ) throw new SocialPostConsentStoreError("Social moderation queue is unavailable.");
        return {
          staffDisplayName: item.staff_display_name,
          postId: item.post_id,
          mediaId: item.media_id as string | null,
          moderationClaim: item.moderation_claim,
          createdAt: item.created_at,
        };
      });
    },
    async moderateHeld(viewer, postId, mediaId, action) {
      const result = await rpc("moderate_social_post", {
        p_actor: viewer.profileId,
        p_post_id: postId,
        p_media_id: mediaId,
        p_action: action,
      });
      if (result !== true) throw new SocialPostConsentStoreError("Social moderation choice was not saved.");
    },
  };
}

export const socialPostConsentStore = createSocialPostConsentStore();
