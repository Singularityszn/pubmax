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
  querySelector: (selector: string) => FocusableLandmark | null;
};

/**
 * Move keyboard focus onto `#main`, making the landmark focusable when needed.
 * A page whose `<main>` has no id still gets the jump: the skip link cancels
 * the browser's own, so a missing id must not leave it doing nothing.
 * Returns false when the page has no main landmark at all.
 */
export function focusMainLandmark(
  doc: LandmarkDocument = typeof document !== "undefined"
    ? document
    : { getElementById: () => null, querySelector: () => null },
): boolean {
  const byId = doc.getElementById(MAIN_LANDMARK_ID);
  const main = byId ?? doc.querySelector("main");
  if (!main) return false;
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1");
  }
  main.focus();
  main.scrollIntoView({ block: "start" });
  // The address names the landmark only when an element answers to it.
  if (byId && typeof window !== "undefined" && window.location.hash !== `#${MAIN_LANDMARK_ID}`) {
    window.history.replaceState(null, "", `#${MAIN_LANDMARK_ID}`);
  }
  return true;
}
