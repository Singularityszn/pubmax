"use client";

// A returning tab should show the LAST answer it was given, not an empty frame
// while the same request is made again. This is that memory: one in-process
// store of the JSON a surface has already read, handed back on the way in and
// refreshed quietly behind the render.
//
// Four rules make it safe to keep an answer past a navigation.
//
// IT LIVES IN THE BROWSER ONLY. The store is a module Map backed by a
// sessionStorage namespace, so it dies with the browser session. A device
// cache of who you are is the exact thing lib/deviceAccountIdentity.ts exists
// to close, and this must never reopen it from the other side.
//
// IT NEVER HOLDS IDENTITY. A key under an auth or identity path is REFUSED,
// loudly, rather than quietly passed through: a helper that silently declines
// to cache is a helper somebody later assumes cached. The closed set is below
// and __tests__/surfaceDataCache.test.ts sweeps the call sites for it.
//
// IT LEAVES WITH THE ACCOUNT. Much of what a tab reads is viewer-scoped (a lot,
// a follow edge, a saved list). The key carries the viewer, so a second account
// never READS the first one's entry — but leaving those rows in memory after a
// sign-out is the same shape of defect as leaving `@karan` on the device, so
// the account boundary drops the whole store in one pass. The listener binds
// during browser module evaluation and rebinds on first use if the global
// window is replaced. It rides the existing device-identity announcement,
// which fires on both an account switch and a sign-out.
//
// And one honesty rule on top: an entry has a maximum age. A snapshot may seed a
// first paint, never stand in for an answer nobody asked for again.

import { subscribeDeviceIdentity } from "@/lib/deviceAccountIdentity";
import { waitUnlessAborted } from "@/lib/abortableDelay";
import { discardBody } from "@/lib/responseBody";

/**
 * Paths whose answers may never be held past the request that asked for them.
 * Identity is tri-state and account-owned; a cached "who you are" is a stale
 * handle waiting to name the wrong person.
 */
export const SURFACE_CACHE_DENIED_PREFIXES = [
  "/api/auth",
  "/api/identity",
  "/api/admin",
  "/api/price-impact",
] as const;

/** The default a caller gets when it has no sharper opinion: five minutes. */
export const DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS = 5 * 60_000;

/** One short pause absorbs a brief mobile-network wobble without adding UI state. */
export const SURFACE_CACHE_RETRY_BACKOFF_MS = 50;

/** Versioned sessionStorage namespace for reloadable surface answers. */
export const SURFACE_CACHE_NAMESPACE = "pubmax.surface.v1:";

/** Keep large venue packs and other oversized answers out of tab storage. */
export const MAX_PERSISTED_SURFACE_ENTRY_BYTES = 256 * 1024;

const SURFACE_CACHE_NAMESPACE_ROOT = "pubmax.surface.";

type Entry = { value: unknown; storedAt: number };

// A "use client" module still EXECUTES on the server during SSR, so a module
// Map here would be one Map shared by every request the server handles — a
// viewer-scoped answer handed to the next stranger. The store is therefore
// browser-only: on the server every read misses and every write is dropped,
// which also keeps a first paint identical on both sides.
const store = new Map<string, Entry>();
const inBrowser = (): boolean => typeof window !== "undefined";
// The window the boundary listener is attached to, rather than a latched
// boolean: a document only ever has one, so this binds exactly once in the app,
// and it rebinds honestly wherever the global is replaced instead of leaving
// the listener on something nobody dispatches to any more.
let boundWindow: unknown = null;

function getSessionStorage(): Storage | null {
  if (!inBrowser()) return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function removeStoredKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Blocked or unavailable storage degrades to the memory tier.
  }
}

function listNamespacedKeys(storage: Storage): string[] {
  const keys: string[] = [];
  let length: number;
  try {
    length = storage.length;
  } catch {
    return keys;
  }
  for (let index = 0; index < length; index += 1) {
    try {
      const key = storage.key(index);
      if (key?.startsWith(SURFACE_CACHE_NAMESPACE_ROOT)) keys.push(key);
    } catch {
      // A storage read failure should not affect the in-memory tier.
    }
  }
  return keys;
}

