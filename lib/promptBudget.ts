// Shared session "prompt budget" — one interruptive prompt surface per browser
// session (Cycle-4 Wave-C cross-lane guard). The A2HS install prompt, the
// first-run tour (#296), and the identity nudges lane (feat/identity-nudges)
// all compete for the same moment of the user's attention; stacking two of them
// in one session reads as nagging. This module is the single source of truth
// for "has some surface already interrupted the user this session?" so each
// lane can adopt it independently without touching the others' code.
//
// Scope = one browser tab session (sessionStorage), which is exactly the
// "same session" the PRD means: a fresh tab/visit resets the budget, but a
// single sitting only ever sees one prompt. SSR-safe and private-mode-safe:
// when storage is unavailable the guard degrades open (a prompt may show)
// rather than throwing — a rare double-prompt beats a broken flow.

/** sessionStorage slot holding the surface id that has spent the budget. */
const STORAGE_KEY = "pubmax:prompt-budget:v1";
/** Same-tab notify so useSyncExternalStore clients re-read after a write. */
const CHANGE_EVENT = "pubmax:prompt-budget";

/**
 * Canonical surface ids. Kept as a plain string union (not an enum) so a new
 * lane can add its own id without a cross-lane edit; these are the three known
 * today. Any non-empty string is accepted at runtime.
 */
export type PromptSurface = "a2hs" | "first-run-tour" | "identity-nudge" | (string & {});

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function notifyChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without the Event ctor still keep the storage write.
  }
}

/**
 * Which surface currently holds the session's prompt budget, or null when the
 * budget is still free. Returns null on SSR / storage failure.
 */
export function promptBudgetHolder(storage?: Storage | null): PromptSurface | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const held = store.getItem(STORAGE_KEY);
    return held && held.trim() !== "" ? held : null;
  } catch {
    return null;
  }
}

/**
 * Whether `surface` is allowed to show this session — true when the budget is
 * free OR already held by this same surface (so a re-render of the same prompt
 * is never blocked by its own earlier claim). Degrades open when storage is
 * unavailable.
 */
export function hasPromptBudgetFor(surface: PromptSurface, storage?: Storage | null): boolean {
  const store = resolveStorage(storage);
  if (!store) return true; // can't track — don't block the flow
  const held = promptBudgetHolder(store);
  return held === null || held === surface;
}

/**
 * Claim the session's prompt budget for `surface`. Idempotent for the holder.
 * Returns true when `surface` holds the budget after the call (free-and-claimed
 * or already-held), false when another surface got there first. Call this at
 * the moment a prompt actually becomes visible, not merely when it is eligible,
 * so an eligible-but-not-shown prompt never starves the others.
 */
export function claimPromptBudget(surface: PromptSurface, storage?: Storage | null): boolean {
  if (!surface) return false;
  const store = resolveStorage(storage);
  if (!store) return true; // can't track — allow, best-effort
  const held = promptBudgetHolder(store);
  if (held === surface) return true;
  if (held !== null) return false;
  try {
    store.setItem(STORAGE_KEY, surface);
    notifyChange();
    return true;
  } catch {
    return true; // write failed — allow, best-effort
  }
}

/**
 * Release the budget, but only if `surface` is the current holder — a surface
 * can never free another's claim. Use when a prompt claimed the budget but then
 * decided not to show (e.g. a late async gate flipped), so the moment isn't
 * wasted. A shown-then-dismissed prompt should NOT release: it did interrupt.
 */
export function releasePromptBudget(surface: PromptSurface, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  if (promptBudgetHolder(store) !== surface) return;
  try {
    store.removeItem(STORAGE_KEY);
    notifyChange();
  } catch {
    // Storage disabled mid-session — nothing to clean up.
  }
}

/**
 * Subscribe to budget changes (same-tab writes + cross-tab `storage`). For
 * `useSyncExternalStore` in prompt clients that want to re-evaluate when a
 * sibling surface claims the budget.
 */
export function subscribePromptBudget(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
