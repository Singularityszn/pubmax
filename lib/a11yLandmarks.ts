/** Shared id for the page's primary `<main>` landmark — skip links target this. */
export const MAIN_LANDMARK_ID = "main";

type FocusableLandmark = {
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, value: string) => void;
  focus: () => void;
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

type LandmarkDocument = {
  getElementById: (id: string) => FocusableLandmark | null;
};

/**
 * Move keyboard focus onto `#main`, making the landmark focusable when needed.
 * Returns false when the page has no matching landmark.
 */
export function focusMainLandmark(
  doc: LandmarkDocument = typeof document !== "undefined"
    ? document
    : { getElementById: () => null },
): boolean {
  const main = doc.getElementById(MAIN_LANDMARK_ID);
  if (!main) return false;
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1");
  }
  main.focus();
  main.scrollIntoView({ block: "start" });
  if (typeof window !== "undefined" && window.location.hash !== `#${MAIN_LANDMARK_ID}`) {
    window.history.replaceState(window.history.state, "", `#${MAIN_LANDMARK_ID}`);
  }
  return true;
}

/** Carry an early skip-link activation across a loading landmark replacement. */
export function restoreMainLandmarkFocus(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.location.hash !== `#${MAIN_LANDMARK_ID}`) return;
  // Removing the focused loading main leaves focus on the document. A reader
  // who has already moved to another control owns that focus instead.
  if (document.activeElement !== document.body &&
    document.activeElement !== document.documentElement) return;
  focusMainLandmark();
}