function clearPersistentSurfaceCache(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  for (const key of listNamespacedKeys(storage)) removeStoredKey(storage, key);
}

function pruneOldPersistentNamespaces(storage: Storage): void {
  for (const key of listNamespacedKeys(storage)) {
    if (!key.startsWith(SURFACE_CACHE_NAMESPACE)) removeStoredKey(storage, key);
  }
}

function removePersistentSnapshot(storage: Storage, key: string): void {
  removeStoredKey(storage, `${SURFACE_CACHE_NAMESPACE}${key}`);
}

function forgetSurfaceSnapshot(key: string): void {
  store.delete(key);
  const storage = getSessionStorage();
  if (storage) removePersistentSnapshot(storage, key);
}

function persistedEntryBytes(serialized: string): number {
  try {
    return new TextEncoder().encode(serialized).byteLength;
  } catch {
    return serialized.length;
  }
}

function persistSurfaceSnapshot(
  key: string,
  value: unknown,
  storedAt: number,
): void {
  if (value === undefined) return;
  const storage = getSessionStorage();
  if (!storage) return;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify({ value, storedAt });
  } catch {
    return;
  }
  if (
    serialized === undefined ||
    serialized.length > MAX_PERSISTED_SURFACE_ENTRY_BYTES ||
    persistedEntryBytes(serialized) > MAX_PERSISTED_SURFACE_ENTRY_BYTES
  ) {
    return;
  }
  try {
    storage.setItem(`${SURFACE_CACHE_NAMESPACE}${key}`, serialized);
  } catch {
    // Quota and private-mode errors leave the memory tier working.
  }
}

function isPersistedEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(candidate, "value") &&
    typeof candidate.storedAt === "number" &&
    Number.isFinite(candidate.storedAt)
  );
}

function readPersistentSurfaceSnapshot<T>(
  key: string,
  maxAgeMs: number,
  now: number,
): T | undefined {
  const storage = getSessionStorage();
  if (!storage) return undefined;
  const storageKey = `${SURFACE_CACHE_NAMESPACE}${key}`;
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedEntry(parsed)) {
      removePersistentSnapshot(storage, key);
      return undefined;
    }
    if (now - parsed.storedAt > maxAgeMs) {
      removePersistentSnapshot(storage, key);
      return undefined;
    }
    store.set(key, parsed);
    return parsed.value as T;
  } catch {
    removePersistentSnapshot(storage, key);
    return undefined;
  }
}

