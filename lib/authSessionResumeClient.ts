// Browser side of the durable sign-in resume cookie (lib/authSessionResume.ts
// owns the why; app/api/auth/session is the server). AuthProvider calls these:
// persist after every sign-in / token refresh, redeem when the browser boots
// with no local session, clear on sign-out. All best-effort and non-throwing —
// the cookie is a safety net, never a gate on the app.

import {
  AUTH_RESUME_GENERATION_COOKIE,
  AUTH_RESUME_GENERATION_MAX_AGE_SECONDS,
  SIGNED_OUT_GENERATION_PREFIX,
  accessTokenSubject,
  accountResumeGeneration,
  newResumeGeneration,
  resumeGenerationAdmits,
  resumeGenerationFromHeader,
} from "@/lib/authSessionResume";
import type { MagicLinkResult } from "@/lib/passwordlessAuth";

const ENDPOINT = "/api/auth/session";
const REQUEST_TIMEOUT_MS = 8_000;

type FetchLike = typeof fetch;

/** The resume generation this document can see now, or null. */
export function readResumeGeneration(): string | null {
  if (typeof document === "undefined") return null;
  return resumeGenerationFromHeader(document.cookie);
}

function writeResumeGeneration(value: string | null): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const maxAge = value === null ? 0 : AUTH_RESUME_GENERATION_MAX_AGE_SECONDS;
  document.cookie =
    `${AUTH_RESUME_GENERATION_COOKIE}=${value ?? ""}` +
    `; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/**
 * Whether a session for `userId` belongs on this device now. The generation
 * names the account the last sign-in the person asked for produced, and an
 * explicit sign-out ends it, so a session any other path delivers later - a
 * delayed SDK adoption, another tab, a slow response - is neither shown nor
 * used to authorize a request.
 */
export function sessionAccountAdmitted(userId: string): boolean {
  return resumeGenerationAdmits(readResumeGeneration(), userId);
}

export type SignInCommit = { written: string; previous: string | null };

/**
 * The commit point of a sign-in the person asked for (a password sign-in, an
 * auth callback, an account switch), taken just before the session is
 * installed. `baseline` is the generation the action began under; if another
 * sign-in or a sign-out has moved it since, this action is stale and must not
 * install anything. Otherwise it starts the generation for the account the
 * token names, so every persist from here on - the provider's own and the
 * action's - carries it.
 */
export function commitSignIn(baseline: string | null, accessToken: string): SignInCommit | null {
  if (readResumeGeneration() !== baseline) return null;
  const userId = accessTokenSubject(accessToken);
  const written = userId ? accountResumeGeneration(userId) : newResumeGeneration();
  writeResumeGeneration(written);
  return { written, previous: baseline };
}

/** A committed sign-in failed to install: put back what it replaced, unless something newer has. */
export function rollbackSignIn(commit: SignInCommit): void {
  if (readResumeGeneration() === commit.written) writeResumeGeneration(commit.previous);
}


export type ResumeHint = { maskedEmail: string | null };

export type ResumeHintReadOutcome =
  | { status: "present"; hint: ResumeHint }
  | { status: "absent" }
  | { status: "unavailable" };

export type RedeemResult =
  | { status: "restored"; session: { access_token: string; refresh_token: string } }
  | { status: "expired"; maskedEmail: string | null }
  | { status: "none" }
  | { status: "banned"; message: string }
  | { status: "unavailable" };

function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

/** Cheap boot probe: is there a resume cookie on this device at all? */
export async function fetchResumeHint(
  fetchImpl: FetchLike = fetch,
): Promise<ResumeHintReadOutcome> {
  try {
    const response = await fetchImpl(ENDPOINT, {
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!response.ok) return { status: "unavailable" };
    const body = (await response.json()) as { hint?: unknown };
    if (body.hint === null) return { status: "absent" };
    if (
      !body.hint ||
      typeof body.hint !== "object" ||
      Array.isArray(body.hint)
    ) {
      return { status: "unavailable" };
    }
    if (!Object.prototype.hasOwnProperty.call(body.hint, "maskedEmail")) {
      return { status: "unavailable" };
    }
    const masked = (body.hint as { maskedEmail: unknown }).maskedEmail;
    if (masked !== null && typeof masked !== "string") {
      return { status: "unavailable" };
    }
    return {
      status: "present",
      hint: { maskedEmail: masked },
    };
  } catch {
    return { status: "unavailable" };
  }
}

export type PersistResumeOutcome = "stored" | "unauthenticated" | "unavailable";

/**
 * Store the session's refresh token in the durable HttpOnly cookie.
 *
 * The outcome is returned rather than swallowed: a persist refused as
 * unauthenticated leaves the device with NO durable session, and a caller
 * holding a token the server would not verify can ask for a fresh one and try
 * again. Silence here read as success and is why a device could look signed in
 * all session and come back cold.
 */
export async function persistSessionForResume(
  session: { access_token: string; refresh_token: string },
  fetchImpl: FetchLike = fetch,
): Promise<PersistResumeOutcome> {
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: "persist",
        refreshToken: session.refresh_token,
      }),
      // Sign-in often navigates immediately (handle-claim redirect); keepalive
      // lets the cookie write outlive the page that started it.
      keepalive: true,
      signal: timeoutSignal(),
    });
    if (response.ok) return "stored";
    return response.status === 401 ? "unauthenticated" : "unavailable";
  } catch {
    // Best-effort: the next refresh persists again.
    return "unavailable";
  }
}

/** Exchange the durable cookie for a fresh session after storage loss. */
export async function redeemPersistedSession(
  fetchImpl: FetchLike = fetch,
): Promise<RedeemResult> {
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "redeem" }),
      signal: timeoutSignal(),
    });
    if (!response.ok) return { status: "unavailable" };
    const body = (await response.json()) as Record<string, unknown>;
    if (body.status === "restored" && typeof body.session === "object" && body.session) {
      const session = body.session as Record<string, unknown>;
      if (
        typeof session.access_token === "string" &&
        typeof session.refresh_token === "string"
      ) {
        return {
          status: "restored",
          session: {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          },
        };
      }
      return { status: "unavailable" };
    }
    if (body.status === "expired") {
      return {
        status: "expired",
        maskedEmail:
          typeof body.maskedEmail === "string" ? body.maskedEmail : null,
      };
    }
    if (body.status === "banned" && typeof body.message === "string") {
      return { status: "banned", message: body.message };
    }
    if (body.status === "none") return { status: "none" };
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Ask the server to email a sign-in link to the cookie's saved address. */
export async function requestResumeLink(
  callbackUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<MagicLinkResult> {
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume", callbackUrl }),
      signal: timeoutSignal(),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok && body.status === "sent" && typeof body.message === "string") {
      return { status: "sent", message: body.message };
    }
    const message =
      typeof body.error === "string"
        ? body.error
        : "We could not send a sign-in link right now. Try again shortly.";
    return {
      status: response.status === 429 ? "rate_limited" : "error",
      message,
    };
  } catch {
    return {
      status: "error",
      message: "We could not send a sign-in link right now. Try again shortly.",
    };
  }
}

/**
 * Remove the durable cookie (sign-out). The signed-out generation is written
 * here first, with no network, so the old cookie stops counting on this device
 * even if the DELETE below never arrives.
 */
export async function clearPersistedSession(
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  writeResumeGeneration(newResumeGeneration(SIGNED_OUT_GENERATION_PREFIX));
  try {
    await fetchImpl(ENDPOINT, { method: "DELETE", signal: timeoutSignal() });
  } catch {
    // Best-effort: an orphaned cookie dies at its Max-Age.
  }
}
