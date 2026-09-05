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
 * How long the reveal waits for the composer to mount. The sheet has to select
 * the venue, open the composer and hydrate its saved draft first, so the
 * element is not in the document on the frame the intent runs.
 */
export const LOG_INTENT_REVEAL_BUDGET_MS = 1_500;

/** How often it looks while it waits. */
export const LOG_INTENT_REVEAL_POLL_MS = 60;

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
 * One attempt. Answers whether the price step was there to reveal, so a caller
 * can keep waiting rather than reporting a reveal that never happened.
 */
export function revealLogIntentPriceStep(
  root: RevealRoot,
  reducedMotion: boolean,
): boolean {
  const step = root.querySelector(LOG_INTENT_PRICE_STEP_SELECTOR) as HTMLElement | null;
  // jsdom and the older browsers behind the shell both answer an element with
  // no scrollIntoView, and a reveal that throws would take the composer with it.
  if (!step || typeof step.scrollIntoView !== "function") return false;
  step.scrollIntoView({
    behavior: logIntentRevealBehavior(reducedMotion),
    block: "start",
  });
  return true;
}

/** Node answers a Timeout object where the browser answers a number, and the
 *  reveal never reads the value, so the id stays opaque to both. */
export type LogIntentRevealTimerId = number | ReturnType<typeof setTimeout>;

export type LogIntentRevealTimers = {
  setTimeout: (callback: () => void, ms: number) => LogIntentRevealTimerId;
  clearTimeout: (id: LogIntentRevealTimerId) => void;
  now: () => number;
};

export type LogIntentRevealDeps = {
  root: RevealRoot;
  reducedMotion: boolean;
  timers: LogIntentRevealTimers;
  budgetMs?: number;
  pollMs?: number;
};

/**
 * Wait for the composer, then reveal its price step. Returns a cancel function,
 * because the reader may close the sheet or pick another pub while we wait, and
 * a reveal that lands after that would scroll a surface nobody is looking at.
 */
export function scheduleLogIntentReveal(deps: LogIntentRevealDeps): () => void {
  const { root, reducedMotion, timers } = deps;
  const budgetMs = deps.budgetMs ?? LOG_INTENT_REVEAL_BUDGET_MS;
  const pollMs = deps.pollMs ?? LOG_INTENT_REVEAL_POLL_MS;
  const startedAt = timers.now();
  let timer: LogIntentRevealTimerId | null = null;
  let cancelled = false;

  const attempt = () => {
    timer = null;
    if (cancelled) return;
    if (revealLogIntentPriceStep(root, reducedMotion)) return;
    if (timers.now() - startedAt >= budgetMs) return;
    timer = timers.setTimeout(attempt, pollMs);
  };

  timer = timers.setTimeout(attempt, pollMs);

  return () => {
    cancelled = true;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
}

/** The browser's own clock and timers, so a test can hand in its own. */
export function browserRevealTimers(): LogIntentRevealTimers {
  return {
    // globalThis rather than window, because this module is imported by the map
    // and the map is imported by tests that run with no document at all.
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    now: () => Date.now(),
  };
}

/** The browser's own answer, read where a caller has no opinion. */
export function browserPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
