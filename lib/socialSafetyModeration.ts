// The admin safety queues (launch plan P0 item 6): open Social reports,
// flagged DMs, and an audited suspend. A pure leaf: the store, the admin route
// and the admin console all read their shapes and their input rules here.
//
// The database is the authority (migration 0224): every function checks an
// active moderator staff role, and every suspend or reinstate writes one audit
// row in the same transaction. This file only decides what a well-formed
// answer and a well-formed request look like.

import {
  SOCIAL_REPORT_KINDS,
  SOCIAL_REPORT_REASONS,
  type SocialReportKind,
  type SocialReportReason,
} from "@/lib/socialInteractions";
import { SOCIAL_POST_MAX_PHOTOS } from "@/lib/socialPostPhotos";

export const SAFETY_QUEUE_LIMIT = 50;
export const REPORTED_POST_MEDIA_LIMIT = SOCIAL_POST_MAX_PHOTOS + 1;
export const SUSPEND_REASON_MIN = 3;
export const SUSPEND_REASON_MAX = 500;

export type AccountState = "active" | "suspended";

export type SafetyReportItem = {
  reportId: string;
  kind: SocialReportKind;
  contentId: string;
  reason: SocialReportReason;
  createdAt: string;
  reporterHandle: string;
  /** The person the report is about, or null when their content has gone. */
  targetProfileId: string | null;
  targetHandle: string | null;
  targetAccountState: AccountState | null;
  /** Up to 280 characters of the reported text. Null for a person report. */
  excerpt: string | null;
};

export type FlaggedMessageItem = {
  messageId: string;
  conversationId: string;
  body: string;
  hasAttachment: boolean;
  senderHandle: string;
  senderProfileId: string | null;
  senderAccountState: AccountState | null;
  flaggedBy: string | null;
  flaggedAt: string;
  sentAt: string;
};

export type SafetyQueues = {
  reports: SafetyReportItem[];
  flaggedMessages: FlaggedMessageItem[];
};

export type SafetyModerationAction =
  | { action: "resolve_report"; reportId: string }
  | { action: "review_message"; messageId: string }
  | { action: "view_message_evidence"; messageId: string }
  | { action: "view_report_evidence"; reportId: string }
  | {
      action: "suspend" | "reinstate";
      profileId: string;
      reason: string;
      reportId: string | null;
    };

export type SuspensionOutcome = {
  code: "suspended" | "reinstated" | "unchanged" | "invalid" | "not_found" | "gone";
  state: AccountState | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function accountState(value: unknown): AccountState | null | undefined {
  if (value === null) return null;
  return value === "active" || value === "suspended" ? value : undefined;
}

function isoTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseReport(value: unknown): SafetyReportItem | null {
  const row = record(value);
  if (!row) return null;
  const targetProfileId = row.targetProfileId === null ? null : isUuid(row.targetProfileId) ? row.targetProfileId : undefined;
  const targetHandle = nullableText(row.targetHandle);
  const targetAccountState = accountState(row.targetAccountState);
  const excerpt = nullableText(row.excerpt);
  if (
    !isUuid(row.reportId) ||
    !SOCIAL_REPORT_KINDS.includes(row.kind as SocialReportKind) ||
    !isUuid(row.contentId) ||
    !SOCIAL_REPORT_REASONS.includes(row.reason as SocialReportReason) ||
    !isoTime(row.createdAt) ||
    !text(row.reporterHandle) ||
    targetProfileId === undefined ||
    targetHandle === undefined ||
    targetAccountState === undefined ||
    excerpt === undefined
  ) {
    return null;
  }
  return {
    reportId: row.reportId,
    kind: row.kind as SocialReportKind,
    contentId: row.contentId,
    reason: row.reason as SocialReportReason,
    createdAt: row.createdAt,
    reporterHandle: row.reporterHandle,
    targetProfileId,
    targetHandle,
    targetAccountState,
    excerpt,
  };
}

function parseFlaggedMessage(value: unknown): FlaggedMessageItem | null {
  const row = record(value);
  if (!row) return null;
  const senderProfileId = row.senderProfileId === null ? null : isUuid(row.senderProfileId) ? row.senderProfileId : undefined;
  const senderAccountState = accountState(row.senderAccountState);
  const flaggedBy = nullableText(row.flaggedBy);
  if (
    !isUuid(row.messageId) ||
    !isUuid(row.conversationId) ||
    typeof row.body !== "string" ||
    typeof row.hasAttachment !== "boolean" ||
    !text(row.senderHandle) ||
    senderProfileId === undefined ||
    senderAccountState === undefined ||
    flaggedBy === undefined ||
    !isoTime(row.flaggedAt) ||
    !isoTime(row.sentAt)
  ) {
    return null;
  }
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    body: row.body,
    hasAttachment: row.hasAttachment,
    senderHandle: row.senderHandle,
    senderProfileId,
    senderAccountState,
    flaggedBy,
    flaggedAt: row.flaggedAt,
    sentAt: row.sentAt,
  };
}

