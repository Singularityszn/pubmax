import "server-only";

import {
  canSendCheapPint,
  cheapPintPrefView,
  isCheapPintPingWindow,
} from "@/lib/cheapPintPing";
import { sendCheapPintPing } from "@/lib/pushSender";
import {
  accountIdForOwnerActor,
  selectCheapPintPing,
} from "@/lib/cheapPintPingSelect.server";
import { stepOutNudgeStore, type StepOutNudgePref } from "@/lib/stepOutNudgeStore";

export type CheapPintPingDispatchSummary = {
  considered: number;
  sent: number;
  skippedWindow: number;
  skippedNotReady: number;
  skippedNoGroundedPint: number;
  skippedNoAccount: number;
  pruned: number;
  errors: number;
};

export type CheapPintPingDispatchDeps = {
  listSendReady: () => Promise<StepOutNudgePref[]>;
  resolveAccountId: (ownerActor: string) => Promise<string | null>;
  selectPayload: (
    ownerActor: string,
    accountId: string,
    now: Date,
  ) => ReturnType<typeof selectCheapPintPing>;
  send: (
    token: string,
    payload: NonNullable<Awaited<ReturnType<typeof selectCheapPintPing>>>,
  ) => Promise<{ sent: number; pruned: number; errors: number }>;
  /** Stamp the row before the send. False means another run already took it. */
  claim: (ownerActor: string, sentAt: string) => Promise<boolean>;
  /** Clear our stamp after a send that reported no delivery. */
  release: (ownerActor: string, claimedAt: string) => Promise<void>;
};

export function defaultCheapPintPingDispatchDeps(): CheapPintPingDispatchDeps {
  return {
    listSendReady: () => stepOutNudgeStore().listCheapPintSendReady(),
    resolveAccountId: accountIdForOwnerActor,
    selectPayload: (ownerActor, accountId, now) => {
      void now; // Signature carries dispatch clock; selection reads live index.
      return selectCheapPintPing(ownerActor, accountId);
    },
    send: async (token, payload) => {
      const result = await sendCheapPintPing(token, payload);
      return {
        sent: result.sent,
        pruned: result.pruned,
        errors: result.errors,
      };
    },
    claim: (ownerActor, sentAt) =>
      stepOutNudgeStore().claimCheapPintSend(ownerActor, sentAt),
    release: (ownerActor, claimedAt) =>
      stepOutNudgeStore().releaseCheapPintSendClaim(ownerActor, claimedAt),
  };
}

const BATCH_SIZE = 25;

export async function dispatchCheapPintPings(
  now: Date = new Date(),
  deps: CheapPintPingDispatchDeps = defaultCheapPintPingDispatchDeps(),
): Promise<CheapPintPingDispatchSummary> {
  const summary: CheapPintPingDispatchSummary = {
    considered: 0,
    sent: 0,
    skippedWindow: 0,
    skippedNotReady: 0,
    skippedNoGroundedPint: 0,
    skippedNoAccount: 0,
    pruned: 0,
    errors: 0,
  };

  if (!isCheapPintPingWindow(now)) {
    summary.skippedWindow = 1;
    return summary;
  }

  const ready = await deps.listSendReady();
  for (let i = 0; i < ready.length; i += BATCH_SIZE) {
    const batch = ready.slice(i, i + BATCH_SIZE);
    for (const pref of batch) {
      summary.considered += 1;
      const view = cheapPintPrefView(pref);
      if (!canSendCheapPint(view, now)) {
        summary.skippedNotReady += 1;
        continue;
      }
      if (!pref.subscriptionToken) {
        summary.skippedNotReady += 1;
        continue;
      }
      const accountId = await deps.resolveAccountId(pref.ownerActor);
      if (!accountId) {
        summary.skippedNoAccount += 1;
        continue;
      }
      const payload = await deps.selectPayload(pref.ownerActor, accountId, now);
      if (!payload) {
        summary.skippedNoGroundedPint += 1;
        continue;
      }
      // Claim before the send. A cron event can arrive twice and two runs can list
      // the same row, so only the run that wins the stamp sends.
      const claimedAt = now.toISOString();
      let won: boolean;
      try {
        won = await deps.claim(pref.ownerActor, claimedAt);
      } catch {
        summary.errors += 1;
        continue;
      }
      if (!won) {
        summary.skippedNotReady += 1;
        continue;
      }
      let result: { sent: number; pruned: number; errors: number };
      try {
        result = await deps.send(pref.subscriptionToken, payload);
      } catch {
        // The push may have gone out, so keep the claim: a missed ping beats a second one.
        summary.errors += 1;
        continue;
      }
      summary.sent += result.sent;
      summary.pruned += result.pruned;
      summary.errors += result.errors;
      if (result.sent === 0) {
        // Nothing was delivered, so free the row for the next weekday as before.
        // If the release fails the claim stays and the ping is missed, not doubled.
        try {
          await deps.release(pref.ownerActor, claimedAt);
        } catch {
          summary.errors += 1;
        }
      }
    }
  }

  return summary;
}
