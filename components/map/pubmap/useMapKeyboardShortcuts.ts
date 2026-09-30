import { useEffect, useLayoutEffect, useRef } from "react";
type KeyboardShortcutArgs = {
  planningOpen: boolean;
  selectedVenueId: string;
  onBack: () => void;
  onInterruptReveal: () => void;
  /** D4 — the Drop pub picker is topmost, and Escape must be a way out of it. */
  logIntentFallbackVisible: boolean;
  dismissLogIntent: () => void;
};

// Keyboard shortcuts: "/" focuses search (unless already typing), Esc asks the
// Map navigation owner to step Back. The effect only adds/removes a DOM listener - the handler
// calls setState, which is allowed (react-hooks/set-state-in-effect forbids
// setState in the effect BODY, not in listeners it registers).
// Kept in a small hook so PubMap owns navigation while reveal interruption
// remains part of the same Escape path.
export function useMapKeyboardShortcuts(args: KeyboardShortcutArgs) {
  const currentArgs = useRef(args);
  useLayoutEffect(() => {
    currentArgs.current = args;
  }, [args]);

  // Keep registration stable: an earlier key listener can rerender the map
  // during dispatch, and replacing this listener would drop that same key.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const {
        planningOpen,
        selectedVenueId,
        onBack,
        onInterruptReveal,
        logIntentFallbackVisible,
        dismissLogIntent,
      } = currentArgs.current;
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
        if (planningOpen || selectedVenueId) {
          onInterruptReveal();
          onBack();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
