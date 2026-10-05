/**
 * The log intent's last few hundred pixels.
 *
 * `/map?log=1` is the working entry to the core loop: the reader has already
 * said the one thing they came to say, and the venue sheet then opens with the
 * Pint Drop composer's price step below the fold, so the price field sits at
 * the bottom edge of an 844px phone and "Log it" is off screen behind the
 * sheet's own action bar. The reader expressed exactly one intent and had to
 * scroll to act on it.
 *
 * This is a REVEAL and never a re-layout: nothing here changes what the sheet
 * renders, its snap detent or its tab, and the composer's own fields are
 * untouched. It scrolls the price step into view once the composer has mounted,
 * and it deliberately does NOT move focus: focusing the price field raises the
 * soft keyboard, which is a second decision (`lib/softKeyboard.ts` handles it
 * correctly either way) and a bigger change than the one the gap asks for.
 */

/** The composer's first block, which is the price field and its quick adds. */
export const LOG_INTENT_PRICE_STEP_SELECTOR = '[data-testid="spill-price-step"]';

/**
 * Reduced motion means no glide, never no move: the reader still lands on the
 * price field, it just jumps there. The same reading `planRouteRevealBehavior`
 * takes for the plan route.
 */
export function logIntentRevealBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

type RevealRoot = Pick<Document, "querySelector">;

/**
 * The one reveal waiting for a price step, if any.
 *
 * The composer mounts only after the sheet has selected the venue, loaded its
 * panel and hydrated the saved draft, and how long that takes is the device's
 * business, not ours. The reveal used to poll for the price step against a
 * 1.5s wall-clock budget, and on a loaded machine the step mounted after the
 * budget ran out: the sheet stayed at its top and the reader had to scroll
 * after all, in about one arrival in four under parallel load. So the request
 * waits for the step instead of for a clock: the step reveals itself as it
 * mounts (`takeLogIntentReveal`), and a request the reader walks away from is
 * cancelled by the map (`useLogIntentRevealScope`), never by a timer.
 */
type PendingReveal = { reducedMotion: boolean };

let pendingReveal: PendingReveal | null = null;

type RevealFrame = (callback: () => void) => unknown;

/**
 * Ask for the next price step to be revealed. A composer that is not open yet
 * takes the request as its step mounts. One that is already open will not
 * mount again, so its step is looked up on the next frame, after the sheet has
 * committed the detent and tab the same open asked for.
 */
export function requestLogIntentReveal(
  root: RevealRoot,
  reducedMotion: boolean,
  nextFrame: RevealFrame = browserNextFrame,
): void {
  const request: PendingReveal = { reducedMotion };
  pendingReveal = request;
  nextFrame(() => {
    if (pendingReveal !== request) return;
    takeLogIntentReveal(root.querySelector(LOG_INTENT_PRICE_STEP_SELECTOR) as HTMLElement | null);
  });
}

function browserNextFrame(callback: () => void): void {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(callback);
  } else {
    callback();
  }
}

/**
 * Called by the price step as it mounts. Reveals it when a request is waiting
 * and spends that request, so one log intent scrolls the sheet at most once.
 */
export function takeLogIntentReveal(step: HTMLElement | null): boolean {
  const request = pendingReveal;
  // jsdom and the older browsers behind the shell both answer an element with
  // no scrollIntoView, and a reveal that throws would take the composer with it.
  if (!request || !step || typeof step.scrollIntoView !== "function") return false;
  pendingReveal = null;
  step.scrollIntoView({
    behavior: logIntentRevealBehavior(request.reducedMotion),
    block: "start",
  });
  return true;
}

/** The wait can no longer end in the intent's composer, so no later composer
 *  may inherit this arrival's scroll. */
export function cancelLogIntentReveal(): void {
  pendingReveal = null;
}

/** The browser's own answer, read where a caller has no opinion. */
export function browserPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
