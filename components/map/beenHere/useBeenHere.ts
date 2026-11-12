"use client";

// The map's two reads of the Been here list: the venue ids on this device's
// list, and whether the reader has switched on "Your postcodes" in Layers.
// Both are this device's own. An account's list on another phone reaches this
// one when it is saved here, the same rule the "Saved only" filter follows.

import { useEffect, useState, useSyncExternalStore } from "react";

import { sameIds } from "@/components/map/canvas/paintedPins";
import { subscribeBeenHere } from "@/lib/beenHere";
import { beenHereIds } from "@/lib/beenHereProgress";
import { safeLocalStorage } from "@/lib/safeStorage";
import { getSaved, readCanonicalSaved } from "@/lib/savedPubs";

const SAVED_STORAGE_KEY = "pubmax:savedPubs:v1";
const POSTCODES_KEY = "pubmax:been-here-postcodes:v1";

const EMPTY: ReadonlySet<string> = new Set();

/** Calls `onChange` when this tab or another tab changes the saved lists. */
function subscribeSavedLists(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SAVED_STORAGE_KEY) onChange();
  };
  const unsubscribe = subscribeBeenHere(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
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

/** The venue ids on this device's Been here list, each under the id its venue carries now. */
export function useBeenHereVenueIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY);
  useEffect(() => {
    let live = true;
    const read = () => {
      void readCanonicalSaved().then((saved) => {
        if (!live) return;
        const next = beenHereIds(saved);
        setIds((current) => (sameIds(current, next) ? current : next));
      });
    };
    read();
    const unsubscribe = subscribeSavedLists(read);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
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
