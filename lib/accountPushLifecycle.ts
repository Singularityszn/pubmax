"use client";

// Retire the installed browser's account-linked web push before an auth
// boundary. Server detachment and local unsubscribe are independent safety
// paths: either one prevents the departing account's personalized payload from
// reaching the browser. If neither succeeds, the account boundary stays put.

import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { unsubscribeWebPushToken } from "@/lib/webPush";
import {
  clearPublicWebPushRegistration,
  readPublicWebPushToken,
  shouldPreservePublicWebPushToken,
} from "@/lib/webPushRegistrationState";

const SUBSCRIPTION_READ_TIMEOUT_MS = 2_000;
const SERVER_DETACH_TIMEOUT_MS = 5_000;
const LOCAL_UNSUBSCRIBE_TIMEOUT_MS = 3_000;
const ACCOUNT_PUSH_LIFECYCLE_LOCK = "pubmaxx-account-push-lifecycle";
const PENDING_PERSONALIZED_BIND_KEY = "pubmax_pending_personalized_push_bind";
const ACTIVE_PERSONALIZED_BIND_KEY = "pubmax_active_personalized_push_bind";

let localLifecycleTail: Promise<void> = Promise.resolve();
export type PendingAccountPushBind = Readonly<{
  version: 1;
  revision: string;
  ownerId: string;
  subscriptionToken: string;
}>;

let memoryPendingPersonalizedBind: PendingAccountPushBind | null = null;

type AccountPushSubscription = Pick<PushSubscription, "toJSON" | "unsubscribe">;

export type AccountPushLifecycleDeps = {
  readSubscription: () => Promise<AccountPushSubscription | null>;
  detachAccountToken: (
    subscriptionToken: string,
    accessToken: string,
  ) => Promise<boolean>;
  retirePendingToken: (subscriptionToken: string) => Promise<boolean>;
};

export type AccountPushRetirementOutcome =
  | { status: "not_registered" }
  | {
      status: "retired";
      serverDetached: boolean;
      unsubscribed: boolean;
    }
  | { status: "unavailable" };

export type AccountPushBoundaryOutcome<T> =
  | {
      status: "completed";
      retirement: AccountPushRetirementOutcome;
      value: T;
    }
  | { status: "unavailable" };

function browserLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function supportsOriginWideAccountPushLock(): boolean {
  try {
    return typeof navigator !== "undefined" && Boolean(navigator.locks);
  } catch {
    return false;
  }
}

function samePendingBind(
  left: PendingAccountPushBind,
  right: PendingAccountPushBind,
): boolean {
  return left.revision === right.revision &&
    left.ownerId === right.ownerId &&
    left.subscriptionToken === right.subscriptionToken;
}

function parsePendingBind(value: string): PendingAccountPushBind | null {
  try {
    const parsed = JSON.parse(value) as Partial<PendingAccountPushBind>;
    if (
      parsed.version !== 1 ||
      typeof parsed.revision !== "string" || !parsed.revision ||
      typeof parsed.ownerId !== "string" || !parsed.ownerId ||
      typeof parsed.subscriptionToken !== "string" || !parsed.subscriptionToken
    ) {
      return null;
    }
    return {
      version: 1,
      revision: parsed.revision,
      ownerId: parsed.ownerId,
      subscriptionToken: parsed.subscriptionToken,
    };
  } catch {
    return null;
  }
}

export function markPendingAccountPushBind(
  pending: PendingAccountPushBind,
): boolean {
  const storage = browserLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(PENDING_PERSONALIZED_BIND_KEY, JSON.stringify(pending));
    const storedValue = storage.getItem(PENDING_PERSONALIZED_BIND_KEY);
    const stored = storedValue ? parsePendingBind(storedValue) : null;
    if (!stored || !samePendingBind(stored, pending)) {
      return false;
    }
    memoryPendingPersonalizedBind = pending;
    return true;
  } catch {
    return false;
  }
}

export function commitActiveAccountPushBind(
  pending: PendingAccountPushBind,
): boolean {
  const storage = browserLocalStorage();
  if (!storage) return false;
  try {
    const pendingValue = storage.getItem(PENDING_PERSONALIZED_BIND_KEY);
    const storedPending = pendingValue ? parsePendingBind(pendingValue) : null;
    if (!storedPending || !samePendingBind(storedPending, pending)) return false;
    storage.setItem(ACTIVE_PERSONALIZED_BIND_KEY, JSON.stringify(pending));
    const activeValue = storage.getItem(ACTIVE_PERSONALIZED_BIND_KEY);
    const active = activeValue ? parsePendingBind(activeValue) : null;
    return Boolean(active && samePendingBind(active, pending));
  } catch {
    return false;
  }
}

