import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { socialPostFromRow, type SocialPostActor } from "@/lib/socialPostStore";
import { socialPostDTO, type SocialPostDTO, type SocialPostVisibility } from "@/lib/socialPosts";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

export type SocialPostTag = { handle: string };
export type SocialPostTagProposal = {
  id: string;
  postId: string;
  authorHandle: string;
  state: "proposed" | "approved";
  mediaId: string | null;
  visibility: SocialPostVisibility;
  photoAltText: string | null;
  reviewRevision: number;
  audienceAtApproval: {
    visibility: SocialPostVisibility;
    revision: number;
    shownAt: string;
  } | null;
  createdAt: string;
};
export type SocialPostTagInboxPage = { proposals: SocialPostTagProposal[]; nextCursor: string | null };
export type SocialPostOutboxPage = { posts: SocialPostDTO[]; nextCursor: string | null };
export type SocialPostHeldItem = {
  staffDisplayName: string;
  postId: string;
  mediaId: string | null;
  moderationClaim: string;
  createdAt: string;
};

export class SocialPostConsentStoreError extends Error {}

type PageInput = { cursor?: string | null; limit: number };
type TagPageInput = PageInput & { lane: "proposed" | "approved" };
type PageCursor = { v: 1; scope: string; createdAt: string; id: string };

function cursorSignature(encoded: string, viewerProfileId: string): Buffer {
  return createHmac("sha256", trustedSigningKey())
    .update(`social-consent-cursor:v1:${viewerProfileId}:${encoded}`)
    .digest();
}

function decodeCursor(
  value: string | null | undefined,
  viewerProfileId: string,
  scope: string,
): PageCursor | null {
  if (!value) return null;
  try {
    if (value.length > 1_000) throw new Error();
    const parts = value.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error();
    const [encoded, rawSignature] = parts;
    const signature = Buffer.from(rawSignature, "base64url");
    const expected = cursorSignature(encoded, viewerProfileId);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error();
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PageCursor;
    if (!parsed || parsed.v !== 1 || parsed.scope !== scope ||
      typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error();
    return parsed;
  } catch {
    throw new SocialPostConsentStoreError("That Social page is not valid.");
  }
}

function encodeCursor(createdAt: string, id: string, viewerProfileId: string, scope: string): string {
  const encoded = Buffer.from(JSON.stringify({ v: 1, scope, createdAt, id }), "utf8").toString("base64url");
  return `${encoded}.${cursorSignature(encoded, viewerProfileId).toString("base64url")}`;
}

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new SocialPostConsentStoreError("Social page size is not valid.");
  }
  return limit;
}

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
  tagInbox(viewer: SocialPostActor, input: TagPageInput): Promise<SocialPostTagInboxPage>;
  actOnTag(
    viewer: SocialPostActor,
    proposalId: string,
    action: "approve" | "decline" | "withdraw" | "cancel",
    expectedAudienceRevision?: number,
  ): Promise<void>;
  outbox(viewer: SocialPostActor, input: PageInput): Promise<SocialPostOutboxPage>;
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
    async tagInbox(viewer, input) {
      const limit = boundedLimit(input.limit);
      const scope = `tags:${input.lane}`;
      const cursor = decodeCursor(input.cursor, viewer.profileId, scope);
      const parsed = rows(await rpc("read_social_tag_inbox", {
        p_viewer: viewer.profileId,
        p_lane: input.lane,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: limit + 1,
      })).map((item) => {
        if (
          typeof item.proposal_id !== "string" || typeof item.post_id !== "string" ||
          (item.media_id !== null && typeof item.media_id !== "string") || typeof item.author_handle !== "string" ||
          (item.state !== "proposed" && item.state !== "approved") ||
          (item.visibility !== "public" && item.visibility !== "friends" && item.visibility !== "private") ||
          (item.photo_alt_text !== null && typeof item.photo_alt_text !== "string") || !Number.isInteger(item.review_revision) ||
          typeof item.created_at !== "string"
        ) throw new SocialPostConsentStoreError("Social consent data is unavailable.");
        if (item.state === "proposed" && (item.media_id === null || item.photo_alt_text === null)) {
          throw new SocialPostConsentStoreError("Social consent data is unavailable.");
        }
        const hasAudience = item.audience_visibility !== null || item.audience_revision !== null || item.audience_shown_at !== null;
        if ((item.state === "approved") !== hasAudience) {
          throw new SocialPostConsentStoreError("Social consent data is unavailable.");
        }
        if (hasAudience && (
          (item.audience_visibility !== "public" && item.audience_visibility !== "friends" && item.audience_visibility !== "private") ||
          !Number.isInteger(item.audience_revision) || typeof item.audience_shown_at !== "string"
        )) throw new SocialPostConsentStoreError("Social consent data is unavailable.");
        return {
          id: item.proposal_id,
          postId: item.post_id,
          mediaId: item.media_id,
          authorHandle: item.author_handle,
          state: item.state as "proposed" | "approved",
          visibility: item.visibility as SocialPostVisibility,
          photoAltText: item.photo_alt_text,
          reviewRevision: Number(item.review_revision),
          audienceAtApproval: hasAudience ? {
            visibility: item.audience_visibility as SocialPostVisibility,
            revision: Number(item.audience_revision),
            shownAt: String(item.audience_shown_at),
          } : null,
          createdAt: item.created_at,
        };
      });
      const page = parsed.slice(0, limit);
      const last = page.at(-1);
      return {
        proposals: page,
        nextCursor: parsed.length > limit && last
          ? encodeCursor(last.createdAt, last.id, viewer.profileId, scope)
          : null,
      };
    },
    async actOnTag(viewer, proposalId, action, expectedAudienceRevision) {
      const result = await rpc("act_social_post_tag", {
        p_actor: viewer.profileId,
        p_proposal_id: proposalId,
        p_action: action,
        p_expected_audience_revision: action === "approve" ? expectedAudienceRevision ?? null : null,
      });
      if (result !== true) throw new SocialPostConsentStoreError("Tag choice was not saved.");
    },
    async outbox(viewer, input) {
      const limit = boundedLimit(input.limit);
      const scope = "outbox";
      const cursor = decodeCursor(input.cursor, viewer.profileId, scope);
      const parsed = rows(await rpc("read_social_post_outbox", {
        p_owner: viewer.profileId,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: limit + 1,
      })).map((item) => socialPostDTO(socialPostFromRow(item), {
        exactVenue: typeof item.venue_id === "string",
        viewerProfileId: viewer.profileId,
      }));
      const page = parsed.slice(0, limit);
      const last = page.at(-1);
      return {
        posts: page,
        nextCursor: parsed.length > limit && last
          ? encodeCursor(last.createdAt, last.id, viewer.profileId, scope)
          : null,
      };
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
