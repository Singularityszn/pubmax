import type { SocialPostDTO, SocialPostVisibility } from "@/lib/socialPosts";

export type SocialDesiredInteraction = "cheer" | "save" | "repost";
export type SocialFeatureStatus = "submitted" | "planned" | "shipped" | "declined";
export const SOCIAL_REPORT_REASONS = ["harassment", "hate", "threat", "doxxing", "spam", "other"] as const;
export type SocialReportReason = (typeof SOCIAL_REPORT_REASONS)[number];

export const SOCIAL_REPORT_REASON_LABELS: Record<SocialReportReason, string> = {
  harassment: "Harassment",
  hate: "Hate",
  threat: "A threat",
  doxxing: "Shares private details",
  spam: "Spam",
  other: "Something else",
};
type SocialModerationState = "pending" | "approved";

/**
 * "needs_review" is the provider's word for a flagged comment or quote. No person reviews one, so a flagged one is
 * hidden at once instead of waiting in a held state. Migration 0236 holds the same rule in SQL.
 */
export function interactionModerationOutcome(decision: "approved" | "needs_review"): {
  moderationState: "approved";
  hidden: boolean;
} {
  return { moderationState: "approved", hidden: decision !== "approved" };
}

export type SocialInteractionActor = {
  accountId: string;
  profileId: string;
  handle: string;
};

export type SocialInteractionSummary = {
  cheered: boolean;
  saved: boolean;
  reposted: boolean;
  cheerCount: number;
  repostCount: number;
};

/** What the viewer has set against one account. Their own choices only. */
export type SocialRelationship = {
  blocked: boolean;
  muted: boolean;
};

export type SocialCommentDTO = {
  id: string;
  postId: string;
  body: string;
  author: { handle: string };
  moderationState: SocialModerationState;
  createdAt: string;
};

export type SocialDerivativeDTO = {
  id: string;
  kind: "repost" | "quote";
  sourcePost: SocialPostDTO;
  body: string | null;
  visibility: SocialPostVisibility;
  author: { handle: string };
  moderationState: SocialModerationState;
  createdAt: string;
};

export type SocialNotificationDTO = {
  id: string;
  kind: "cheer" | "comment" | "repost" | "quote" | "feature_update" | "tag_proposal";
  sourcePostId: string;
  readAt: string | null;
  createdAt: string;
};

export type SocialFeatureUpdateDTO = {
  id: string;
  status: SocialFeatureStatus;
  response: string;
  staff: "PUBMAXX team";
  createdAt: string;
};

/** What a report is about. A "profile" report is about a person (0224). */
export const SOCIAL_REPORT_KINDS = ["post", "comment", "quote", "profile"] as const;
export type SocialReportKind = (typeof SOCIAL_REPORT_KINDS)[number];

export type SocialContentReportDTO = {
  id: string;
  kind: SocialReportKind;
  contentId: string;
  reason: SocialReportReason;
  state: "queued" | "reviewing";
  createdAt: string;
};

export type SocialCommentInput = { body: string; idempotencyKey: string };
export type SocialQuoteInput = {
  body: string;
  visibility: SocialPostVisibility;
  idempotencyKey: string;
};
export type SocialFeatureUpdateInput = {
  status: Exclude<SocialFeatureStatus, "submitted">;
  response: string;
  idempotencyKey: string;
};

export function cleanSocialText(value: unknown, cap: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length <= cap ? text : null;
}

export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{4,128}$/.test(value);
}

export function emptyInteractionSummary(): SocialInteractionSummary {
  return { cheered: false, saved: false, reposted: false, cheerCount: 0, repostCount: 0 };
}
