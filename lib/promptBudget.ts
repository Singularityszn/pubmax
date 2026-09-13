// Shared session "prompt budget" — one interruptive prompt surface per browser
// session (Cycle-4 Wave-C cross-lane guard). The A2HS install prompt, the
// first-run analytics choice, first-run tour (#296), and identity nudges all
// compete for the same moment of the user's attention; stacking two of them
// in one session reads as nagging. This module is the single source of truth
// for "has some surface already interrupted the user this session?" so each
// lane can adopt it independently without touching the others' code.
//
// Scope = one browser tab session (sessionStorage), which is exactly the
// "same session" the PRD means: a fresh tab/visit resets the budget, but a
// single sitting only ever sees one prompt. SSR-safe and private-mode-safe:
// when consent storage is unavailable, analytics choice keeps priority.

import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  isAnalyticsConsentDecision,
} from "@/lib/analyticsIdentity";
import {
  getMapLocationControlAvailable,
  subscribeMapLocationControl,
} from "@/lib/mapLocationPrompt";
import {
  mapFirstVisitArrivalBlocksConsent,
  subscribeMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrival";

/** sessionStorage slot holding the surface id that has spent the budget. */
const STORAGE_KEY = "pubmax:prompt-budget:v1";
/** Same-tab notify so useSyncExternalStore clients re-read after a write. */
const CHANGE_EVENT = "pubmax:prompt-budget";

/**
 * Canonical surface ids. Kept as a plain string union (not an enum) so a new
 * lane can add its own id without a cross-lane edit. Any non-empty string is
 * accepted at runtime.
 */
export type PromptSurface =
  | "analytics-consent"
  | "a2hs"
  | "first-run-tour"
  | "identity-nudge"
  | (string & {});

export const ANALYTICS_CONSENT_PROMPT_SURFACE: PromptSurface = "analytics-consent";

export function locationAllowsInterruptivePrompt(): boolean {
  return (
    !getMapLocationControlAvailable() && !mapFirstVisitArrivalBlocksConsent()
  );
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function resolveConsentStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function analyticsChoiceHasPriority(
  surface: PromptSurface,
  consentStorage?: Storage | null,
): boolean {
  if (surface === ANALYTICS_CONSENT_PROMPT_SURFACE) return true;
  const store = resolveConsentStorage(consentStorage);
  if (!store) return false;
  try {
    return isAnalyticsConsentDecision(
      store.getItem(ANALYTICS_CONSENT_STORAGE_KEY),
    );
  } catch {
    return false;
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
 * is never blocked by its own earlier claim).
 */
export function hasPromptBudgetFor(
  surface: PromptSurface,
  storage?: Storage | null,
  consentStorage?: Storage | null,
): boolean {
  if (!locationAllowsInterruptivePrompt()) return false;
  if (!analyticsChoiceHasPriority(surface, consentStorage)) return false;
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
export function claimPromptBudget(
  surface: PromptSurface,
  storage?: Storage | null,
  consentStorage?: Storage | null,
): boolean {
  if (!surface) return false;
  if (!locationAllowsInterruptivePrompt()) return false;
  if (!analyticsChoiceHasPriority(surface, consentStorage)) return false;
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

// ONE PROMPT CLAIMS THE FOOT OF THE SCREEN AT A TIME, AND SOME ROUTES ALREADY
// USE IT. Site audit 13 Sep 2026 (D3): on the phone map the analytics card was
// lifted above "Describe the outing", so the top chrome, the card, the pill and
// the dock took 38 percent of the map. The map's own foot is its answer, so an
// interruptive prompt waits for the next route there. A wait is not a claim and
// a stand-down is not a release: the slot stays unspent, or stays with the
// surface that already spent it, and that surface comes back on the next route
// that does not own its foot.

/** Route families whose own chrome owns the foot of the screen. */
const SCREEN_FOOT_ROUTE_FAMILIES = ["/map"] as const;

/**
 * Whether the page at `pathname` owns the foot of the screen, so no prompt may
 * claim it there. A pathname we cannot read answers false, which is how every
 * other route behaves.
 */
export function routeOwnsScreenFoot(pathname: string | null | undefined): boolean {
  if (typeof pathname !== "string") return false;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  if (path === "") return false;
  return SCREEN_FOOT_ROUTE_FAMILIES.some(
    (family) => path === family || path.startsWith(`${family}/`),
  );
}

/** `hasPromptBudgetFor`, refused on a route that owns the screen foot. */
export function hasScreenFootFor(
  surface: PromptSurface,
  pathname: string | null | undefined,
  storage?: Storage | null,
  consentStorage?: Storage | null,
): boolean {
  if (routeOwnsScreenFoot(pathname)) return false;
  return hasPromptBudgetFor(surface, storage, consentStorage);
}

/**
 * `claimPromptBudget`, refused on a route that owns the screen foot. The refusal
 * writes nothing, so the session's one slot is still there on the next route.
 */
export function claimScreenFoot(
  surface: PromptSurface,
  pathname: string | null | undefined,
  storage?: Storage | null,
  consentStorage?: Storage | null,
): boolean {
  if (routeOwnsScreenFoot(pathname)) return false;
  return claimPromptBudget(surface, storage, consentStorage);
}

/**
 * Subscribe to budget changes (same-tab writes + cross-tab `storage`). For
 * `useSyncExternalStore` in prompt clients that want to re-evaluate when a
 * sibling surface claims the budget.
 */
export function subscribePromptBudget(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  const unsubscribeLocation = subscribeMapLocationControl(handler);
  const unsubscribeArrival = subscribeMapFirstVisitArrival(handler);
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    unsubscribeLocation();
    unsubscribeArrival();
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
