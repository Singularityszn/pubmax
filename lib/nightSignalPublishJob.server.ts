import "server-only";

import { randomUUID } from "node:crypto";
import { broadcastNightSignalLive, type NightSignalHighlight, type PushDispatchSummary } from "@/lib/pushSender";
import { requireDynamicSupabaseAdmin } from "@/lib/supabase";

type Outcome = "retryable" | "delivered" | "unknown";
type Counts = Pick<PushDispatchSummary, "targeted" | "sent" | "errors">;
type Dependencies = {
  claim(version: string, attempt: string): Promise<boolean>;
  settle(version: string, attempt: string, outcome: Outcome, counts: Counts): Promise<void>;
  send(highlights: readonly NightSignalHighlight[]): Promise<PushDispatchSummary>;
};

const durable: Dependencies = {
  async claim(version, attempt) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("claim_night_signal_broadcast", { p_version: version, p_attempt: attempt } as never);
    if (error) throw error;
    return data === true;
  },
  async settle(version, attempt, state, counts) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("settle_night_signal_broadcast", { p_version: version, p_attempt: attempt, p_state: state, p_targeted: counts.targeted, p_sent: counts.sent, p_errors: counts.errors } as never);
    if (error) throw error;
    if (data !== true) throw new Error("Night Signal broadcast claim was lost");
  },
  send: broadcastNightSignalLive,
};

export async function publishNightSignalSnapshot(version: string, highlights: readonly NightSignalHighlight[], deps: Dependencies = durable) {
  if (!version || highlights.length === 0) return { status: "empty" as const };
  const attempt = randomUUID();
  if (!await deps.claim(version, attempt)) return { status: "claimed" as const };
  let result: PushDispatchSummary;
  try { result = await deps.send(highlights); }
  catch {
    await deps.settle(version, attempt, "unknown", { targeted: 0, sent: 0, errors: 1 });
    return { status: "unknown" as const };
  }
  const knownRejected = result.targeted > 0 && result.results.length === result.targeted && result.results.every((item) => item.status === "invalid" || item.status === "skipped" || (item.status === "error" && /^(?:(?:web_push|apns)_\d{3}|fcm_(?:unavailable|internal|quota_exceeded|resource_exhausted|invalid_argument|sender_id_mismatch|third_party_auth_error|unauthenticated|permission_denied|not_found|unregistered|unknown))$/.test(item.reason ?? "")));
  const status: Outcome = result.errors === 0 && result.skipped === 0 ? "delivered"
    : result.sent === 0 && knownRejected ? "retryable" : "unknown";
  const counts = { targeted: result.targeted, sent: result.sent, errors: result.errors };
  await deps.settle(version, attempt, status, counts);
  return { status, ...counts };
}
