import { useLayoutEffect, useRef } from "react";
type KeyboardShortcutArgs = {
  mobileViewport: boolean;
  planningOpen: boolean;
  selectedVenueId: string;
  storyOpen?: boolean;
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
  mobileViewport,
  planningOpen,
  selectedVenueId,
  storyOpen = false,
  onBack,
  onInterruptReveal,
  logIntentFallbackVisible,
  dismissLogIntent,
}: KeyboardShortcutArgs) {
  const current = useRef<KeyboardShortcutArgs>({
    mobileViewport,
    planningOpen,
    selectedVenueId,
    storyOpen,
    onBack,
    onInterruptReveal,
    logIntentFallbackVisible,
    dismissLogIntent,
  });
  useLayoutEffect(() => {
    current.current = {
      mobileViewport,
      planningOpen,
      selectedVenueId,
      storyOpen,
      onBack,
      onInterruptReveal,
      logIntentFallbackVisible,
      dismissLogIntent,
    };
  });

  // Map paints and focuses a drawer during the same commit. Keep one listener
  // installed across its render churn, with current navigation state ready
  // before that focused Close button can receive Escape.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const pendingBackDecisions = new Set<number>();
    const onKeyDown = (event: KeyboardEvent) => {
      // A popover that handled Escape (city switcher, layers, price, zone,
      // status banner) claims the key via preventDefault. One Escape closes
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
        // The Drop picker sits above the sheet. Claim its key first, so the
        // sheet listener does not also step through the surface trail.
        const { logIntentFallbackVisible, dismissLogIntent } = current.current;
        if (logIntentFallbackVisible) {
          event.preventDefault();
          dismissLogIntent();
          return;
        }
        // Some popovers attach their own window listener after this stable
        // listener. A microtask may run between native event listeners, so
        // decide on the next task after every listener has had the key.
        // Read current state then, not a stale render.
        const timer = window.setTimeout(() => {
          pendingBackDecisions.delete(timer);
          if (!active || event.defaultPrevented) return;
          const {
            mobileViewport,
            planningOpen,
            selectedVenueId,
            storyOpen,
            onBack,
            onInterruptReveal,
            logIntentFallbackVisible: pickerNowOpen,
            dismissLogIntent: dismissPickerNow,
          } = current.current;
          if (pickerNowOpen) {
            dismissPickerNow();
            return;
          }
          // Phone sheet owns Escape while visible. A CSS-hidden portal cannot
          // own the key when viewport changes before React removes it.
          const phoneSheet = document.querySelector<HTMLElement>(".mobileSheetPortal");
          if (mobileViewport || (phoneSheet && window.getComputedStyle(phoneSheet).display !== "none")) return;
          // Then planner (higher z on mobile), venue detail, or landmark story.
          if (planningOpen || selectedVenueId || storyOpen) {
            onInterruptReveal();
            onBack();
          }
        }, 0);
        pendingBackDecisions.add(timer);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      active = false;
      for (const timer of pendingBackDecisions) window.clearTimeout(timer);
      pendingBackDecisions.clear();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
