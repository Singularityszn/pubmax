// The wild switch. The ten round-two design ideas (docs/plans/DESIGN_UX_PLAN.md,
// section 12) render only while it is on, so the captain can see each one in
// the real app and pick which to keep before any reader meets them.
//
// It is a per-browser preference, not a flag on the server: `?wild=1` on any
// page turns it on and keeps it on in this browser, `?wild=0` turns it off.
// With it off, no wild component is loaded at all: every one of them is a
// dynamic import that waits for this switch, so the routes' first-load
// script is unchanged.
//
// This module imports only the storage leaf, so a bundle that asks for the
// switch pulls nothing else in behind it.

import { safeLocalStorage } from "./safeStorage";

export const WILD_MODE_STORAGE_KEY = "pubmax-wild";
export const WILD_MODE_PARAM = "wild";

const listeners = new Set<() => void>();

export function readWildMode(): boolean {
  const store = safeLocalStorage();
  if (!store) return false;
  try {
    return store.getItem(WILD_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWildMode(on: boolean): void {
  const store = safeLocalStorage();
  if (store) {
    try {
      if (on) store.setItem(WILD_MODE_STORAGE_KEY, "1");
      else store.removeItem(WILD_MODE_STORAGE_KEY);
    } catch {
      // A browser that refuses storage keeps the switch for this page only.
    }
  }
  for (const listener of listeners) listener();
}

/**
 * Reads `?wild=1` or `?wild=0` from a query string and stores the answer.
 * Returns the stored state, or null when the query does not mention the switch.
 */
export function adoptWildModeParam(search: string): boolean | null {
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get(WILD_MODE_PARAM);
  } catch {
    return null;
  }
  if (value === "1" || value === "on") {
    writeWildMode(true);
    return true;
  }
  if (value === "0" || value === "off") {
    writeWildMode(false);
    return false;
  }
  return null;
}

export function subscribeWildMode(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === WILD_MODE_STORAGE_KEY) onChange();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** True when the reader asked for reduced motion; false on the server. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
