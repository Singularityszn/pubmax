// Browser fetch helper that attaches the Supabase access token when signed in.
// Wave I2: ownership-sensitive social reads/writes (messages, notifications)
// must send `Authorization: Bearer` so gateHandleAction / resolveMessageHandle
// can verify the caller. Anonymous requests remain valid for unlinked demo
// handles — matching ProfileEditor's pattern.

import { getAccessToken } from "@/lib/authClient";

export const AUTH_ACTION_SESSION_ERROR_MESSAGE = "Still waking your session. Try again.";

export type AuthActionState = Readonly<{
  status: "unknown" | "signed-out" | "signed-in";
  /** The existing AuthProvider identityResolved signal. */
  identityResolved: boolean;
}>;

const AUTH_ACTION_TOKEN_TIMEOUT_MS = 2_000;
const AUTH_ACTION_TOKEN_RETRY_DELAYS_MS = [0, 50, 150, 350, 650, 800] as const;

let authActionState: AuthActionState = {
  status: "unknown",
  identityResolved: false,
};
const authActionStateListeners = new Set<() => void>();

/** Publishes the existing AuthProvider state to non-React request callers. */
export function publishAuthActionState(next: AuthActionState): void {
  authActionState = next;
  for (const listener of authActionStateListeners) listener();
}

export class AuthActionSessionError extends Error {
  readonly code = "AUTH_SESSION_WAKING" as const;

  constructor() {
    super(AUTH_ACTION_SESSION_ERROR_MESSAGE);
    this.name = "AuthActionSessionError";
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function waitForAuthActionReadiness(deadline: number, signal?: AbortSignal): Promise<void> {
  if (
    authActionState.status === "signed-out" ||
    (authActionState.status === "signed-in" && authActionState.identityResolved)
  ) {
    return Promise.resolve();
  }
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      authActionStateListeners.delete(check);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const check = (): void => {
      if (
        authActionState.status === "signed-out" ||
        (authActionState.status === "signed-in" && authActionState.identityResolved)
      ) {
        finish();
      }
    };
    const onAbort = (): void => finish(abortError());
    authActionStateListeners.add(check);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
    check();
  });
}

function waitForTokenRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function readTokenBefore(deadline: number): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolve(null);
    }, remaining);
    void getAccessToken()
      .then((token) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(token);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(null);
      });
  });
}

/**
 * Like `fetch`, but merges `Authorization: Bearer <jwt>` when a session exists.
 * Public reads may use this graceful transport when anonymous fallback is valid.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  try {
    const token = await getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  } catch {
    // Signed-out / storage blocked — proceed anonymously.
  }
  return fetch(input, { ...init, headers });
}

/**
 * Fetch for a request whose server action requires the signed-in account.
 * While auth is unresolved, this waits for the existing identity signal and
 * retries the browser session read within one bounded two-second window.
 * Signed-in requests never fall through to an anonymous network round-trip.
 */
export async function authedActionFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const deadline = Date.now() + AUTH_ACTION_TOKEN_TIMEOUT_MS;
  await waitForAuthActionReadiness(deadline, init.signal ?? undefined);

  let token: string | null = null;
  for (const delayMs of AUTH_ACTION_TOKEN_RETRY_DELAYS_MS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (delayMs > 0) {
      await waitForTokenRetry(Math.min(delayMs, remaining), init.signal ?? undefined);
    }
    if (Date.now() >= deadline) break;
    token = await readTokenBefore(deadline);
    if (token || Date.now() >= deadline) break;
  }

  const headers = new Headers(init.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }

  if (authActionState.status !== "signed-out") {
    throw new AuthActionSessionError();
  }
  return fetch(input, { ...init, headers });
}