export function clearPendingAccountPushBind(
  pending: PendingAccountPushBind,
): void {
  const storage = browserLocalStorage();
  try {
    const storedValue = storage?.getItem(PENDING_PERSONALIZED_BIND_KEY) ?? null;
    const stored = storedValue ? parsePendingBind(storedValue) : null;
    if (stored && samePendingBind(stored, pending)) {
      storage?.removeItem(PENDING_PERSONALIZED_BIND_KEY);
    }
  } catch {
    // The in-memory guard still protects this tab.
  }
  if (
    memoryPendingPersonalizedBind &&
    samePendingBind(memoryPendingPersonalizedBind, pending)
  ) {
    memoryPendingPersonalizedBind = null;
  }
}

type PendingBindRead =
  | { status: "none" }
  | { status: "pending"; pending: PendingAccountPushBind }
  | { status: "unavailable" };

function pendingAccountPushBind(): PendingBindRead {
  if (typeof window === "undefined") {
    return memoryPendingPersonalizedBind
      ? { status: "pending", pending: memoryPendingPersonalizedBind }
      : { status: "none" };
  }
  try {
    const storage = browserLocalStorage();
    if (!storage) {
      return memoryPendingPersonalizedBind
        ? { status: "pending", pending: memoryPendingPersonalizedBind }
        : { status: "none" };
    }
    const value = storage.getItem(PENDING_PERSONALIZED_BIND_KEY);
    if (!value) {
      return memoryPendingPersonalizedBind
        ? { status: "pending", pending: memoryPendingPersonalizedBind }
        : { status: "none" };
    }
    const pending = parsePendingBind(value);
    return pending
      ? { status: "pending", pending }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

function clearPersonalizedBindState(): void {
  memoryPendingPersonalizedBind = null;
  try {
    const storage = browserLocalStorage();
    storage?.removeItem(PENDING_PERSONALIZED_BIND_KEY);
    storage?.removeItem(ACTIVE_PERSONALIZED_BIND_KEY);
  } catch {
    // The delivery boundary is already safe.
  }
}

function clearBindStateAfterPhysicalRetirement(
  subscriptionToken?: string,
): void {
  clearPersonalizedBindState();
  clearPublicWebPushRegistration(subscriptionToken);
}

type ActiveBindRead =
  | { status: "none" }
  | { status: "active"; active: PendingAccountPushBind }
  | { status: "unavailable" };

function activeAccountPushBind(): ActiveBindRead {
  if (typeof window === "undefined") return { status: "none" };
  try {
    const storage = browserLocalStorage();
    if (!storage) return { status: "none" };
    const value = storage.getItem(ACTIVE_PERSONALIZED_BIND_KEY);
    if (!value) return { status: "none" };
    const active = parsePendingBind(value);
    return active
      ? { status: "active", active }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

async function withLocalLifecycleLock<T>(work: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = localLifecycleTail.catch(() => undefined);
  localLifecycleTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

/**
 * Serialize personalized push binding and account replacement for this origin.
 * Web Locks cover every open tab. The local queue is for runtimes without the
 * API, including tests and older browsers, and still closes same-tab races.
 */
export async function withAccountPushLifecycleLock<T>(
  work: () => Promise<T>,
  options: {
    requireOriginWide?: boolean;
    acquireTimeoutMs?: number;
  } = {},
): Promise<T> {
  let lockManager: LockManager | null = null;
  try {
    lockManager = typeof navigator !== "undefined" ? navigator.locks : null;
  } catch {
    lockManager = null;
  }
  if (lockManager) {
    const controller = options.acquireTimeoutMs
      ? new AbortController()
      : null;
    const timeout = controller
      ? setTimeout(
          () => controller.abort(new DOMException("Push coordination timed out.", "TimeoutError")),
          options.acquireTimeoutMs,
        )
      : null;
    try {
      return await lockManager.request(
        ACCOUNT_PUSH_LIFECYCLE_LOCK,
        {
          mode: "exclusive",
          ...(controller ? { signal: controller.signal } : {}),
        },
        async () => work(),
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  if (options.requireOriginWide) {
    throw new Error("Origin-wide push coordination is unavailable.");
  }
  return withLocalLifecycleLock(work);
}

async function attempt(action: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await action()) === true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out.")), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readBrowserSubscription(): Promise<AccountPushSubscription | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window)) return null;
  const container = navigator.serviceWorker;
  const registration = typeof container.getRegistration === "function"
    ? await withTimeout(container.getRegistration(), SUBSCRIPTION_READ_TIMEOUT_MS)
    : await withTimeout(container.ready, SUBSCRIPTION_READ_TIMEOUT_MS);
  if (!registration) return null;
  return withTimeout(
    registration.pushManager.getSubscription(),
    SUBSCRIPTION_READ_TIMEOUT_MS,
  );
}

async function detachBrowserToken(
  subscriptionToken: string,
  accessToken: string,
): Promise<boolean> {
  if (!accessToken) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_DETACH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/push-tokens/account", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: subscriptionToken,
        preservePublicToken: shouldPreservePublicWebPushToken(subscriptionToken),
      }),
      cache: "no-store",
      keepalive: true,
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function browserAccountPushLifecycleDeps(): AccountPushLifecycleDeps {
  return {
    readSubscription: readBrowserSubscription,
    detachAccountToken: detachBrowserToken,
    retirePendingToken: unsubscribeWebPushToken,
  };
}

async function retireDivergentPendingAndCurrentToken(
  pendingToken: string,
  subscription: AccountPushSubscription,
  subscriptionToken: string | null,
  accessToken: string | null | undefined,
  deps: AccountPushLifecycleDeps,
): Promise<AccountPushRetirementOutcome> {
  const pendingRetirement = Promise.all([
    accessToken
      ? attempt(() => deps.detachAccountToken(pendingToken, accessToken))
      : Promise.resolve(false),
    attempt(() => deps.retirePendingToken(pendingToken)),
  ]);
  const preserveCurrentPublicToken = Boolean(
    subscriptionToken && accessToken &&
    shouldPreservePublicWebPushToken(subscriptionToken),
  );
  let currentServerDetached = false;
  let currentUnsubscribed = false;
  if (preserveCurrentPublicToken && subscriptionToken && accessToken) {
    currentServerDetached = await attempt(() =>
      deps.detachAccountToken(subscriptionToken, accessToken),
    );
    if (!currentServerDetached) {
      currentUnsubscribed = await attempt(() => withTimeout(
        subscription.unsubscribe(),
        LOCAL_UNSUBSCRIBE_TIMEOUT_MS,
      ));
    }
  } else {
    [currentServerDetached, currentUnsubscribed] = await Promise.all([
      subscriptionToken && accessToken
        ? attempt(() => deps.detachAccountToken(subscriptionToken, accessToken))
        : Promise.resolve(false),
      attempt(() => withTimeout(
        subscription.unsubscribe(),
        LOCAL_UNSUBSCRIBE_TIMEOUT_MS,
      )),
    ]);
  }
  const [pendingServerDetached, pendingPhysicallyRetired] =
    await pendingRetirement;
  if (
    !pendingPhysicallyRetired ||
    (!currentServerDetached && !currentUnsubscribed)
  ) {
    return { status: "unavailable" };
  }
  clearPublicWebPushRegistration(pendingToken);
  if (currentUnsubscribed) {
    clearBindStateAfterPhysicalRetirement(subscriptionToken ?? undefined);
  } else {
    clearPersonalizedBindState();
  }
  return {
    status: "retired",
    serverDetached: pendingServerDetached && currentServerDetached,
    unsubscribed: currentUnsubscribed,
  };
}

async function retireCurrentToken(
  subscription: AccountPushSubscription,
  subscriptionToken: string | null,
  accessToken: string | null | undefined,
  physicalProofRequired: boolean,
  deps: AccountPushLifecycleDeps,
): Promise<AccountPushRetirementOutcome> {
  const preservePublicToken = Boolean(
    !physicalProofRequired && subscriptionToken && accessToken &&
    shouldPreservePublicWebPushToken(subscriptionToken),
  );
  let serverDetached = false;
  if (preservePublicToken && subscriptionToken && accessToken) {
    serverDetached = await attempt(() =>
      deps.detachAccountToken(subscriptionToken, accessToken),
    );
    if (serverDetached) {
      clearPersonalizedBindState();
      return {
        status: "retired",
        serverDetached: true,
        unsubscribed: false,
      };
    }
  }

  const pendingToken = physicalProofRequired ? subscriptionToken : null;
  const [fallbackServerDetached, unsubscribed] = await Promise.all([
    !preservePublicToken && subscriptionToken && accessToken
      ? attempt(() => deps.detachAccountToken(subscriptionToken, accessToken))
      : Promise.resolve(false),
    pendingToken
      ? attempt(() => deps.retirePendingToken(pendingToken))
      : attempt(() => withTimeout(
          subscription.unsubscribe(),
          LOCAL_UNSUBSCRIBE_TIMEOUT_MS,
        )),
  ]);
  serverDetached ||= fallbackServerDetached;
  if (physicalProofRequired && !unsubscribed) {
    return { status: "unavailable" };
  }
  if (!serverDetached && !unsubscribed) return { status: "unavailable" };
  if (unsubscribed) {
    clearBindStateAfterPhysicalRetirement(subscriptionToken ?? undefined);
  } else {
    clearPersonalizedBindState();
  }
  return { status: "retired", serverDetached, unsubscribed };
}

/**
 * Retire the current browser subscription before sign-out or account switch.
 * A successful local unsubscribe is safe while offline. A successful server
 * detach is safe when the browser refuses to unsubscribe. Only dual failure
 * blocks the account boundary.
 */
async function retireAccountWebPushUnlocked(
  accessToken: string | null | undefined,
  deps: AccountPushLifecycleDeps,
): Promise<AccountPushRetirementOutcome> {
  const pendingBind = pendingAccountPushBind();
  let subscription: AccountPushSubscription | null;
  try {
    subscription = await deps.readSubscription();
  } catch {
    return { status: "unavailable" };
  }
  if (!subscription) {
    if (pendingBind.status === "pending" && accessToken) {
      await attempt(() => deps.detachAccountToken(
        pendingBind.pending.subscriptionToken,
        accessToken,
      ));
    }
    clearBindStateAfterPhysicalRetirement();
    return { status: "not_registered" };
  }

  let subscriptionToken: string | null = null;
  try {
    subscriptionToken = encodeWebPushSubscription(subscription.toJSON());
  } catch {
    // A malformed serialization cannot name the server row, but a successful
    // local unsubscribe still makes the account boundary safe.
  }
  if (pendingBind.status === "pending") {
    const pendingToken = pendingBind.pending.subscriptionToken;
    if (pendingToken !== subscriptionToken) {
      return retireDivergentPendingAndCurrentToken(
        pendingToken,
        subscription,
        subscriptionToken,
        accessToken,
        deps,
      );
    }

    const [serverDetached, physicallyRetired] = await Promise.all([
      accessToken
        ? attempt(() => deps.detachAccountToken(pendingToken, accessToken))
        : Promise.resolve(false),
      attempt(() => deps.retirePendingToken(pendingToken)),
    ]);
    if (!physicallyRetired) return { status: "unavailable" };
    clearBindStateAfterPhysicalRetirement(pendingToken);
    return {
      status: "retired",
      serverDetached,
      unsubscribed: true,
    };
  }

  return retireCurrentToken(
    subscription,
    subscriptionToken,
    accessToken,
    pendingBind.status === "unavailable",
    deps,
  );
}

export async function retireAccountWebPush(
  accessToken: string | null | undefined,
  deps: AccountPushLifecycleDeps = browserAccountPushLifecycleDeps(),
): Promise<AccountPushRetirementOutcome> {
  try {
    return await withAccountPushLifecycleLock(() =>
      retireAccountWebPushUnlocked(accessToken, deps),
    );
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Keep the lifecycle lock through the auth mutation. Releasing it between
 * retirement and setSession/signOut would let a new opt-in bind the departing
 * account in that gap.
 */
export async function withRetiredAccountWebPush<T>(
  accessToken: string | null | undefined,
  continuation: () => Promise<T>,
  deps: AccountPushLifecycleDeps = browserAccountPushLifecycleDeps(),
): Promise<AccountPushBoundaryOutcome<T>> {
  return withAccountPushLifecycleLock(async () => {
    const retirement = await retireAccountWebPushUnlocked(accessToken, deps);
    if (retirement.status === "unavailable") {
      return { status: "unavailable" };
    }
    return {
      status: "completed",
      retirement,
      value: await continuation(),
    };
  });
}

/**
 * A cold provider has no previous React session to compare. Preserve an
 * installed personalized subscription only when durable ownership proves it
 * belongs to the session being published. Unknown and cross-account bindings
 * are retired first, including subscriptions created before owner markers.
 */
export async function withVerifiedInitialAccountPushOwner<T>(
  ownerId: string,
  accessToken: string,
  continuation: () => Promise<T>,
  deps: AccountPushLifecycleDeps = browserAccountPushLifecycleDeps(),
): Promise<AccountPushBoundaryOutcome<T>> {
  return withAccountPushLifecycleLock(async () => {
    let subscription: AccountPushSubscription | null;
    try {
      subscription = await deps.readSubscription();
    } catch {
      return { status: "unavailable" };
    }
    if (!subscription) {
      clearBindStateAfterPhysicalRetirement();
      return {
        status: "completed",
        retirement: { status: "not_registered" },
        value: await continuation(),
      };
    }

    let subscriptionToken: string | null = null;
    try {
      subscriptionToken = encodeWebPushSubscription(subscription.toJSON());
    } catch {
      // Unknown ownership must retire before session publication.
    }
    const pending = pendingAccountPushBind();
    const active = activeAccountPushBind();
    const publicToken = readPublicWebPushToken();
    if (
      pending.status === "none" &&
      active.status === "active" &&
      active.active.ownerId === ownerId &&
      active.active.subscriptionToken === subscriptionToken
    ) {
      return {
        status: "completed",
        retirement: { status: "not_registered" },
        value: await continuation(),
      };
    }
    if (
      pending.status === "none" &&
      active.status === "none" &&
      publicToken.status === "active" &&
      publicToken.subscriptionToken === subscriptionToken
    ) {
      return {
        status: "completed",
        retirement: { status: "not_registered" },
        value: await continuation(),
      };
    }

    let retirement: AccountPushRetirementOutcome;
    if (active.status === "none" && pending.status === "none") {
      const [serverDetached, physicallyRetired] = await Promise.all([
        subscriptionToken
          ? attempt(() => deps.detachAccountToken(subscriptionToken, accessToken))
          : Promise.resolve(false),
        subscriptionToken
          ? attempt(() => deps.retirePendingToken(subscriptionToken))
          : attempt(() => withTimeout(
              subscription.unsubscribe(),
              LOCAL_UNSUBSCRIBE_TIMEOUT_MS,
            )),
      ]);
      if (!physicallyRetired) return { status: "unavailable" };
      clearBindStateAfterPhysicalRetirement(subscriptionToken ?? undefined);
      retirement = {
        status: "retired",
        serverDetached,
        unsubscribed: true,
      };
    } else {
      retirement = await retireAccountWebPushUnlocked(accessToken, deps);
    }
    if (retirement.status === "unavailable") return { status: "unavailable" };
    return {
      status: "completed",
      retirement,
      value: await continuation(),
    };
  });
}

/** A cold signed-out state cannot own a personalized subscription. */
export async function withVerifiedInitialSignedOutAccountPush<T>(
  continuation: () => Promise<T>,
  deps: AccountPushLifecycleDeps = browserAccountPushLifecycleDeps(),
): Promise<AccountPushBoundaryOutcome<T>> {
  return withAccountPushLifecycleLock(async () => {
    let subscription: AccountPushSubscription | null;
    try {
      subscription = await deps.readSubscription();
    } catch {
      return { status: "unavailable" };
    }
    if (!subscription) {
      clearBindStateAfterPhysicalRetirement();
      return {
        status: "completed",
        retirement: { status: "not_registered" },
        value: await continuation(),
      };
    }
    let subscriptionToken: string | null = null;
    try {
      subscriptionToken = encodeWebPushSubscription(subscription.toJSON());
    } catch {
      // Unknown subscriptions are retired below.
    }
    const pending = pendingAccountPushBind();
    const active = activeAccountPushBind();
    const publicToken = readPublicWebPushToken();
    if (
      pending.status === "none" &&
      active.status === "none" &&
      publicToken.status === "active" &&
      publicToken.subscriptionToken === subscriptionToken
    ) {
      return {
        status: "completed",
        retirement: { status: "not_registered" },
        value: await continuation(),
      };
    }
    const retirement = await retireAccountWebPushUnlocked(null, deps);
    if (retirement.status === "unavailable") return { status: "unavailable" };
    return {
      status: "completed",
      retirement,
      value: await continuation(),
    };
  });
}
