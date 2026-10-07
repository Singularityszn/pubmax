// The one answer to "is the on-screen keyboard covering the bottom of the
// screen right now", and the one place that says what counts as evidence.
//
// Browser keyboards usually shrink the visual viewport. Android's native
// inset handling shrinks the layout viewport too, placing a fixed bar above
// the keyboard. Both modes need the same answer before withdrawing chrome.
//
// TWO facts have to agree before we hide it, because either one alone lies.
// A focused field alone is not a keyboard: a physical keyboard, a desktop
// browser and an iPad with a Magic Keyboard all focus fields and raise
// nothing. A shrunken visual viewport alone is not a keyboard either: a
// collapsing URL bar, a find-in-page strip and pinch zoom all move it. The
// pair together is the honest signal, which is why this module reports the
// pair rather than either half.
//
// The bar is hidden by TRANSFORM alone (components/nav/mobileNav.css, the same
// idiom the night-mode rule already uses). Nothing here touches the body's
// bottom padding: that clearance is reserved for the bar's own height, and
// dropping it while the keyboard is open would reflow the page underneath the
// caret - the layout jump this fix exists to avoid.

import { nativePlatform } from "@/lib/nativePlatform";

/**
 * How much of the layout viewport the visual viewport must lose before we call
 * it a keyboard.
 *
 * A soft keyboard takes roughly a third of a phone screen (about 300px of an
 * 844px iPhone viewport). The browser chrome that also moves the visual
 * viewport - a collapsing URL bar, a find bar - costs about a tenth. 15% sits
 * between the two with room on both sides.
 */
export const SOFT_KEYBOARD_MIN_SHRINK_RATIO = 0.15;

/** Input types that raise a keyboard. Everything else is a control. */
const TEXT_ENTRY_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/**
 * Whether this element is the kind of thing a keyboard opens for. A bare
 * `<input>` with no type attribute is a text input, which is why the default
 * here is "text" rather than a refusal.
 */
export function isTextEntryElement(element: Element | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return TEXT_ENTRY_INPUT_TYPES.has(type);
  }
  // A rich-text surface raises the same keyboard as a textarea. `isContentEditable`
  // is inherited, so a caret inside a child of the editable host answers true.
  return (element as HTMLElement).isContentEditable === true;
}

export type SoftKeyboardEvidence = {
  /** A text input, textarea or editable host currently holds focus. */
  textEntryFocused: boolean;
  /** visualViewport.height, in CSS pixels. */
  visualViewportHeight: number;
  /** window.innerHeight - the layout viewport the fixed bar is pinned to. */
  layoutViewportHeight: number;
};

/**
 * The rule. Both halves must hold, and an unmeasurable viewport answers false:
 * a browser that cannot tell us has not told us there is a keyboard, and
 * hiding the navigation on a guess costs more than leaving it up.
 */
export function softKeyboardOpen(evidence: SoftKeyboardEvidence): boolean {
  if (!evidence.textEntryFocused) return false;
  const { visualViewportHeight: visual, layoutViewportHeight: layout } = evidence;
  if (!Number.isFinite(visual) || !Number.isFinite(layout) || layout <= 0) return false;
  return layout - visual >= layout * SOFT_KEYBOARD_MIN_SHRINK_RATIO;
}

/** Read the live evidence out of the document. Browser only. */
function readEvidence(): SoftKeyboardEvidence {
  const visual = window.visualViewport;
  const focused = isTextEntryElement(document.activeElement);
  // Android's inset handling resizes both viewports. With no field focused the
  // view is unobscured, so that reading is the baseline. A focused field keeps
  // it. After a width change (a rotation or a resized window) it keeps it only
  // while the keyboard stays up, and takes the new height once it closes.
  const android = nativePlatform() === "android";
  if (android) {
    const widthChanged = window.innerWidth !== nativeLayoutWidth;
    const keyboardGone = !open || window.innerHeight > nativeLastHeight;
    const reBase = !focused || (widthChanged && keyboardGone);
    nativeLayoutHeight = reBase ? window.innerHeight : Math.max(nativeLayoutHeight, window.innerHeight);
    if (reBase) nativeLayoutWidth = window.innerWidth;
    nativeLastHeight = window.innerHeight;
  }
  return {
    textEntryFocused: focused && (visual?.scale ?? 1) === 1,
    visualViewportHeight: visual ? visual.height : Number.NaN,
    layoutViewportHeight: android ? nativeLayoutHeight : window.innerHeight,
  };
}

// useSyncExternalStore requires a cached snapshot: recomputing from the DOM on
// every render would hand React a fresh answer mid-commit. The listeners below
// are the only writers.
let open = false;
let nativeLayoutHeight = 0;
let nativeLayoutWidth = 0;
let nativeLastHeight = 0;
const listeners = new Set<() => void>();

function refresh(): void {
  const next = softKeyboardOpen(readEvidence());
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

// `focusout` fires BEFORE the next field takes focus, and during it
// document.activeElement is the body. Recomputing there would answer "no text
// field" for one task every time somebody moves from one field to the next,
// flashing the bar back over the keyboard between them. Deferring by a task
// lets the incoming focus land first; opening is deferred by the same task,
// which is nothing against the keyboard's own animation.
let pendingFocusCheck: ReturnType<typeof setTimeout> | null = null;

function refreshAfterFocusSettles(): void {
  if (pendingFocusCheck !== null) return;
  pendingFocusCheck = setTimeout(() => {
    pendingFocusCheck = null;
    refresh();
  }, 0);
}

/** Current answer. Always false on the server and before the first subscriber. */
export function readSoftKeyboardOpen(): boolean {
  return open;
}

/** SSR/hydration snapshot: the server has no viewport and no caret. */
export function serverSoftKeyboardOpen(): boolean {
  return false;
}

/**
 * Subscribe to keyboard open/close. DOM listeners attach for the first
 * subscriber and detach with the last, so a page with no tab bar pays nothing.
 *
 * `focusin`/`focusout` bubble (unlike focus/blur), so one document listener
 * covers every field on the page. visualViewport `resize` is the keyboard
 * itself; `scroll` is how iOS reports the viewport being pushed up.
 */
export function subscribeSoftKeyboard(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(onStoreChange);
  if (listeners.size === 1) {
    document.addEventListener("focusin", refreshAfterFocusSettles, true);
    document.addEventListener("focusout", refreshAfterFocusSettles, true);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
    window.addEventListener?.("resize", refresh);
    refresh();
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size > 0) return;
    document.removeEventListener("focusin", refreshAfterFocusSettles, true);
    document.removeEventListener("focusout", refreshAfterFocusSettles, true);
    window.visualViewport?.removeEventListener("resize", refresh);
    window.visualViewport?.removeEventListener("scroll", refresh);
    window.removeEventListener?.("resize", refresh);
    if (pendingFocusCheck !== null) {
      clearTimeout(pendingFocusCheck);
      pendingFocusCheck = null;
    }
    // The bar comes back with the last subscriber gone; leaving `open` true
    // would hide it for the next mount with no keyboard on screen.
    open = false;
    nativeLayoutHeight = 0;
    nativeLayoutWidth = 0;
    nativeLastHeight = 0;
  };
}
