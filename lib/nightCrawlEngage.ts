/** Cross-component cue: open Night Crawl on the plan page (first "here"). */
export const NIGHT_CRAWL_ENGAGE_EVENT = "pubmax:night-crawl-engage";

/** Cross-component cue: move a finished Crawl Route into its canonical ending sheet. */
export const NIGHT_MODE_OPEN_EVENT = "pubmax:night-mode-open";

const NIGHT_MODE_OPEN_REQUEST_KEY = "pubmax:night-mode-open-request";

type RequestStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function safeBrowserSessionStorage(): RequestStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function holdNightModeOpenRequest(storage: RequestStorage | null, planId: string): void {
  try {
    storage?.setItem(NIGHT_MODE_OPEN_REQUEST_KEY, planId);
  } catch {
    // Storage can be blocked. The same-frame event remains available.
  }
}

export function hasNightModeOpenRequest(storage: RequestStorage | null, planId: string): boolean {
  try {
    return storage?.getItem(NIGHT_MODE_OPEN_REQUEST_KEY) === planId;
  } catch {
    return false;
  }
}

export function takeNightModeOpenRequest(storage: RequestStorage | null, planId: string): boolean {
  try {
    if (!storage || storage.getItem(NIGHT_MODE_OPEN_REQUEST_KEY) !== planId) return false;
    storage.removeItem(NIGHT_MODE_OPEN_REQUEST_KEY);
    return true;
  } catch {
    return false;
  }
}

export function requestNightModeOpen(planId: string): void {
  holdNightModeOpenRequest(safeBrowserSessionStorage(), planId);
  window.dispatchEvent(new CustomEvent(NIGHT_MODE_OPEN_EVENT, { detail: { planId } }));
}
