"use client";

import { withAccountPushLifecycleLock } from "@/lib/accountPushLifecycle";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { registerWebPush } from "@/lib/webPush";

export type PersonalizedPushOptInDeps = {
  register: (signal?: AbortSignal) => Promise<string | null>;
  readCurrentUserId: () => Promise<string | null>;
  fetchImpl: typeof fetch;
};

export type PersonalizedPushOptInOutcome =
  | { status: "saved"; response: Response }
  | { status: "account_changed" }
  | { status: "cancelled" }
  | { status: "registration_failed" }
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
  };
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
  try {
    return await withAccountPushLifecycleLock(async () => {
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

      try {
        const response = await deps.fetchImpl(input.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.account.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input.body(token)),
          cache: "no-store",
        });
        return { status: "saved", response };
      } catch {
        return { status: "request_failed" };
      }
    });
  } catch {
    return { status: "request_failed" };
  }
}
