// Shared first-visit arrival state. Prompt consumers need this store without
// importing the map's URL and restored-session eligibility rules.

import { safeLocalStorage } from "@/lib/safeStorage";

export const MAP_FIRST_VISIT_ARRIVAL_KEY = "pubmax:map-first-visit-arrival:v1";
const CHANGE_EVENT = "pubmax:map-first-visit-arrival";

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  return safeLocalStorage();
}

function notifyChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without Event ctor still keep the storage write.
  }
}

export function hasDismissedMapFirstVisitArrival(
  storage?: Storage | null,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return true;
  try {
    return store.getItem(MAP_FIRST_VISIT_ARRIVAL_KEY) === "dismissed";
  } catch {
    return true;
  }
}

/**
 * A map gesture answers the arrival card. No arguments: this function also
 * serves as an event handler, where an event must never become a Storage.
 */
export function dismissMapFirstVisitArrivalOnMapUse(): void {
  dismissMapFirstVisitArrival();
}

export function dismissMapFirstVisitArrival(storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(MAP_FIRST_VISIT_ARRIVAL_KEY, "dismissed");
    notifyChange();
  } catch {
    // Storage full / private mode - degrade silently.
  }
}

let arrivalCardVisible = false;

/** The mounted card reports visibility so consent can wait behind it. */
export function setMapFirstVisitArrivalCardVisible(visible: boolean): void {
  if (arrivalCardVisible === visible) return;
  arrivalCardVisible = visible;
  notifyChange();
}

export function mapFirstVisitArrivalBlocksConsent(): boolean {
  return arrivalCardVisible;
}

export function subscribeMapFirstVisitArrival(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
