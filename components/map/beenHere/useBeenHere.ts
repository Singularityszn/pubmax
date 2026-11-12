"use client";

// The map's two reads of the Been here list: the venue ids on this device's
// list, and whether the reader has switched on "Your postcodes" in Layers.
// Both are this device's own. An account's list on another phone reaches this
// one when it is saved here, the same rule the "Saved only" filter follows.

import { useEffect, useSyncExternalStore } from "react";

import { sameIds } from "@/components/map/canvas/paintedPins";
import { subscribeBeenHere } from "@/lib/beenHere";
import { beenHereIds } from "@/lib/beenHereProgress";
import { safeLocalStorage } from "@/lib/safeStorage";
import { canonicalizeStoredSaved, getSaved, subscribeSavedPubs } from "@/lib/savedPubs";
import { loadVenueAliasMaps } from "@/lib/venueAliasMap";

const SAVED_STORAGE_KEY = "pubmax:savedPubs:v1";
const POSTCODES_KEY = "pubmax:been-here-postcodes:v1";

const EMPTY: ReadonlySet<string> = new Set();

/** Calls `onChange` when this tab or another tab changes the saved lists. */
function subscribeSavedLists(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SAVED_STORAGE_KEY) onChange();
  };
  const unsubscribe = subscribeBeenHere(onChange);
  const unsubscribeDevice = subscribeSavedPubs(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    unsubscribeDevice();
    window.removeEventListener("storage", onStorage);
  };
}

function deviceHasBeenHere(): boolean {
  return beenHereIds(getSaved()).size > 0;
}

/**
 * Whether this device's Been here list holds any pub. A plain storage read:
 * it fetches nothing, so the map can skip the whole layer for a new reader.
 */
export function useHasBeenHere(): boolean {
  return useSyncExternalStore(subscribeSavedLists, deviceHasBeenHere, () => false);
}

let canonicalIds: ReadonlySet<string> = EMPTY;
const canonicalListeners = new Set<() => void>();

function readCanonicalIds(): void {
  void loadVenueAliasMaps().then(({ read, aliases }) => {
    if (!read) return;
    const next = beenHereIds(canonicalizeStoredSaved((id) => aliases.get(id) ?? id));
    if (sameIds(canonicalIds, next)) return;
    canonicalIds = next;
    for (const listener of canonicalListeners) listener();
  }, () => {});
}

function subscribeCanonicalIds(listener: () => void): () => void {
  canonicalListeners.add(listener);
  const unsubscribe = subscribeSavedLists(readCanonicalIds);
  return () => {
    canonicalListeners.delete(listener);
    unsubscribe();
  };
}

function getCanonicalIds(): ReadonlySet<string> {
  return canonicalIds;
}

/** The venue ids on this device's Been here list, each under the id its venue carries now. */
export function useBeenHereVenueIds(): ReadonlySet<string> {
  const ids = useSyncExternalStore(subscribeCanonicalIds, getCanonicalIds, () => EMPTY);
  useEffect(readCanonicalIds, []);
  return ids;
}

// ── "Your postcodes" switch ────────────────────────────────────────────────

const listeners = new Set<() => void>();
let postcodesOn: boolean | null = null;

function readPostcodesOn(): boolean {
  if (postcodesOn !== null) return postcodesOn;
  try {
    postcodesOn = safeLocalStorage()?.getItem(POSTCODES_KEY) === "1";
  } catch {
    postcodesOn = false;
  }
  return postcodesOn;
}

export function setBeenHerePostcodesOn(on: boolean): void {
  postcodesOn = on;
  try {
    const storage = safeLocalStorage();
    if (on) storage?.setItem(POSTCODES_KEY, "1");
    else storage?.removeItem(POSTCODES_KEY);
  } catch {
    // The switch still works for this visit.
  }
  for (const listener of listeners) listener();
}

function subscribePostcodes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBeenHerePostcodesOn(): boolean {
  return useSyncExternalStore(subscribePostcodes, readPostcodesOn, () => false);
}
