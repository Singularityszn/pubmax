import type { Session } from "@supabase/supabase-js";

import {
  fetchResumeHint,
  redeemPersistedSession,
  type RedeemResult,
  type ResumeHint,
} from "@/lib/authSessionResumeClient";

export type BrowserAuthSession = {
  getSession: () => Promise<{ data: { session: Session | null } }>;
  setSession: (session: {
    access_token: string;
    refresh_token: string;
  }) => Promise<{ error: unknown | null }>;
};

export type AuthSessionBootstrapOutcome =
  | { status: "local"; session: Session }
  | {
      status: "restored";
      session: { access_token: string; refresh_token: string };
    }
  | { status: "expired"; maskedEmail: string | null }
  | { status: "none" }
  | { status: "unavailable" };

export type AuthSessionBootstrapDeps = {
  readHint?: () => Promise<ResumeHint | null>;
  redeem?: () => Promise<RedeemResult>;
};

/** Two bounded same-origin resume calls can run on a slow mobile connection. */
export const AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS = 20_000;

/**
 * Resolve browser auth before the provider publishes a signed-out state.
 *
 * The local Supabase session is the fast path. A missing local session is not
 * proof of sign-out because iOS Safari and browser storage pressure can evict
 * it. The durable cookie path must therefore settle before the caller clears
 * its loading state.
 */
export async function bootstrapAuthSession(
  auth: BrowserAuthSession,
  deps: AuthSessionBootstrapDeps = {},
): Promise<AuthSessionBootstrapOutcome> {
  let localSession: Session | null;
  try {
    localSession = (await auth.getSession()).data.session ?? null;
  } catch {
    localSession = null;
  }

  if (localSession) return { status: "local", session: localSession };

  const readHint = deps.readHint ?? fetchResumeHint;
  const redeem = deps.redeem ?? redeemPersistedSession;
  let hint: ResumeHint | null;
  try {
    hint = await readHint();
  } catch {
    return { status: "unavailable" };
  }
  if (!hint) return { status: "none" };

  let restored: RedeemResult;
  try {
    restored = await redeem();
  } catch {
    return { status: "unavailable" };
  }
  if (restored.status !== "restored") return restored;

  try {
    const result = await auth.setSession(restored.session);
    if (result.error) return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
  return { status: "restored", session: restored.session };
}
