import "server-only";

import {
  parseFlaggedMessages,
  parseMessageEvidence,
  parseReportedContentEvidence,
  parseSafetyReports,
  parseSuspensionOutcome,
  REPORTED_POST_MEDIA_LIMIT,
  SAFETY_QUEUE_LIMIT,
  type MessageEvidence,
  type ReportedContentEvidence,
  type SafetyModerationAction,
  type SafetyQueues,
  type SuspensionOutcome,
} from "@/lib/socialSafetyModeration";
import { isMessagePhotoServingKey } from "@/lib/messageAttachments";
import { requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import type { Database } from "@/types/database";

/**
 * The service layer behind the admin safety queues (0224). Every call names
 * the moderator's staff role; the database refuses a role that is not an
 * active moderator, so this store is no authority of its own.
 */
type SocialSafetyRpcName =
  | "read_social_report_queue_admin"
  | "read_flagged_messages_admin"
  | "read_flagged_message_evidence_admin"
  | "read_reported_content_evidence_admin"
  | "resolve_social_report_admin"
  | "review_flagged_message_admin"
  | "set_social_account_suspension_admin";

function safetyRpcNamesMatchCatalog(
  _ok: SocialSafetyRpcName extends keyof Database["public"]["Functions"] ? true : never,
): void {
  void _ok;
}
safetyRpcNamesMatchCatalog(true);

export type SocialSafetyRpc = (name: SocialSafetyRpcName, input: Record<string, unknown>) => Promise<unknown>;

class SocialSafetyStoreError extends Error {}

const defaultRpc: SocialSafetyRpc = async (name, input) => {
  const { data, error } = await requireSupabaseAdmin().rpc(name, input as never);
  if (error) throw new SocialSafetyStoreError(error.message);
  return data;
};

export function createSocialSafetyStore(rpc: SocialSafetyRpc = defaultRpc) {
  return {
    async queues(staffRoleId: string): Promise<SafetyQueues> {
      const [reportRows, messageRows] = await Promise.all([
        rpc("read_social_report_queue_admin", { p_staff_role_id: staffRoleId, p_limit: SAFETY_QUEUE_LIMIT }),
        rpc("read_flagged_messages_admin", { p_staff_role_id: staffRoleId, p_limit: SAFETY_QUEUE_LIMIT }),
      ]);
      const reports = parseSafetyReports(reportRows);
      const flaggedMessages = parseFlaggedMessages(messageRows);
      if (!reports || !flaggedMessages) throw new SocialSafetyStoreError("Safety queue answer is malformed.");
      return { reports, flaggedMessages };
    },

    /** True when the action changed something; a suspend answers its outcome. */
    async act(
      staffRoleId: string,
      input: SafetyModerationAction,
    ): Promise<{ changed: boolean } | SuspensionOutcome | { evidence: MessageEvidence | ReportedContentEvidence | null }> {
      if (input.action === "view_report_evidence") {
        const value = await rpc("read_reported_content_evidence_admin", {
          p_staff_role_id: staffRoleId,
          p_report_id: input.reportId,
        });
        if (value === null) return { evidence: null };
        const row = value as Record<string, unknown>;
        if (!row || row.reportId !== input.reportId || !Array.isArray(row.media)
          || (row.kind !== "post" && row.kind !== "comment" && row.kind !== "quote")
          || row.media.length > (row.kind === "post" ? REPORTED_POST_MEDIA_LIMIT : 0)) {
          throw new SocialSafetyStoreError("Evidence answer is malformed.");
        }
        const uuid = "[0-9a-f-]{36}";
        for (const media of row.media) {
          const pattern = media?.kind === "photo"
            ? new RegExp(`^(social/${uuid}/${uuid}|social-extra/${uuid})/image\\.jpg$`)
            : media?.kind === "video" ? new RegExp(`^social-video/${uuid}/video\\.(mp4|webm|mov)$`) : null;
          if (!pattern || typeof media.objectKey !== "string" || !pattern.test(media.objectKey)) {
            throw new SocialSafetyStoreError("Evidence answer is malformed.");
          }
        }
        const media = await Promise.all(row.media.map(async (item: { kind: string; objectKey: string }) => {
          const { data, error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET)
            .createSignedUrl(item.objectKey, 180);
          if (error || !data?.signedUrl) throw new SocialSafetyStoreError("Evidence signing is unavailable.");
          return { kind: item.kind, url: data.signedUrl };
        }));
        const evidence = parseReportedContentEvidence({ ...row, media });
        if (!evidence) throw new SocialSafetyStoreError("Evidence answer is malformed.");
        return { evidence };
      }
      if (input.action === "view_message_evidence") {
        const value = await rpc("read_flagged_message_evidence_admin", {
          p_staff_role_id: staffRoleId,
          p_message_id: input.messageId,
        });
        if (value === null) return { evidence: null };
        const row = value as Record<string, unknown>;
        if (row.kind === "photo") {
          if (row.messageId !== input.messageId || typeof row.conversationId !== "string"
            || typeof row.objectKey !== "string"
            || !isMessagePhotoServingKey(row.conversationId, input.messageId, row.objectKey)) {
            throw new SocialSafetyStoreError("Evidence answer is malformed.");
          }
          const { data, error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET)
            .createSignedUrl(row.objectKey, 180);
          if (error || !data?.signedUrl) throw new SocialSafetyStoreError("Evidence signing is unavailable.");
          const evidence = parseMessageEvidence({ kind: "photo", url: data.signedUrl });
          if (!evidence) throw new SocialSafetyStoreError("Evidence URL is malformed.");
          return { evidence };
        }
        const evidence = parseMessageEvidence(value);
        if (!evidence) throw new SocialSafetyStoreError("Evidence answer is malformed.");
        return { evidence };
      }
      if (input.action === "resolve_report") {
        const value = await rpc("resolve_social_report_admin", {
          p_staff_role_id: staffRoleId,
          p_report_id: input.reportId,
        });
        return { changed: value === true };
      }
      if (input.action === "review_message") {
        const value = await rpc("review_flagged_message_admin", {
          p_staff_role_id: staffRoleId,
          p_message_id: input.messageId,
        });
        return { changed: value === true };
      }
      const value = await rpc("set_social_account_suspension_admin", {
        p_staff_role_id: staffRoleId,
        p_profile_id: input.profileId,
        p_action: input.action,
        p_reason: input.reason,
        p_report_id: input.reportId,
      });
      const outcome = parseSuspensionOutcome(value);
      if (!outcome) throw new SocialSafetyStoreError("Suspension answer is malformed.");
      return outcome;
    },
  };
}
