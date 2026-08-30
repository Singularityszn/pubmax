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

function accountBoundActionSignal(
  callerSignal?: AbortSignal,
): Readonly<{ signal: AbortSignal; bind: () => void; dispose: () => void }> {
  const controller = new AbortController();
  let accountRevision = authActionState.status === "unknown"
    ? null
    : readProviderIdentityRevision();
  const abortForAccountChange = (): void => {
    if (
      accountRevision !== null &&
      readProviderIdentityRevision() !== accountRevision
    ) {
      controller.abort();
    }
  };
  const abortForCaller = (): void => controller.abort();
  const unsubscribeAccountRevision = subscribeProviderIdentityRevision(
    abortForAccountChange,
  );
  callerSignal?.addEventListener("abort", abortForCaller, { once: true });
  abortForAccountChange();
  if (callerSignal?.aborted) abortForCaller();
  return {
    signal: controller.signal,
    bind: () => {
      accountRevision ??= readProviderIdentityRevision();
      abortForAccountChange();
    },
    dispose: () => {
      unsubscribeAccountRevision();
      callerSignal?.removeEventListener("abort", abortForCaller);
    },
  };
}

type AccountBoundResponseLifecycle = Readonly<{
  signal: AbortSignal;
  retain: () => () => void;
}>;

const responseBodyMethods = new Set<PropertyKey>([
  "arrayBuffer",
  "blob",
  "bytes",
  "formData",
  "json",
  "text",
]);

const accountBoundResponseFinalizer = typeof FinalizationRegistry === "undefined"
  ? null
  : new FinalizationRegistry<() => void>((release) => release());

function once(callback: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    callback();
  };
}

function accountBoundResponseLifecycle(
  action: Readonly<{ signal: AbortSignal; dispose: () => void }>,
): AccountBoundResponseLifecycle {
  let retained = 0;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    action.signal.removeEventListener("abort", dispose);
    action.dispose();
  };
  action.signal.addEventListener("abort", dispose, { once: true });
  if (action.signal.aborted) dispose();

  return {
    signal: action.signal,
    retain: () => {
      if (disposed) return () => undefined;
      retained += 1;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        retained -= 1;
        if (retained === 0) dispose();
      };
    },
  };
}

/** Keep one response branch bound until its body finishes or is cancelled. */
function accountBoundResponseBody(
  source: ReadableStream<Uint8Array>,
  lifecycle: AccountBoundResponseLifecycle,
  release: () => void,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    lifecycle.signal.removeEventListener("abort", onAbort);
    release();
  };
  const onAbort = (): void => {
    if (settled) return;
    controller?.error(abortError());
    void (reader ? reader.cancel() : source.cancel()).catch(() => undefined);
    settle();
  };

  return new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      lifecycle.signal.addEventListener("abort", onAbort, { once: true });
      if (lifecycle.signal.aborted) onAbort();
    },
    async pull(nextController) {
      if (settled) return;
      try {
        reader ??= source.getReader();
        const next = await reader.read();
        if (lifecycle.signal.aborted) throw abortError();
        if (next.done) {
          nextController.close();
          settle();
          return;
        }
        nextController.enqueue(next.value);
      } catch (error) {
        nextController.error(error);
        settle();
      }
    },
    async cancel(reason) {
      try {
        if (reader) await reader.cancel(reason);
        else await source.cancel(reason);
      } finally {
        settle();
      }
    },
  });
}

/**
 * Preserve the fetch Response object while owning its body lifecycle.
 * Clones add leases. Explicit reads and cancellation release them. A finalizer
 * releases a response that its caller abandons without reading or cancelling.
 */
function accountBoundResponse(
  response: Response,
  lifecycle: AccountBoundResponseLifecycle,
): Response {
  const release = lifecycle.retain();
  if (!response.body) {
    release();
    return response;
  }

  let wrappedBody: ReadableStream<Uint8Array> | null = null;
  const finalizerToken = {};
  const releaseOnce = once(release);
  const settle = (): void => {
    accountBoundResponseFinalizer?.unregister(finalizerToken);
    releaseOnce();
  };
  const proxy = new Proxy(response, {
    get(target, property) {
      if (property === "body") {
        if (!wrappedBody) {
          wrappedBody = accountBoundResponseBody(
            target.body as ReadableStream<Uint8Array>,
            lifecycle,
            settle,
          );
          accountBoundResponseFinalizer?.unregister(finalizerToken);
          accountBoundResponseFinalizer?.register(wrappedBody, releaseOnce, finalizerToken);
        }
        return wrappedBody;
      }
      if (property === "clone") {
        return (): Response => accountBoundResponse(target.clone(), lifecycle);
      }
      const value = Reflect.get(target, property, target) as unknown;
      if (responseBodyMethods.has(property) && typeof value === "function") {
        return async (...args: unknown[]): Promise<unknown> => {
          try {
            if (lifecycle.signal.aborted) throw abortError();
            const body = await Reflect.apply(value, target, args) as unknown;
            if (lifecycle.signal.aborted) throw abortError();
            return body;
          } finally {
            settle();
          }
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  accountBoundResponseFinalizer?.register(proxy, releaseOnce, finalizerToken);
  return proxy;
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

function readTokenBefore(deadline: number, signal?: AbortSignal): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve(null);
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (token: string | null, error?: DOMException): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(token);
    };
    const onAbort = (): void => finish(null, abortError());
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

/**
 * Fetch for a request whose server action requires the signed-in account.
 * While auth is unresolved, this waits for the existing identity signal and
 * retries the browser session read within one bounded two-second window.
 * Once auth is usable, the action binds to that provider identity revision.
 * An account change aborts both token lookup and an active network request.
 * Signed-in requests never fall through to an anonymous network round-trip.
 */
export async function authedActionFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const action = accountBoundActionSignal(init.signal ?? undefined);
  try {
    const deadline = Date.now() + AUTH_ACTION_TOKEN_TIMEOUT_MS;
    await waitForAuthActionReadiness(deadline, action.signal);
    action.bind();

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
      return accountBoundResponse(response, accountBoundResponseLifecycle(action));
    }

    if (authActionState.status !== "signed-out") {
      throw new AuthActionSessionError();
    }
    const response = await fetch(input, { ...init, headers, signal: action.signal });
    return accountBoundResponse(response, accountBoundResponseLifecycle(action));
  } catch (error) {
    action.dispose();
    throw error;
  }
}
