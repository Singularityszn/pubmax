// First-run onboarding tour gate — localStorage-backed, SSR-safe.
//
// A one-time welcome overlay orients a first-timer to the three core moves
// (the map, DROP, Discover). Once dismissed — by Skip, close, backdrop, Esc,
// or finishing — it is marked done and never shows again. Mirrors the
// storage idiom in lib/cityPreference.ts (hasStorage guard, try/catch, a
// same-tab CHANGE_EVENT so useSyncExternalStore clients re-read after a write).

/** Bump the `v1` suffix if the tour content changes enough to re-show it. */
const STORAGE_KEY = "pubmax-tour-v1-done";
/** Same-tab notify so useSyncExternalStore clients re-read after a write. */
const CHANGE_EVENT = "pubmax:first-run-tour";

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function notifyTourChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without the Event ctor still keep the storage write.
  }
}

/**
 * Whether the viewer has already seen (and dismissed) the first-run tour.
 * Returns `true` on SSR and on any storage failure so the overlay never
 * flashes for returning users or when storage is unavailable/private.
 */
export function hasSeenTour(): boolean {
  if (!hasStorage()) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

/** Persist that the tour is done. No-op on SSR / storage failure. */
export function markTourSeen(): void {
  if (!hasStorage()) return;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
    window.localStorage.setItem(STORAGE_KEY, "1");
    notifyTourChange();
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

/** Clear the flag so the tour shows again — handy for local testing. */
export function resetTour(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    notifyTourChange();
  } catch {
    // ignore
  }
}

/**
 * Subscribe to tour-seen changes (same-tab writes + cross-tab `storage`).
 * For `useSyncExternalStore` in the FirstRunTour client.
 */
export function subscribeTour(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Client snapshot for useSyncExternalStore. */
export function getTourSeenSnapshot(): boolean {
  return hasSeenTour();
}

/** Server snapshot — always "seen" so nothing renders during SSR. */
export function getTourSeenServerSnapshot(): boolean {
  return true;
}

/**
 * Whether `pathname` is a map surface (/map, /map/[city]) — the only place
 * the tour is allowed to render. It spotlights the map + mobile tab bar, so
 * it's meaningless everywhere else, and landing/tonight/feed/pint-index/etc.
 * must render clean on first paint for SEO, press, and first-tap.
 */
export function isTourEligiblePathname(pathname: string): boolean {
  return pathname === "/map" || pathname.startsWith("/map/");
}

/**
 * Pub Pal and You have their own focused onboarding. Stacking the generic
 * tour over either surface obscures consent, identity controls, and the
 * mobile tab bar.
 */
export function hasDedicatedOnboarding(pathname: string): boolean {
  return pathname === "/pal" || pathname.startsWith("/u/");
}

/** Full gate: whether the first-run tour overlay should render. */
export function shouldShowFirstRunTour(params: {
  mounted: boolean;
  seen: boolean;
  pathname: string;
}): boolean {
  const { mounted, seen, pathname } = params;
  return (
    mounted &&
    !seen &&
    isTourEligiblePathname(pathname) &&
    !hasDedicatedOnboarding(pathname)
  );
}
