// The consent gate half of the first-visit map arrival (lib/mapFirstVisitArrival.ts).
//
// The analytics prompt is mounted at the root on every route and has to wait
// behind the arrival card, so it reads this signal. It used to read it from the
// policy module, whose eligibility rules import the planner params and the
// explicit-map-intent parser, and through them the venue index, the shard
// loader, route legs, culture crawls and community prices: about 200 KB of map
// code in the shell every page downloads, for one boolean and one event name.
// This module imports nothing, so the root shell pays for exactly that.

/** The event every arrival change fires, for the consent prompt to re-read. */
const MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT = "pubmax:map-first-visit-arrival";

export function notifyMapFirstVisitArrivalChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT));
  } catch {
    // Older environments without Event ctor still keep the storage write.
  }
}

let arrivalCardVisible = false;

/** The mounted card reports visibility so consent can wait behind it. */
export function setMapFirstVisitArrivalCardVisible(visible: boolean): void {
  if (arrivalCardVisible === visible) return;
  arrivalCardVisible = visible;
  notifyMapFirstVisitArrivalChange();
}

export function mapFirstVisitArrivalBlocksConsent(): boolean {
  return arrivalCardVisible;
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
