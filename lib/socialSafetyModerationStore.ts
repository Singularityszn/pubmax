import "server-only";

import {
  parseFlaggedMessages,
  parseSafetyReports,
  parseSuspensionOutcome,
  SAFETY_QUEUE_LIMIT,
  type SafetyModerationAction,
  type SafetyQueues,
  type SuspensionOutcome,
} from "@/lib/socialSafetyModeration";
import { requireSupabaseAdmin } from "@/lib/supabase";
import type { Database } from "@/types/database";

/**
 * The service layer behind the admin safety queues (0223). Every call names
 * the moderator's staff role; the database refuses a role that is not an
 * active moderator, so this store is no authority of its own.
 */
type SocialSafetyRpcName =
  | "read_social_report_queue_admin"
  | "read_flagged_messages_admin"
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
    ): Promise<{ changed: boolean } | SuspensionOutcome> {
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

