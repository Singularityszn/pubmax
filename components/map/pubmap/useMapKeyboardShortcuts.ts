import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

type KeyboardShortcutArgs = {
  planningOpen: boolean;
  closePlanning: () => void;
  closeComposer: () => void;
  setSelectedVenueId: Dispatch<SetStateAction<string>>;
  /** D4 — the Drop pub picker is topmost, and Escape must be a way out of it. */
  logIntentFallbackVisible: boolean;
  dismissLogIntent: () => void;
};

// Keyboard shortcuts: "/" focuses search (unless already typing), Esc clears
// the selected venue. The effect only adds/removes a DOM listener — the handler
// calls setState, which is allowed (react-hooks/set-state-in-effect forbids
// setState in the effect BODY, not in listeners it registers).
// Extracted verbatim from PubMap (F1).
export function useMapKeyboardShortcuts({
  planningOpen,
  closePlanning,
  closeComposer,
  setSelectedVenueId,
  logIntentFallbackVisible,
  dismissLogIntent,
}: KeyboardShortcutArgs) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A popover that handled Escape (city switcher, layers, price, zone,
      // status banner) claims the key via preventDefault — one Escape closes
      // one layer, never the drawer underneath it too.
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (event.key === "/" && !typing) {
        const search = document.getElementById("mapSearchInput") as HTMLInputElement | null;
        if (search) {
          event.preventDefault();
          search.focus();
        }
      } else if (event.key === "Escape") {
        // Topmost first: the Drop pub picker, then the planner (higher z on
        // mobile), then venue detail.
        if (logIntentFallbackVisible) {
          dismissLogIntent();
          return;
        }
        if (planningOpen) {
          closePlanning();
          return;
        }
        setSelectedVenueId((current) => {
          if (!current) return current;
          closeComposer();
          // Closing the pub ends the Drop flow, same as the sheet's own X.
          dismissLogIntent();
          return "";
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeComposer,
    closePlanning,
    dismissLogIntent,
    logIntentFallbackVisible,
    planningOpen,
    setSelectedVenueId,
  ]);
}
