// Browser-only continuity for the push identity join. Delivery material is
// retained in volatile module memory after the anonymous registration succeeds,
// then presented only to server-authorised account/Plan join routes. No user id
// or member id is ever stored or sent by this module. Raw APNs/Web delivery
// material is never copied into localStorage or sessionStorage: Web can recover
// its subscription from the service worker and native asks APNs to re-emit an
// already-permitted token after a WebView restart.

import { getAccessToken } from "@/lib/authClient";
import { readActivePlan } from "@/lib/activePlan";
import { nextPushIdentityMutation, type PushIdentityMutation } from "@/lib/pushInstallation";
import { pushFetch, withPushTimeout } from "@/lib/pushTimeout";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

export type ClientPushRegistration = {
  token: string;
  platform: "ios" | "android" | "web";
};

export type PushRegistrationRecovery =
  | { status: "registration"; registration: ClientPushRegistration }
  | { status: "none" | "failed" };

export type AccountPushMutationResult =
  | { ok: true; status: "linked" | "unlinked" | "no_registration" }
  | { ok: false; status: "stopped" | "auth_required" | "conflict" | "retryable" };

export type AccountPushLifecycleStatus =
  | "idle"
  | "linking"
  | "retrying"
  | "linked"
  | "unlinking"
  | "unlinked"
  | "error"
  | "stopped";

const REGISTRATION_EVENT = "pubmax:push-registration";
let volatileRegistration: ClientPushRegistration | null = null;
let accountOperationTail: Promise<void> = Promise.resolve();
let accountJoinsAllowed = true;
let accountLifecycleGeneration = 0;
let accountLifecycleStatus: AccountPushLifecycleStatus = "idle";
const lifecycleListeners = new Set<() => void>();
const retryCancels = new Set<() => void>();
const ACCOUNT_RETRY_DELAYS_MS = [75, 225] as const;
const planOperationTails = new Map<string, Promise<void>>();

function nextMutation(): PushIdentityMutation | null {
  try {
    return nextPushIdentityMutation();
  } catch {
    return null;
  }
}

function setAccountLifecycleStatus(status: AccountPushLifecycleStatus): void {
  accountLifecycleStatus = status;
  for (const listener of lifecycleListeners) listener();
}

export function getAccountPushLifecycleStatus(): AccountPushLifecycleStatus {
  return accountLifecycleStatus;
}

export function subscribeAccountPushLifecycle(listener: () => void): () => void {
  lifecycleListeners.add(listener);
  return () => lifecycleListeners.delete(listener);
}

function enqueueAccountOperation<T>(operation: () => Promise<T>): Promise<T> {
  const queued = accountOperationTail.then(operation, operation);
  accountOperationTail = queued.then(() => undefined, () => undefined);
  return queued;
}

function enqueuePlanOperation<T>(planId: string, operation: () => Promise<T>): Promise<T> {
  const previous = planOperationTails.get(planId) ?? Promise.resolve();
  const queued = previous.then(operation, operation);
  const tail = queued.then(() => undefined, () => undefined);
  planOperationTails.set(planId, tail);
  void tail.finally(() => {
    if (planOperationTails.get(planId) === tail) planOperationTails.delete(planId);
  });
  return queued;
}

function retryDelay(ms: number, generation: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      retryCancels.delete(cancel);
      resolve(accountJoinsAllowed && accountLifecycleGeneration === generation);
    }, ms);
    const cancel = () => {
      clearTimeout(timer);
      retryCancels.delete(cancel);
      resolve(false);
    };
    retryCancels.add(cancel);
  });
}

function unconditionalRetryDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Re-enable joins only after a verified sign-in/session restoration. */
export function resumeAccountPushJoins(): void {
  accountLifecycleGeneration += 1;
  accountJoinsAllowed = true;
  setAccountLifecycleStatus("idle");
}

/** Synchronous logout barrier: stops new joins and cancels retry waiters. An
 * issued fetch gets its bounded attempt; then the higher-version DELETE runs.
 * Server watermarks keep that unlink authoritative even if an aborted POST
 * nevertheless completes remotely. */
export function stopAccountPushJoins(): void {
  accountLifecycleGeneration += 1;
  accountJoinsAllowed = false;
  for (const cancel of [...retryCancels]) cancel();
  setAccountLifecycleStatus("stopped");
}

function validRegistration(value: unknown): ClientPushRegistration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.token !== "string" || !row.token || row.token.length > 2_048) return null;
  if (row.platform !== "ios" && row.platform !== "android" && row.platform !== "web") return null;
  return { token: row.token, platform: row.platform };
}

function storedRegistration(): ClientPushRegistration | null {
  return volatileRegistration;
}

