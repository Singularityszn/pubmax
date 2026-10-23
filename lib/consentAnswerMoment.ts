// THE PRODUCT ANSWERS FIRST, AND THE CONSENT CARD ARRIVES AFTER THE ANSWER.
//
// Captain's standing ask (PlanAstra section 3): "the primary asks before it
// gives" is wrong. The analytics consent card used to be the first thing a new
// reader met on every route at every width, before any answer: it covered the
// first listing at 360x640 on Tonight, the rail on the landing at 320x568, the
// city list on Places and the Founding hundred on Social, and until it was
// answered it sat over the fold on the smallest phones.
//
// This module is the whole of the TIMING rule and it is a leaf: it imports the
// safe-storage helper and nothing else, so a surface that merely reports its
// own answer moment pulls no analytics, venue or navigation lane in behind it.
//
// THE MARKER IS THE SESSION'S, NOT THE DEVICE'S. A reader who has never
// answered the analytics question meets the card once their first answer has
// landed in THIS sitting, which is the same scope `lib/promptBudget.ts` already
// spends its one interruptive slot over. A fresh tab starts the wait again,
// because a fresh tab is a fresh arrival and the arrival is the thing the card
// may not stand in front of.
//
// WHAT COUNTS AS AN ANSWER IS A CLOSED SET, because "the reader has been given
// something" is a product judgement rather than a heuristic over events. Each
// kind is a moment the product has already handed over what the reader came
// for:
//
//   `venue-sheet`  a pub's own sheet opened, which is both the sheet open and
//                  the pin tap: `components/map/useVenueSheetOpened.ts` is the
//                  ONE emitter of that moment for both pub layers, so a second
//                  copy of this mark cannot drift from it.
//   `pal-reply`    Pub Pal put an answer in the transcript.
//   `second-route` the reader reached a second distinct route this session,
//                  which is what a list-item tap, a card link and a tab all
//                  come out as. Recorded by the card itself from the live
//                  pathname rather than by every list in the tree, because a
//                  per-list mark would be a sweep no future list joins.
//
// NOTHING HERE IS ANALYTICS. No beacon fires from this module, no identifier is
// written, and the marker is one word in sessionStorage; the analytics rail
// stays exactly as consent-gated as it was.

import { safeSessionStorage } from "@/lib/safeStorage";

/** sessionStorage slot holding the answer kind that ended the wait. */
export const CONSENT_ANSWER_MOMENT_KEY = "pubmax:consent-answer-moment:v1";
/** sessionStorage slot holding the first route this session painted. */
export const CONSENT_FIRST_ROUTE_KEY = "pubmax:consent-first-route:v1";
/** sessionStorage slot naming the route a shell entry rewrite is heading for. */
const CONSENT_ENTRY_REWRITE_KEY = "pubmax:consent-entry-rewrite:v1";
/** Same-tab notify, because a storage write raises no event on its own tab. */
const CHANGE_EVENT = "pubmax:consent-answer-moment";

/**
 * The closed set of moments that count as the product having answered. A kind
 * outside this table counts as nothing, so a new surface joins by adding a row
 * here rather than by inventing a word of its own.
 */
export const CONSENT_ANSWER_KINDS = [
  "venue-sheet",
  "pal-reply",
  "second-route",
] as const;

export type ConsentAnswerKind = (typeof CONSENT_ANSWER_KINDS)[number];

export function isConsentAnswerKind(value: unknown): value is ConsentAnswerKind {
  return (
    typeof value === "string"
    && (CONSENT_ANSWER_KINDS as readonly string[]).includes(value)
  );
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  return safeSessionStorage();
}

function notifyChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without an Event constructor keep the storage write.
  }
}

/**
 * Which answer ended the wait, or null while the product has not answered yet.
 *
 * A storage we cannot read answers null, which is the CAUTIOUS side: with no
 * marker the card keeps waiting rather than painting over an arrival.
 */
export function consentAnswerMoment(
  storage?: Storage | null,
): ConsentAnswerKind | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(CONSENT_ANSWER_MOMENT_KEY);
    return isConsentAnswerKind(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Whether the product has answered this reader at least once this session. */
export function hasAnsweredThisSession(storage?: Storage | null): boolean {
  return consentAnswerMoment(storage) !== null;
}

/**
 * Record that the product has answered. The FIRST kind wins and a later one
 * writes nothing, so the marker names the moment the wait actually ended
 * rather than the reader's most recent tap.
 */
export function markConsentAnswerMoment(
  kind: ConsentAnswerKind,
  storage?: Storage | null,
): void {
  if (!isConsentAnswerKind(kind)) return;
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    if (isConsentAnswerKind(store.getItem(CONSENT_ANSWER_MOMENT_KEY))) return;
    store.setItem(CONSENT_ANSWER_MOMENT_KEY, kind);
  } catch {
    // Storage full or private mode: the wait simply continues.
    return;
  }
  notifyChange();
}

