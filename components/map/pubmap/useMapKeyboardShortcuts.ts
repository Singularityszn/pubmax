import { useEffect } from "react";
import { hasEscapeDismissal, useDismissOnEscape } from "@/lib/useDismissOnEscape";

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
export function useMapKeyboardShortcuts({
  planningOpen,
  selectedVenueId,
  onBack,
  onInterruptReveal,
  logIntentFallbackVisible,
  dismissLogIntent,
}: KeyboardShortcutArgs) {
  useDismissOnEscape(logIntentFallbackVisible, dismissLogIntent);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
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
        if (hasEscapeDismissal()) return;
        if (planningOpen || selectedVenueId) {
          onInterruptReveal();
          onBack();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    onBack,
    onInterruptReveal,
    planningOpen,
    selectedVenueId,
  ]);
}
