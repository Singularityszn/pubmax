"use client";

// "Tell your lot": the consent toggle's last state, remembered on THIS device
// only. Off by default and off whenever storage is unreadable, so a private
// browser, a cleared site or a thumbnail capture never posts on anybody's
// behalf. It is a convenience, not the consent: the server still writes a
// post only when the request itself carries `shareToLot: true`.

import { useCallback, useSyncExternalStore } from "react";

const KEY = "pubmax.tellYourLot.v1";
const listeners = new Set<() => void>();
// This session's last answer, so a tap holds even where storage throws.
let sessionValue: boolean | null = null;

function read(): boolean {
  if (sessionValue !== null) return sessionValue;
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTellYourLot(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    sessionValue = next;
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // Unwritable storage: the toggle still answers for this tap.
    }
    for (const listener of listeners) listener();
  }, []);
  return [on, set];
}

/** Test-only: forget this session's answer. */
export function __resetTellYourLot(): void {
  sessionValue = null;
}
