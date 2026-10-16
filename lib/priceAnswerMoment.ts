// THE INSTALL ASK WAITS FOR A PRICE ANSWER.
//
// Product owner, Oct 2026 UX audit (P2-C): the home-screen install is asked
// for only after the reader has been handed a listed pint in THIS sitting,
// never on a first paint. This module is that one signal, and it is a leaf
// (safe storage and nothing else) so a surface that reports the moment pulls
// no install, analytics or venue code in behind it.
//
// WHAT COUNTS is a CLOSED set, the two places a reader is handed a price:
//
//   `near-answer`   the /near answer card with a dated, sourced price on top
//   `venue-price`   a pub's own sheet showing a price from a named lane
//
// THE MARKER IS THE SESSION'S, the same scope `lib/promptBudget.ts` spends its
// one interruptive slot over: a fresh tab is a fresh arrival and waits again.
// NOTHING HERE IS ANALYTICS: no beacon, no identifier, one word in
// sessionStorage, and a storage we cannot read keeps the ask waiting.

import { safeSessionStorage } from "@/lib/safeStorage";

export const PRICE_ANSWER_MOMENT_KEY = "pubmax:price-answer-moment:v1";
const CHANGE_EVENT = "pubmax:price-answer-moment";

const PRICE_ANSWER_KINDS = ["near-answer", "venue-price"] as const;
export type PriceAnswerKind = (typeof PRICE_ANSWER_KINDS)[number];

function isPriceAnswerKind(value: unknown): value is PriceAnswerKind {
  return typeof value === "string" && (PRICE_ANSWER_KINDS as readonly string[]).includes(value);
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  return safeSessionStorage();
}

/** Which price answer this session saw first, or null while none has landed. */
export function priceAnswerMoment(storage?: Storage | null): PriceAnswerKind | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(PRICE_ANSWER_MOMENT_KEY);
    return isPriceAnswerKind(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function hasPriceAnswerThisSession(storage?: Storage | null): boolean {
  return priceAnswerMoment(storage) !== null;
}

/** Record the moment. The FIRST kind wins; a later one writes nothing. */
export function markPriceAnswerMoment(kind: PriceAnswerKind, storage?: Storage | null): void {
  if (!isPriceAnswerKind(kind)) return;
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    if (isPriceAnswerKind(store.getItem(PRICE_ANSWER_MOMENT_KEY))) return;
    store.setItem(PRICE_ANSWER_MOMENT_KEY, kind);
  } catch {
    return;
  }
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // No Event constructor: the write still landed.
  }
}

export function subscribePriceAnswerMoment(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
