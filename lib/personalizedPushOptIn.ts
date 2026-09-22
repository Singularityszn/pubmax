"use client";

import {
  clearPendingAccountPushBind,
  commitActiveAccountPushBind,
  markPendingAccountPushBind,
  supportsOriginWideAccountPushLock,
  withAccountPushLifecycleLock,
  type PendingAccountPushBind,
} from "@/lib/accountPushLifecycle";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { registerWebPush, unsubscribeWebPushToken } from "@/lib/webPush";
import { shouldPreservePublicWebPushToken } from "@/lib/webPushRegistrationState";

const PERSONALIZED_BIND_RESPONSE_CEILING_MS = 10_000;
const PERSONALIZED_LOCK_ACQUIRE_CEILING_MS = 2_000;

export type PersonalizedPushOptInDeps = {
  register: (signal?: AbortSignal) => Promise<string | null>;
  readCurrentUserId: () => Promise<string | null>;
  fetchImpl: typeof fetch;
  supportsCrossTabLock: () => boolean;
  runExclusive: <T>(work: () => Promise<T>) => Promise<T>;
  createRevision: () => string | null;
  markPendingBind: (pending: PendingAccountPushBind) => boolean;
  clearPendingBind: (pending: PendingAccountPushBind) => void;
  commitActiveBind: (pending: PendingAccountPushBind) => boolean;
  retireToken: (token: string) => Promise<boolean>;
  waitForBindCeiling: () => Promise<void>;
  preservePublicToken: (token: string) => boolean;
};

export type PersonalizedPushOptInOutcome =
  | { status: "saved"; response: Response }
  | { status: "account_changed" }
  | { status: "coordination_unavailable" }
  | { status: "cancelled" }
  | { status: "registration_failed" }
  | { status: "binding_timed_out" }
  | { status: "request_failed" };

async function readCurrentUserId(): Promise<string | null> {
  const supabase = await ensureSupabaseBrowser().catch(() => null);
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

function browserDeps(): PersonalizedPushOptInDeps {
  return {
    register: registerWebPush,
    readCurrentUserId,
    fetchImpl: fetch,
    supportsCrossTabLock: supportsOriginWideAccountPushLock,
    runExclusive: (work) => withAccountPushLifecycleLock(work, {
      requireOriginWide: true,
      acquireTimeoutMs: PERSONALIZED_LOCK_ACQUIRE_CEILING_MS,
    }),
    createRevision: () => {
      try {
        return globalThis.crypto.randomUUID();
      } catch {
        return null;
      }
    },
    markPendingBind: markPendingAccountPushBind,
    clearPendingBind: clearPendingAccountPushBind,
    commitActiveBind: commitActiveAccountPushBind,
    retireToken: unsubscribeWebPushToken,
    waitForBindCeiling: () => new Promise<void>((resolve) => {
      setTimeout(resolve, PERSONALIZED_BIND_RESPONSE_CEILING_MS);
    }),
    preservePublicToken: shouldPreservePublicWebPushToken,
  };
}

async function compensateLateBind(
  account: { accessToken: string },
  pending: PendingAccountPushBind,
  deps: PersonalizedPushOptInDeps,
): Promise<boolean> {
  try {
    const response = await deps.fetchImpl("/api/push-tokens/account", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${account.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: pending.subscriptionToken,
        preservePublicToken: deps.preservePublicToken(pending.subscriptionToken),
      }),
      cache: "no-store",
      keepalive: true,
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Create and bind a personalized browser subscription as one account-lifecycle
 * operation. Identity is checked on both sides of subscription creation, while
 * the bind request keeps the initiating bearer and is awaited to completion.
 */
export async function enablePersonalizedWebPush(
  input: {
    account: { userId: string; accessToken: string };
    endpoint: string;
    body: (token: string) => Record<string, unknown>;
    signal?: AbortSignal;
  },
  deps: PersonalizedPushOptInDeps = browserDeps(),
): Promise<PersonalizedPushOptInOutcome> {
  if (!deps.supportsCrossTabLock()) {
    return { status: "coordination_unavailable" };
  }
  const revision = deps.createRevision();
  if (!revision) return { status: "coordination_unavailable" };
  let lockEntered = false;
  try {
    return await deps.runExclusive(async () => {
      lockEntered = true;
      if (input.signal?.aborted) return { status: "cancelled" };
      const currentUserId = await deps.readCurrentUserId().catch(() => null);
      if (currentUserId !== input.account.userId) {
        return { status: "account_changed" };
      }

      const token = await deps.register(input.signal).catch(() => null);
      if (input.signal?.aborted) return { status: "cancelled" };
      if (!token) return { status: "registration_failed" };
      const confirmedUserId = await deps.readCurrentUserId().catch(() => null);
      if (confirmedUserId !== input.account.userId) {
        return { status: "account_changed" };
      }
      const pending: PendingAccountPushBind = {
        version: 1,
        revision,
        ownerId: input.account.userId,
        subscriptionToken: token,
      };
      if (!deps.markPendingBind(pending)) {
        return { status: "coordination_unavailable" };
      }

      const bindRequest = Promise.resolve().then(() =>
        deps.fetchImpl(input.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.account.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input.body(token)),
          cache: "no-store",
        }),
      );
      const settledBind = bindRequest.then(
        (response) => ({ status: "response" as const, response }),
        () => ({ status: "error" as const }),
      );
      const settlement = await Promise.race([
        settledBind,
        deps.waitForBindCeiling().then(() => ({ status: "timeout" as const })),
      ]);
      if (settlement.status === "response") {
        if (settlement.response.ok && !deps.commitActiveBind(pending)) {
          const retired = await deps.retireToken(token).catch(() => false);
          if (retired) deps.clearPendingBind(pending);
          void compensateLateBind(input.account, pending, deps);
          return { status: "coordination_unavailable" };
        }
        deps.clearPendingBind(pending);
        return { status: "saved", response: settlement.response };
      }

      const retired = await deps.retireToken(token).catch(() => false);
      if (retired) deps.clearPendingBind(pending);
      const compensate = async (retryPhysicalRetirement: boolean) => {
        await compensateLateBind(input.account, pending, deps);
        if (
          retryPhysicalRetirement &&
          await deps.retireToken(token).catch(() => false)
        ) {
          deps.clearPendingBind(pending);
        }
      };
      if (settlement.status === "timeout") {
        void compensate(false);
        void settledBind.then(() => compensate(true));
        return { status: "binding_timed_out" };
      }
      void compensate(true);
      return { status: "request_failed" };
    });
  } catch {
    return lockEntered
      ? { status: "request_failed" }
      : { status: "coordination_unavailable" };
  }
}