/** Is this key one the store is allowed to remember? */
export function isSurfaceCacheable(key: string): boolean {
  return !SURFACE_CACHE_DENIED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function assertCacheable(key: string): void {
  if (isSurfaceCacheable(key)) return;
  throw new Error(
    `surfaceDataCache refuses ${key}: identity and auth answers are never held past their request.`,
  );
}

function bindIdentityBoundary(): void {
  if (!inBrowser() || boundWindow === window) return;
  boundWindow = window;
  const storage = getSessionStorage();
  if (storage) pruneOldPersistentNamespaces(storage);
  subscribeDeviceIdentity(() => {
    store.clear();
    dropAbandonedRequests();
    clearPersistentSurfaceCache();
  });
}

if (inBrowser()) bindIdentityBoundary();

function isTransientResponse(response: Response): boolean {
  return response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500;
}

/** The held answer for this key, or undefined when there is none young enough. */
export function readSurfaceSnapshot<T>(
  key: string,
  maxAgeMs: number = DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS,
  now: number = Date.now(),
): T | undefined {
  return readSurfaceEntry<T>(key, maxAgeMs, now)?.value;
}

function readSurfaceEntry<T>(
  key: string,
  maxAgeMs: number,
  now: number,
): { value: T; storedAt: number } | undefined {
  assertCacheable(key);
  if (!inBrowser()) return undefined;
  bindIdentityBoundary();
  const entry = store.get(key);
  if (entry) {
    if (now - entry.storedAt <= maxAgeMs) {
      return { value: entry.value as T, storedAt: entry.storedAt };
    }
    store.delete(key);
  }
  const persisted = readPersistentSurfaceSnapshot<T>(key, maxAgeMs, now);
  if (persisted === undefined) return undefined;
  return { value: persisted, storedAt: store.get(key)?.storedAt ?? now };
}

/** Hold this answer for the next arrival on the surface that read it. */
export function writeSurfaceSnapshot<T>(
  key: string,
  value: T,
  now: number = Date.now(),
): void {
  assertCacheable(key);
  if (!inBrowser()) return;
  bindIdentityBoundary();
  store.set(key, { value, storedAt: now });
  persistSurfaceSnapshot(key, value, now);
}

/** The account boundary, and the test seam. */
export function clearSurfaceCache(): void {
  dropAbandonedRequests();
  store.clear();
  clearPersistentSurfaceCache();
}

/** Test seam only: how many answers are held. */
export function surfaceCacheSize(): number {
  return store.size;
}

// Two surfaces that read the same URL in the same tick are two requests, not
// one: the first has not answered yet, so the second finds no held snapshot and
// asks again. On a venue sheet that was measured as `/api/whats-on` and
// `/api/citymcp/places` each fetched TWICE per open, both `no-store`, so both
// were two function invocations and two round trips for one answer.
//
// A read in flight is therefore joinable. It is keyed by the URL, which is
// already the whole of this store's identity: an answer fetched for one caller
// is handed to the next through the snapshot regardless of the `init` either
// passed, so sharing the request in flight is no wider a promise than the
// sharing this module already does. Each joiner still runs its OWN validate
// and apply, so a shared body cannot make one surface adopt another's reading
// of it.
//
// The request carries its own AbortController rather than any one caller's
// signal, and is aborted only when EVERY joiner has gone: one surface
// unmounting must not cancel the read another is still waiting on, and a read
// nobody is waiting for should not stay on the wire.
type InFlightRequest = {
  promise: Promise<unknown | undefined>;
  controller: AbortController;
  joiners: number;
  /** Nobody is waiting, but the read is held for the grace window. */
  abandoned: boolean;
  /** The read has answered, or failed to. */
  settled: boolean;
  /** Some caller took the answer, so there is nothing left to hand on. */
  consumed: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * How long a read nobody is waiting for stays on the wire. A surface that
 * unmounts and remounts in the same arrival (a shell that swaps layout once the
 * viewport is known) used to cancel its read and ask again a few milliseconds
 * later: on a venue sheet that was the same GETs sent twice, the first set
 * cancelled in flight. Inside this window the next surface to ask joins the
 * read instead. An abandoned read still spends no retry, and past the window it
 * is aborted exactly as before.
 */
export const SURFACE_REQUEST_GRACE_MS = 1_000;

const inFlight = new Map<string, InFlightRequest>();

export type LoadSurfaceJsonOptions<T = unknown> = {
  signal?: AbortSignal;
  init?: RequestInit;
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
  validate?: (value: T) => boolean;
  /**
   * An answer read this recently is still the answer, so it is applied and the
   * network is not asked again. Without it a held answer always revalidates,
   * which is right for a tab someone returns to and wasteful for the second
   * surface of the SAME page load: two panels that read one URL a beat apart
   * made two requests, because the first had already answered and left nothing
   * in flight to join. Unset revalidates, unless a read finished moments ago
   * and is still within SURFACE_REQUEST_GRACE_MS.
   */
  freshForMs?: number;
};

/** A read this young was made by the page that is still loading. */
export const SURFACE_JUST_READ_MS = 5_000;

/**
 * Stale-while-revalidate for one surface read.
 *
 * `apply` is called with the held answer FIRST when there is one, so the tab
 * paints its last state in the same frame it mounts, and then again with the
 * network answer. It is never called after the caller's signal aborts, and a
 * failed revalidate leaves the held answer standing rather than blanking a
 * surface that already had real data on it.
 *
 * Returns the source of the last answer applied, so a caller that must report
 * its own read status can tell a served snapshot from a fresh read.
 */
export async function loadSurfaceJson<T>(
  key: string,
  options: LoadSurfaceJsonOptions<T>,
  apply: (value: T, source: "snapshot" | "network") => void | boolean,
): Promise<"snapshot" | "network" | "failed"> {
  assertCacheable(key);
  const { signal, init, maxAgeMs, validate } = options;
  let applied: "snapshot" | "network" | "failed" = "failed";
  const requestSignal = signal ?? init?.signal ?? undefined;

  // Yield once before touching state, so a caller may start this in an effect
  // body without setState firing synchronously during render (the same rule the
  // rest of the client surfaces follow). One microtask still lands the held
  // answer in the mount frame.
  await Promise.resolve();
  if (requestSignal?.aborted) return applied;

  const heldEntry = readSurfaceEntry<T>(
    key,
    maxAgeMs ?? DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS,
    Date.now(),
  );
  const held = heldEntry?.value;
  let justRead = false;
  if (held !== undefined && !requestSignal?.aborted) {
    let valid = true;
    if (validate) {
      try {
        valid = validate(held);
      } catch {
        valid = false;
      }
    }
    if (valid) {
      applied = "snapshot";
      apply(held, "snapshot");
      justRead =
        options.freshForMs !== undefined &&
        heldEntry !== undefined &&
        Date.now() - heldEntry.storedAt <= options.freshForMs;
    } else {
      forgetSurfaceSnapshot(key);
    }
  }

  if (requestSignal?.aborted || justRead) return applied;
  const request = joinSurfaceRequest(key, options);
  // Release on the caller's own abort as well as on settle, so an unmount
  // still takes a read off the wire the moment nobody is left waiting for it.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseSurfaceRequest(key, request);
  };
  requestSignal?.addEventListener("abort", release, { once: true });
  let body: T | undefined;
  try {
    // A caller that leaves stops waiting at once. The read itself may live on
    // for the grace window, so its settling is no longer the caller's cue.
    body = (await untilAborted(request.promise, requestSignal)) as T | undefined;
    // Taken before the release below, which is what lets the read leave the map.
    if (body !== undefined && !requestSignal?.aborted) request.consumed = true;
  } finally {
    requestSignal?.removeEventListener("abort", release);
    release();
  }
  if (body === undefined) return applied;
  if (requestSignal?.aborted) return applied;
  if (validate) {
    let valid = false;
    try {
      valid = validate(body);
    } catch {
      valid = false;
    }
    if (!valid) return applied;
  }
  const shouldCache = apply(body, "network") !== false;
  if (shouldCache) writeSurfaceSnapshot(key, body);
  return "network";
}

/**
 * The one request per key. A caller arriving while another is waiting joins it
 * rather than opening a second; `undefined` means the read did not answer.
 */
function joinSurfaceRequest<T>(
  key: string,
  options: LoadSurfaceJsonOptions<T>,
): InFlightRequest {
  const existing = inFlight.get(key);
  if (existing) {
    existing.joiners += 1;
    existing.abandoned = false;
    if (existing.graceTimer) clearTimeout(existing.graceTimer);
    existing.graceTimer = null;
    return existing;
  }
  const controller = new AbortController();
  const entry: InFlightRequest = {
    controller,
    joiners: 1,
    abandoned: false,
    settled: false,
    consumed: false,
    graceTimer: null,
    promise: Promise.resolve(undefined),
  };
  // A read that answered while somebody was waiting is theirs, and leaves the
  // map when the last of them does (releaseSurfaceRequest). A read that answered
  // while NOBODY was waiting is the case the grace window exists for: the next
  // surface to ask takes it. A read that did not answer is dropped at once, so a
  // retry always reaches the network.
  entry.promise = runSurfaceRequest(key, options, controller.signal, () => entry.abandoned).then(
    (body) => {
      entry.settled = true;
      if (body === undefined && inFlight.get(key) === entry) inFlight.delete(key);
      return body;
    },
  );
  inFlight.set(key, entry);
  return entry;
}

function untilAborted<V>(promise: Promise<V>, signal: AbortSignal | undefined): Promise<V | undefined> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise<V | undefined>((resolve, reject) => {
    const onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * End every read nobody is waiting for. The account boundary does this so a
 * settled answer held for the grace window never reaches the next account, and
 * so does the test seam.
 */
function dropAbandonedRequests(): void {
  for (const [key, request] of inFlight) {
    if (!request.abandoned) continue;
    if (request.graceTimer) clearTimeout(request.graceTimer);
    request.graceTimer = null;
    inFlight.delete(key);
    request.controller.abort();
  }
}

/** One joiner has stopped waiting; the last one out starts the grace window. */
function releaseSurfaceRequest(key: string, request: InFlightRequest): void {
  request.joiners -= 1;
  if (request.joiners > 0) return;
  if (request.settled && request.consumed) {
    // Answered, and taken: nothing is left to hold or to cancel.
    if (request.graceTimer) clearTimeout(request.graceTimer);
    request.graceTimer = null;
    if (inFlight.get(key) === request) inFlight.delete(key);
    return;
  }
  request.abandoned = true;
  if (request.graceTimer) clearTimeout(request.graceTimer);
  request.graceTimer = setTimeout(() => {
    request.graceTimer = null;
    if (!request.abandoned) return;
    if (inFlight.get(key) === request) inFlight.delete(key);
    request.controller.abort();
  }, SURFACE_REQUEST_GRACE_MS);
}

/**
 * Fetch the key once, with the transient retry the surfaces rely on. Resolves
 * to the parsed body, or `undefined` when the read did not answer. The first
 * caller's `init`, `fetchImpl` and `validate` shape the request, exactly as the
 * first caller's answer already shapes the held snapshot; every joiner still
 * validates the body it is handed for itself.
 */
async function runSurfaceRequest<T>(
  key: string,
  options: LoadSurfaceJsonOptions<T>,
  signal: AbortSignal,
  abandoned: () => boolean,
): Promise<T | undefined> {
  const { init, fetchImpl, validate } = options;
  const doFetch = fetchImpl ?? fetch;
  // A read nobody is waiting for does not spend a retry: the attempt in flight
  // may finish, and a second would only be for an answer no one asked for.
  const stopped = () => signal.aborted || abandoned();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (stopped()) return undefined;
    try {
      const response = await doFetch(key, { ...init, signal });
      if (!response.ok) {
        const retryable = isTransientResponse(response);
        discardBody(response);
        if (retryable && attempt === 0 && await waitUnlessAborted(SURFACE_CACHE_RETRY_BACKOFF_MS, signal) && !stopped()) continue;
        return undefined;
      }
      const body = (await response.json()) as T;
      if (signal.aborted) return undefined;
      if (validate && !validate(body)) {
        if (attempt === 0 && await waitUnlessAborted(SURFACE_CACHE_RETRY_BACKOFF_MS, signal) && !stopped()) continue;
        return undefined;
      }
      return body;
    } catch {
      if (signal.aborted) return undefined;
      if (attempt === 0 && await waitUnlessAborted(SURFACE_CACHE_RETRY_BACKOFF_MS, signal) && !stopped()) continue;
      // Aborted, offline, or a blip. A surface that already showed a real
      // answer keeps it; one that showed nothing reports the failure to its
      // caller.
      return undefined;
    }
  }
  return undefined;
}
