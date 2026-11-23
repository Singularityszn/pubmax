// The consent gate half of the first-visit map arrival (lib/mapFirstVisitArrival.ts).
//
// The analytics prompt is mounted at the root on every route and has to wait
// behind the arrival card, so it reads this signal. It used to read it from the
// policy module, whose eligibility rules import the planner params and the
// explicit-map-intent parser, and through them the venue index, the shard
// loader, route legs, culture crawls and community prices: about 200 KB of map
// code in the shell every page downloads, for one boolean and one event name.
// This module imports only the import-free storage leaf, so the root shell pays
// for exactly that.

import { safeLocalStorage } from "@/lib/safeStorage";

export const MAP_FIRST_VISIT_ARRIVAL_KEY = "pubmax:map-first-visit-arrival:v1";

/** The event every arrival change fires, for the consent prompt to re-read. */
export const MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT = "pubmax:map-first-visit-arrival";

export function notifyMapFirstVisitArrivalChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT));
  } catch {
    // Older environments without Event ctor still keep the storage write.
  }
}

let arrivalCardVisible = false;
let firstVisitPromptsSuppressed = false;
export const mapFirstVisitPromptsSuppressed = () => firstVisitPromptsSuppressed || (typeof window !== "undefined" && !!window.__pubmaxEarlyFairPint);
export function suppressMapFirstVisitPrompts(): void {
  if (firstVisitPromptsSuppressed) return;
  firstVisitPromptsSuppressed = true;
  notifyMapFirstVisitArrivalChange();
}
const areaPickers = new Set<symbol>();

export function holdMapAreaPickerPrompts(): () => void {
  const picker = Symbol();
  areaPickers.add(picker);
  notifyMapFirstVisitArrivalChange();
  return () => {
    if (areaPickers.delete(picker)) notifyMapFirstVisitArrivalChange();
  };
}

/** The mounted card reports visibility so consent can wait behind it. */
export function setMapFirstVisitArrivalCardVisible(visible: boolean): void {
  if (arrivalCardVisible === visible) return;
  arrivalCardVisible = visible;
  notifyMapFirstVisitArrivalChange();
}

export function mapFirstVisitArrivalBlocksConsent(): boolean {
  return arrivalCardVisible || areaPickers.size > 0;
}

let answeredThisDocument = false;

/** The reader answered the ask in this document. The policy's dismiss calls it. */
export function noteMapFirstVisitArrivalAnswered(): void {
  answeredThisDocument = true;
}

/**
 * The Pal's sign-in chip is not a first-visit prompt. It waits while the ask
 * has no answer, and for the rest of the document in which it was answered.
 * The Pal's door on the map is the way in until then.
 */
export function mapFirstVisitHoldsPalSignIn(storage?: Storage | null): boolean {
  if (answeredThisDocument || mapFirstVisitArrivalBlocksConsent() || mapFirstVisitPromptsSuppressed()) return true;
  const store = storage === undefined ? safeLocalStorage() : storage;
  if (!store) return false;
  try {
    return store.getItem(MAP_FIRST_VISIT_ARRIVAL_KEY) === null;
  } catch {
    return false;
  }
}

export function subscribeMapFirstVisitArrival(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

const fairPintDraws = new Set<symbol>();
const drawWaiters = new Set<() => void>();
export const fairPintDrawPending = () => fairPintDraws.size > 0;
export function holdFairPintDraw(): () => void {
  const request = Symbol();
  fairPintDraws.add(request);
  return () => {
    if (!fairPintDraws.delete(request) || fairPintDraws.size) return;
    for (const resume of drawWaiters) resume();
    drawWaiters.clear();
  };
}
export async function waitForFairPintDraw(): Promise<void> {
  while (fairPintDraws.size) await new Promise<void>((resolve) => drawWaiters.add(resolve));
}
