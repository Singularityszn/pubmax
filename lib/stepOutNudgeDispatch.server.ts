import "server-only";

// Batched Step Out weekly send. Skips users with nothing owed and users inside
// the per-subscription frequency window. Counts only — never logs tokens.

import { sendStepOutNudge } from "@/lib/pushSender";
import {
  canSendStepOutNudge,
  STEP_OUT_NUDGE_WEEK_MS,
  type StepOutNudgePayload,
} from "@/lib/stepOutNudge";
import {
  accountIdForOwnerActor,
  selectOwedStepOutNudge,
} from "@/lib/stepOutNudgeSelect.server";
import {
  stepOutNudgeStore,
  type StepOutNudgePref,
} from "@/lib/stepOutNudgeStore";

export type StepOutNudgeDispatchSummary = {
  considered: number;
  sent: number;
  skippedFrequency: number;
  skippedNothingOwed: number;
  skippedNoAccount: number;
  pruned: number;
  errors: number;
};

export type StepOutNudgeDispatchDeps = {
  listEnabled: () => Promise<StepOutNudgePref[]>;
  resolveAccountId: (ownerActor: string) => Promise<string | null>;
  selectPayload: (
    ownerActor: string,
    accountId: string,
    now: Date,
  ) => Promise<StepOutNudgePayload | null>;
  send: (
    token: string,
    payload: StepOutNudgePayload,
  ) => Promise<{ sent: number; pruned: number; errors: number }>;
  /** Stamp the row before the send while it is still due. False means another run took it. */
  claim: (ownerActor: string, sentAt: string, resendBefore: string) => Promise<boolean>;
  /** Put the prior stamp back after a send that reported no delivery. */
  release: (ownerActor: string, claimedAt: string, priorSentAt: string | null) => Promise<void>;
};

export function defaultStepOutNudgeDispatchDeps(): StepOutNudgeDispatchDeps {
  return {
    listEnabled: () => stepOutNudgeStore().listEnabled(),
    resolveAccountId: accountIdForOwnerActor,
    selectPayload: selectOwedStepOutNudge,
    send: async (token, payload) => {
      const result = await sendStepOutNudge(token, payload);
      return {
        sent: result.sent,
        pruned: result.pruned,
        errors: result.errors,
      };
    },
    claim: (ownerActor, sentAt, resendBefore) =>
      stepOutNudgeStore().claimSend(ownerActor, sentAt, resendBefore),
    release: (ownerActor, claimedAt, priorSentAt) =>
      stepOutNudgeStore().releaseSendClaim(ownerActor, claimedAt, priorSentAt),
  };
}

const BATCH_SIZE = 25;

/**
 * Walk every opted-in subscription, select an owed place-bound payload, and
 * send at most one push per week. Never invents filler.
 */
export async function dispatchStepOutNudges(
  now: Date = new Date(),
  deps: StepOutNudgeDispatchDeps = defaultStepOutNudgeDispatchDeps(),
): Promise<StepOutNudgeDispatchSummary> {
  const summary: StepOutNudgeDispatchSummary = {
    considered: 0,
    sent: 0,
    skippedFrequency: 0,
    skippedNothingOwed: 0,
    skippedNoAccount: 0,
    pruned: 0,
    errors: 0,
  };

  const enabled = await deps.listEnabled();
  for (let i = 0; i < enabled.length; i += BATCH_SIZE) {
    const batch = enabled.slice(i, i + BATCH_SIZE);
    for (const pref of batch) {
      summary.considered += 1;
      if (!pref.subscriptionToken) {
        summary.skippedNothingOwed += 1;
        continue;
      }
      if (!canSendStepOutNudge(pref.lastSentAt, now)) {
        summary.skippedFrequency += 1;
        continue;
      }
      const accountId = await deps.resolveAccountId(pref.ownerActor);
      if (!accountId) {
        summary.skippedNoAccount += 1;
        continue;
      }
      const payload = await deps.selectPayload(pref.ownerActor, accountId, now);
      if (!payload) {
        summary.skippedNothingOwed += 1;
        continue;
      }
      // Claim before the send. A cron event can arrive twice and two runs can list
      // the same row, so only the run that wins the stamp sends.
      const claimedAt = now.toISOString();
      const resendBefore = new Date(now.getTime() - STEP_OUT_NUDGE_WEEK_MS).toISOString();
      let won: boolean;
      try {
        won = await deps.claim(pref.ownerActor, claimedAt, resendBefore);
      } catch {
        summary.errors += 1;
        continue;
      }
      if (!won) {
        summary.skippedFrequency += 1;
        continue;
      }
      let result: { sent: number; pruned: number; errors: number };
      try {
        result = await deps.send(pref.subscriptionToken, payload);
      } catch {
        // The push may have gone out, so keep the claim: a missed nudge beats a second one.
        summary.errors += 1;
        continue;
      }
      summary.sent += result.sent;
      summary.pruned += result.pruned;
      summary.errors += result.errors;
      if (result.sent === 0) {
        // Nothing was delivered, so put the prior stamp back and retry next run as before.
        // If the release fails the claim stays and the nudge is missed, not doubled.
        try {
          await deps.release(pref.ownerActor, claimedAt, pref.lastSentAt);
        } catch {
          summary.errors += 1;
        }
      }
    }
  }

  return summary;
}
