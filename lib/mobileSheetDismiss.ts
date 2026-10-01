/** Fired before primary-tab navigation so open map sheets can dismiss first. */
export const MOBILE_SHEET_DISMISS_EVENT = "pubmax:mobile-sheet-dismiss";

export function requestMobileSheetDismiss(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MOBILE_SHEET_DISMISS_EVENT));
}