async function recoverWebRegistration(): Promise<PushRegistrationRecovery> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return { status: "none" };
  try {
    const registration = await withPushTimeout(navigator.serviceWorker.ready);
    const subscription = await registration.pushManager.getSubscription();
    const token = subscription ? encodeWebPushSubscription(subscription.toJSON()) : null;
    return token
      ? { status: "registration", registration: { token, platform: "web" } }
      : { status: "none" };
  } catch {
    return { status: "failed" };
  }
}

export async function currentPushRegistration(): Promise<ClientPushRegistration | null> {
  const recovered = await recoverCurrentPushRegistration();
  return recovered.status === "registration" ? recovered.registration : null;
}

/** Distinguish a proven absence from a failed Web PushManager recovery. */
export async function recoverCurrentPushRegistration(): Promise<PushRegistrationRecovery> {
  const stored = storedRegistration();
  return stored
    ? { status: "registration", registration: stored }
    : recoverWebRegistration();
}

/** Remember only AFTER /api/push-tokens accepted the anonymous registration. */
export function rememberPushRegistration(registration: ClientPushRegistration): void {
  const value = validRegistration(registration);
  if (!value || typeof window === "undefined") return;
  volatileRegistration = value;
  try {
    window.dispatchEvent(new Event(REGISTRATION_EVENT));
  } catch {
    // The verified routes still join through the direct calls below.
  }

  // If registration happens after sign-in or while a Plan is already active,
  // close the join opportunistically. Both routes independently re-verify
  // authority and fail soft; no targeted sender is activated here.
  void linkCurrentPushToClaimedAccount();
  const activePlan = readActivePlan();
  if (activePlan?.role) void linkCurrentPushToPlan(activePlan.id);
}

/** Retry a waiting Plan join when an async native token arrives. */
export function subscribePushRegistration(onRegistration: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(REGISTRATION_EVENT, onRegistration);
  return () => window.removeEventListener(REGISTRATION_EVENT, onRegistration);
}

async function accountAccessToken(): Promise<string | null> {
  try {
    return await getAccessToken();
  } catch {
    return null;
  }
}

