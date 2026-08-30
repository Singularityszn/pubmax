// Browser fetch helper that attaches the Supabase access token when signed in.
// Wave I2: ownership-sensitive social reads/writes (messages, notifications)
// must send `Authorization: Bearer` so gateHandleAction / resolveMessageHandle
// can verify the caller. Anonymous requests remain valid for unlinked demo
// handles — matching ProfileEditor's pattern.

import { getAccessToken } from "@/lib/authClient";
import {
  readProviderIdentityRevision,
  subscribeProviderIdentityRevision,
} from "@/lib/authProviderRevision";

export const AUTH_ACTION_SESSION_ERROR_MESSAGE = "Still waking your session - try again.";

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

function abortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined ? abortError() : signal.reason;
}

type AccountBoundAction = Readonly<{
  signal: AbortSignal;
  bind: () => number;
  dispose: () => void;
}>;

function accountBoundActionSignal(
  input: RequestInfo | URL,
  initSignal?: AbortSignal,
): AccountBoundAction {
  const controller = new AbortController();
  let accountRevision = authActionState.status === "unknown"
    ? null
    : readProviderIdentityRevision();
  let disposed = false;
  const abortForAccountChange = (): void => {
    if (
      accountRevision !== null &&
      readProviderIdentityRevision() !== accountRevision
    ) {
      controller.abort(abortError());
    }
  };
  const unsubscribeAccountRevision = subscribeProviderIdentityRevision(
    abortForAccountChange,
  );
  const requestSignal = typeof Request !== "undefined" && input instanceof Request
    ? input.signal
    : undefined;
  const callerSignals = [...new Set(
    [requestSignal, initSignal].filter((signal): signal is AbortSignal => Boolean(signal)),
  )];
  const callerListeners = callerSignals.map((signal) => {
    const listener = (): void => controller.abort(abortReason(signal));
    signal.addEventListener("abort", listener, { once: true });
    if (signal.aborted) listener();
    return { signal, listener };
  });
  abortForAccountChange();
  return {
    signal: controller.signal,
    bind: () => {
      accountRevision ??= readProviderIdentityRevision();
      abortForAccountChange();
      return accountRevision;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeAccountRevision();
      for (const { signal, listener } of callerListeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

function waitForAuthActionReadiness(deadline: number, signal?: AbortSignal): Promise<void> {
  if (
    authActionState.status === "signed-out" ||
    (authActionState.status === "signed-in" && authActionState.identityResolved)
  ) {
    return Promise.resolve();
  }
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    const finish = (error?: unknown): void => {
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
    const onAbort = (): void => finish(abortReason(signal as AbortSignal));
    authActionStateListeners.add(check);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
    check();
  });
}

function waitForTokenRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function readTokenBefore(deadline: number, signal?: AbortSignal): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve(null);
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (token: string | null, error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(token);
    };
    const onAbort = (): void => finish(null, abortReason(signal as AbortSignal));
    const timeout = setTimeout(() => finish(null), remaining);
    signal?.addEventListener("abort", onAbort, { once: true });
    void getAccessToken()
      .then((token) => finish(token))
      .catch(() => finish(null));
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

type ActiveAuthActionResponse = Readonly<{
  action: AccountBoundAction;
  accountRevision: number;
  response: Response;
}>;

async function activeAuthActionFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<ActiveAuthActionResponse> {
  const action = accountBoundActionSignal(input, init.signal ?? undefined);
  try {
    const deadline = Date.now() + AUTH_ACTION_TOKEN_TIMEOUT_MS;
    await waitForAuthActionReadiness(deadline, action.signal);
    const accountRevision = action.bind();

    let token: string | null = null;
    for (const delayMs of AUTH_ACTION_TOKEN_RETRY_DELAYS_MS) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      if (delayMs > 0) {
        await waitForTokenRetry(Math.min(delayMs, remaining), action.signal);
      }
      if (Date.now() >= deadline) break;
      token = await readTokenBefore(deadline, action.signal);
      if (token || Date.now() >= deadline) break;
    }

    const headers = new Headers(init.headers);
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(input, { ...init, headers, signal: action.signal });
      return { action, accountRevision, response };
    }

    if (authActionState.status !== "signed-out") {
      throw new AuthActionSessionError();
    }
    const response = await fetch(input, { ...init, headers, signal: action.signal });
    return { action, accountRevision, response };
  } catch (error) {
    action.dispose();
    throw error;
  }
}

/**
 * Fetch for a request whose server action requires the signed-in account.
 * While auth is unresolved, this waits for the existing identity signal and
 * retries the browser session read within one bounded two-second window.
 * Once auth is usable, token lookup and the active fetch bind to that provider
 * identity revision. Both Request and init abort signals remain authoritative.
 * The returned value is the native Response and owns no retained listeners.
 */
export async function authedActionFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const { action, response } = await activeAuthActionFetch(input, init);
  action.dispose();
  return response;
}

export type AuthedActionJson<T> = Readonly<{
  response: Response;
  body: T;
}>;

/** Fetch and parse account-scoped JSON under one provider identity revision. */
export async function authedActionJson<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<AuthedActionJson<T>> {
  const { action, accountRevision, response } = await activeAuthActionFetch(input, init);
  try {
    const body = (await response.json()) as T;
    if (action.signal.aborted) throw abortReason(action.signal);
    if (readProviderIdentityRevision() !== accountRevision) throw abortError();
    return { response, body };
  } finally {
    action.dispose();
  }
}
