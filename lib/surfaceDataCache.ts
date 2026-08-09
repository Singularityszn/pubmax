"use client";

// A returning tab should show the LAST answer it was given, not an empty frame
// while the same request is made again. This is that memory: one in-process
// store of the JSON a surface has already read, handed back on the way in and
// refreshed quietly behind the render.
//
// Three rules make it safe to keep an answer past a navigation.
//
// IT LIVES IN MEMORY ONLY. The store is a module Map, so it dies with the
// document. A device cache of who you are is the exact thing
// lib/deviceAccountIdentity.ts exists to close, and this must never reopen it
// from the other side.
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
// the account boundary drops the whole store in one pass. The listener installs
// itself on first use and rides the existing device-identity announcement, which
// fires on both an account switch and a sign-out.
//
// And one honesty rule on top: an entry has a maximum age. A snapshot may seed a
// first paint, never stand in for an answer nobody asked for again.

import { subscribeDeviceIdentity } from "@/lib/deviceAccountIdentity";

/**
 * Paths whose answers may never be held past the request that asked for them.
 * Identity is tri-state and account-owned; a cached "who you are" is a stale
 * handle waiting to name the wrong person.
 */
export const SURFACE_CACHE_DENIED_PREFIXES = [
  "/api/auth",
  "/api/identity",
  "/api/admin",
] as const;

/** The default a caller gets when it has no sharper opinion: five minutes. */
export const DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS = 5 * 60_000;

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
  subscribeDeviceIdentity(() => {
    store.clear();
  });
}

/** The held answer for this key, or undefined when there is none young enough. */
export function readSurfaceSnapshot<T>(
  key: string,
  maxAgeMs: number = DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS,
  now: number = Date.now(),
): T | undefined {
  assertCacheable(key);
  if (!inBrowser()) return undefined;
  const entry = store.get(key);
  if (!entry) return undefined;
  if (now - entry.storedAt > maxAgeMs) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
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
}

/** The account boundary, and the test seam. */
export function clearSurfaceCache(): void {
  store.clear();
}

/** Test seam only: how many answers are held. */
export function surfaceCacheSize(): number {
  return store.size;
}

export type LoadSurfaceJsonOptions = {
  signal?: AbortSignal;
  init?: RequestInit;
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
};

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
  options: LoadSurfaceJsonOptions,
  apply: (value: T, source: "snapshot" | "network") => void,
): Promise<"snapshot" | "network" | "failed"> {
  assertCacheable(key);
  const { signal, init, maxAgeMs, fetchImpl } = options;
  let applied: "snapshot" | "network" | "failed" = "failed";

  // Yield once before touching state, so a caller may start this in an effect
  // body without setState firing synchronously during render (the same rule the
  // rest of the client surfaces follow). One microtask still lands the held
  // answer in the mount frame.
  await Promise.resolve();
  if (signal?.aborted) return applied;

  const held = readSurfaceSnapshot<T>(key, maxAgeMs);
  if (held !== undefined && !signal?.aborted) {
    applied = "snapshot";
    apply(held, "snapshot");
  }

  try {
    const doFetch = fetchImpl ?? fetch;
    const response = await doFetch(key, { ...init, signal });
    if (!response.ok) return applied;
    const body = (await response.json()) as T;
    if (signal?.aborted) return applied;
    writeSurfaceSnapshot(key, body);
    apply(body, "network");
    return "network";
  } catch {
    // Aborted, offline, or a blip. A surface that already showed a real answer
    // keeps it; one that showed nothing reports the failure to its caller.
    return applied;
  }
}
