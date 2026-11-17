/** Fired before primary-tab navigation so open map sheets can dismiss first. */
export const MOBILE_SHEET_DISMISS_EVENT = "pubmax:mobile-sheet-dismiss";

/**
 * Returns true when a listener takes responsibility for navigation.
 * The caller must then prevent its default navigation.
 */
export function requestMobileSheetDismiss(navigate: () => void): boolean {
  if (typeof window === "undefined") return false;
  return !window.dispatchEvent(new CustomEvent(MOBILE_SHEET_DISMISS_EVENT, {
    cancelable: true,
    detail: navigate,
  }));
}