/**
 * Record the route the reader is on. The first route this session is merely
 * remembered; a DIFFERENT one is the `second-route` answer, because reaching a
 * second surface means the first one gave the reader somewhere to go.
 *
 * A pathname we cannot read is ignored rather than treated as a new route, or
 * a null pathname during a transition would end the wait on its own.
 */
export function noteConsentRouteVisited(
  pathname: string | null | undefined,
  storage?: Storage | null,
): void {
  if (typeof pathname !== "string" || pathname === "") return;
  const store = resolveStorage(storage);
  if (!store) return;

  // A SHELL ENTRY REWRITE IS IN FLIGHT, SO THE ROUTE IT IS LEAVING IS NOT A
  // ROUTE THE READER CHOSE. While the destination is pending, any other
  // pathname is recorded as nothing at all, and the destination itself becomes
  // this session's first route. Naming the destination is what makes this
  // independent of which effect React happens to run first: the reset can fire
  // before the landing has been noted, which is the order app/layout.tsx
  // actually produces, and the answer is the same either way.
  let pending: string | null;
  try {
    pending = store.getItem(CONSENT_ENTRY_REWRITE_KEY);
  } catch {
    return;
  }
  if (pending !== null) {
    if (pending !== pathname) return;
    try {
      store.removeItem(CONSENT_ENTRY_REWRITE_KEY);
      store.setItem(CONSENT_FIRST_ROUTE_KEY, pathname);
    } catch {
      // Storage refused the swap: the next route reads as the first one again,
      // which is the cautious side (the card keeps waiting).
    }
    return;
  }

  let first: string | null;
  try {
    first = store.getItem(CONSENT_FIRST_ROUTE_KEY);
  } catch {
    return;
  }
  if (first === null) {
    try {
      store.setItem(CONSENT_FIRST_ROUTE_KEY, pathname);
    } catch {
      // Nothing recorded, so the next route is read as the first one again.
    }
    return;
  }
  if (first === pathname) return;
  markConsentAnswerMoment("second-route", storage);
}

/**
 * Undo the wait that the SHELL'S OWN entry rewrite started.
 *
 * Older Capacitor binaries open the site root and lib/entryDecision.ts rewrites
 * it to /tonight or /onboarding. Two routes went past this module in one arrival,
 * so `second-route` fired and the card met a new reader on the FIRST screen of
 * the app — before the product had answered anything, which is the one thing
 * this module exists to prevent. Measured in the iPhone 17 Pro simulator and
 * the Pixel 7 emulator on 7 September 2026 (docs/proof/mobile-shells-refresh/).
 *
 * A rewrite is the app's own move, not the reader's, so the first route is
 * forgotten and the DESTINATION becomes the first route instead. The answer
 * marker is cleared ONLY when it is `second-route`: at the moment of the
 * cold-start rewrite no venue sheet has opened and Pub Pal has said nothing, so
 * `second-route` there can only have come from the rewrite itself, while a real
 * answer must survive.
 *
 * THE DESTINATION IS NAMED RATHER THAN ASSUMED, because clearing state is only
 * half the job when the order is not ours to choose. AppEntryRoute is inside
 * {children} in app/layout.tsx and AnalyticsConsentPrompt is mounted after it,
 * so React fires this reset BEFORE the landing route has been recorded at all:
 * it cleared an empty slot, the landing then recorded itself as the first route
 * anyway, and the destination read as the reader's own second route. Holding
 * the destination in storage makes `noteConsentRouteVisited` swallow whatever
 * route the rewrite is leaving, in either order.
 */
export function resetConsentWaitForEntryRewrite(
  destination: string,
  storage?: Storage | null,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(CONSENT_FIRST_ROUTE_KEY);
    if (typeof destination === "string" && destination !== "") {
      store.setItem(CONSENT_ENTRY_REWRITE_KEY, destination);
    }
    if (store.getItem(CONSENT_ANSWER_MOMENT_KEY) === "second-route") {
      store.removeItem(CONSENT_ANSWER_MOMENT_KEY);
    }
  } catch {
    // Storage full or private mode: the card keeps waiting, which is the
    // cautious side of this module either way.
    return;
  }
  notifyChange();
}

export function subscribeConsentAnswerMoment(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
