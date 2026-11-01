"use client";

import { useSyncExternalStore } from "react";

/** The pointer can hover and aim: a mouse or a trackpad, not a finger. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(FINE_POINTER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function read(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(FINE_POINTER_QUERY).matches
  );
}

/**
 * True while the reader's pointer can hover, read live. The server and the
 * hydrating render answer false, so a hover-only affordance is the client's
 * second paint and never a hydration mismatch. CSS says the same thing with
 * `@media (hover: hover) and (pointer: fine)`; this is for what CSS cannot
 * choose, such as which component to load.
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