function parseList<T>(value: unknown, parse: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > SAFETY_QUEUE_LIMIT) return null;
  const rows: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return rows;
}

export function parseSafetyReports(value: unknown): SafetyReportItem[] | null {
  return parseList(value, parseReport);
}

export function parseFlaggedMessages(value: unknown): FlaggedMessageItem[] | null {
  return parseList(value, parseFlaggedMessage);
}

export function parseSafetyQueues(value: unknown): SafetyQueues | null {
  const row = record(value);
  if (!row) return null;
  const reports = parseSafetyReports(row.reports);
  const flaggedMessages = parseFlaggedMessages(row.flaggedMessages);
  return reports && flaggedMessages ? { reports, flaggedMessages } : null;
}

/** A moderator's request, or null. Exact keys only, so nothing rides along. */
export function parseSafetyModerationAction(value: unknown): SafetyModerationAction | null {
  const row = record(value);
  if (!row) return null;
  const keys = Object.keys(row).sort().join(",");
  if (row.action === "resolve_report" || row.action === "view_report_evidence") {
    return keys === "action,reportId" && isUuid(row.reportId)
      ? { action: row.action, reportId: row.reportId }
      : null;
  }
  if (row.action === "review_message" || row.action === "view_message_evidence") {
    return keys === "action,messageId" && isUuid(row.messageId)
      ? { action: row.action, messageId: row.messageId }
      : null;
  }
  if (row.action === "suspend" || row.action === "reinstate") {
    if (keys !== "action,profileId,reason,reportId" || !isUuid(row.profileId)) return null;
    if (typeof row.reason !== "string") return null;
    const reason = row.reason.trim();
    if (reason.length < SUSPEND_REASON_MIN || reason.length > SUSPEND_REASON_MAX) return null;
    if (row.reportId !== null && !isUuid(row.reportId)) return null;
    return { action: row.action, profileId: row.profileId, reason, reportId: row.reportId as string | null };
  }
  return null;
}

export function parseSuspensionOutcome(value: unknown): SuspensionOutcome | null {
  const row = record(value);
  if (!row || typeof row.code !== "string") return null;
  const codes: SuspensionOutcome["code"][] = ["suspended", "reinstated", "unchanged", "invalid", "not_found", "gone"];
  if (!codes.includes(row.code as SuspensionOutcome["code"])) return null;
  const state = row.state === undefined ? null : accountState(row.state);
  if (state === undefined) return null;
  return { code: row.code as SuspensionOutcome["code"], state };
}

export type MessageEvidence =
  | { kind: "photo"; url: string }
  | { kind: "poll"; question: string; options: string[] }
  | { kind: "venue"; venueId: string }
  | { kind: "contact"; handle: string }
  | { kind: "event"; planId: string };

export function parseMessageEvidence(value: unknown): MessageEvidence | null {
  const row = record(value);
  if (!row) return null;
  if (row.kind === "photo" && typeof row.url === "string" && row.url.startsWith("https://")) {
    return { kind: "photo", url: row.url };
  }
  if (row.kind === "poll" && text(row.question) && Array.isArray(row.options)
    && row.options.length >= 2 && row.options.length <= 6 && row.options.every(text)) {
    return { kind: "poll", question: row.question, options: row.options };
  }
  if (row.kind === "venue" && text(row.venueId)) return { kind: "venue", venueId: row.venueId };
  if (row.kind === "contact" && text(row.handle)) return { kind: "contact", handle: row.handle };
  if (row.kind === "event" && isUuid(row.planId)) return { kind: "event", planId: row.planId };
  return null;
}

export type ReportedContentEvidence = {
  reportId: string;
  kind: Exclude<SocialReportKind, "profile">;
  contentId: string;
  body: string;
  media: { kind: "photo" | "video"; url: string }[];
};

export function parseReportedContentEvidence(value: unknown): ReportedContentEvidence | null {
  const row = record(value);
  if (!row || !isUuid(row.reportId) || !isUuid(row.contentId) || typeof row.body !== "string"
    || (row.kind !== "post" && row.kind !== "comment" && row.kind !== "quote")
    || !Array.isArray(row.media) || row.media.length > (row.kind === "post" ? REPORTED_POST_MEDIA_LIMIT : 0)) return null;
  const media: ReportedContentEvidence["media"] = [];
  for (const item of row.media) {
    const attachment = record(item);
    if (!attachment || (attachment.kind !== "photo" && attachment.kind !== "video")
      || typeof attachment.url !== "string" || !attachment.url.startsWith("https://")) return null;
    media.push({ kind: attachment.kind, url: attachment.url });
  }
  return { reportId: row.reportId, kind: row.kind, contentId: row.contentId, body: row.body, media };
}