async function accountMutationRequest(
  method: "POST" | "DELETE",
  body: (ClientPushRegistration | { all: true } | { installationOnly: true }) & PushIdentityMutation,
  generation: number,
): Promise<AccountPushMutationResult> {
  for (let attempt = 0; attempt <= ACCOUNT_RETRY_DELAYS_MS.length; attempt += 1) {
    if (method === "POST" && (!accountJoinsAllowed || generation !== accountLifecycleGeneration)) {
      setAccountLifecycleStatus("stopped");
      return { ok: false, status: "stopped" };
    }
    const accessToken = await accountAccessToken();
    if (!accessToken) {
      setAccountLifecycleStatus("error");
      return { ok: false, status: "auth_required" };
    }
    try {
      const response = await pushFetch("/api/push-tokens/account", {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        setAccountLifecycleStatus(method === "POST" ? "linked" : "unlinked");
        return { ok: true, status: method === "POST" ? "linked" : "unlinked" };
      }
      if (response.status === 409) {
        setAccountLifecycleStatus("error");
        return { ok: false, status: "conflict" };
      }
      if (response.status === 401 || response.status === 403) {
        setAccountLifecycleStatus("error");
        return { ok: false, status: "auth_required" };
      }
      if (response.status < 500) {
        setAccountLifecycleStatus("error");
        return { ok: false, status: "retryable" };
      }
    } catch {
      // A lost response may follow a committed mutation. Never issue DELETE
      // until this attempt settles; retries are bounded and serialized.
    }
    if (attempt < ACCOUNT_RETRY_DELAYS_MS.length) {
      setAccountLifecycleStatus("retrying");
      if (method === "POST") {
        if (!(await retryDelay(ACCOUNT_RETRY_DELAYS_MS[attempt], generation))) {
          setAccountLifecycleStatus("stopped");
          return { ok: false, status: "stopped" };
        }
      } else {
        await unconditionalRetryDelay(ACCOUNT_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  setAccountLifecycleStatus("error");
  return { ok: false, status: "retryable" };
}

/** Link after account claim, or opportunistically after registration. Calls are
 * serialized with logout so an older POST must settle before DELETE begins. */
export function linkCurrentPushToClaimedAccount(): Promise<AccountPushMutationResult> {
  const generation = accountLifecycleGeneration;
  const mutation = nextMutation();
  if (!mutation) return Promise.resolve({ ok: false, status: "retryable" });
  return enqueueAccountOperation(async () => {
    if (!accountJoinsAllowed || generation !== accountLifecycleGeneration) {
      return { ok: false, status: "stopped" };
    }
    const registration = await currentPushRegistration();
    if (!registration) return { ok: true, status: "no_registration" };
    setAccountLifecycleStatus("linking");
    return accountMutationRequest("POST", { ...registration, ...mutation }, generation);
  });
}

/** Link an exact registration recovered by the lifecycle coordinator. */
export function linkPushRegistrationToClaimedAccount(
  registration: ClientPushRegistration,
): Promise<AccountPushMutationResult> {
  const clean = validRegistration(registration);
  const generation = accountLifecycleGeneration;
  const mutation = nextMutation();
  if (!mutation) return Promise.resolve({ ok: false, status: "retryable" });
  if (!clean) return Promise.resolve({ ok: false, status: "retryable" });
  return enqueueAccountOperation(async () => {
    if (!accountJoinsAllowed || generation !== accountLifecycleGeneration) {
      return { ok: false, status: "stopped" };
    }
    setAccountLifecycleStatus("linking");
    return accountMutationRequest("POST", { ...clean, ...mutation }, generation);
  });
}

/** Logout semantics for a known/recovered registration. Empty volatile cache is
 * NOT success: callers must recover native/Web state first and pass it here. */
export function unlinkPushRegistrationFromClaimedAccount(
  registration: ClientPushRegistration,
): Promise<AccountPushMutationResult> {
  const clean = validRegistration(registration);
  const mutation = nextMutation();
  if (!mutation) return Promise.resolve({ ok: false, status: "retryable" });
  if (!clean) return Promise.resolve({ ok: false, status: "retryable" });
  return enqueueAccountOperation(async () => {
    setAccountLifecycleStatus("unlinking");
    return accountMutationRequest("DELETE", { ...clean, ...mutation }, accountLifecycleGeneration);
  });
}

export async function unlinkCurrentPushFromClaimedAccount(): Promise<AccountPushMutationResult> {
  const registration = await currentPushRegistration();
  return registration
    ? unlinkPushRegistrationFromClaimedAccount(registration)
    : { ok: false, status: "retryable" };
}

/** Account-erasure/privacy seam; callers must still hold a verified JWT. */
export function unlinkAllPushFromClaimedAccount(): Promise<AccountPushMutationResult> {
  const mutation = nextMutation();
  if (!mutation) return Promise.resolve({ ok: false, status: "retryable" });
  return enqueueAccountOperation(async () => {
    setAccountLifecycleStatus("unlinking");
    return accountMutationRequest("DELETE", { all: true, ...mutation }, accountLifecycleGeneration);
  });
}

/** Logout privacy barrier independent of notification permission/raw token. */
export function unlinkPushInstallationFromClaimedAccount(): Promise<AccountPushMutationResult> {
  const mutation = nextMutation();
  if (!mutation) return Promise.resolve({ ok: false, status: "retryable" });
  return enqueueAccountOperation(async () => {
    setAccountLifecycleStatus("unlinking");
    return accountMutationRequest(
      "DELETE",
      { installationOnly: true, ...mutation },
      accountLifecycleGeneration,
    );
  });
}

/** Link to a Plan using either its raw in-memory capability or its existing
 * path-scoped HttpOnly cookie. */
export function linkCurrentPushToPlan(planId: string, memberToken?: string): Promise<boolean> {
  const mutation = nextMutation();
  if (!mutation) return Promise.resolve(false);
  return enqueuePlanOperation(planId, async () => {
    const registration = await currentPushRegistration();
    if (!registration) return false;
    try {
      const headers = new Headers({ "content-type": "application/json" });
      if (memberToken) headers.set("authorization", `Bearer ${memberToken}`);
      const response = await pushFetch(`/api/plans/${encodeURIComponent(planId)}/push-tokens`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...registration, ...mutation }),
      });
      return response.ok;
    } catch {
      return false;
    }
  });
}

export function unlinkCurrentPushFromPlan(planId: string, memberToken?: string): Promise<boolean> {
  const mutation = nextMutation();
  if (!mutation) return Promise.resolve(false);
  return enqueuePlanOperation(planId, async () => {
    const registration = await currentPushRegistration();
    if (!registration) return true;
    try {
      const headers = new Headers({ "content-type": "application/json" });
      if (memberToken) headers.set("authorization", `Bearer ${memberToken}`);
      const response = await pushFetch(`/api/plans/${encodeURIComponent(planId)}/push-tokens`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ ...registration, ...mutation }),
      });
      return response.ok;
    } catch {
      return false;
    }
  });
}

/** Test-only: clear volatile continuity; session storage is caller-owned. */
export function __resetPushIdentityClient(): void {
  volatileRegistration = null;
  accountOperationTail = Promise.resolve();
  accountJoinsAllowed = true;
  accountLifecycleGeneration = 0;
  accountLifecycleStatus = "idle";
  for (const cancel of [...retryCancels]) cancel();
  lifecycleListeners.clear();
  planOperationTails.clear();
}
