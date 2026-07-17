// Identity nudge gate — decides WHEN to offer the signed-out user an account
// (Google/Microsoft OAuth) after a genuinely high-intent action. This is the
// WEB implementation of the Cycle-2 locked owner decision: "push identity
// harder — account prompt after the FIRST PLAN ACTION and after the FIRST
// MOMENT CAPTURE; browsing / map / prices are NEVER gated."
//
// Two qualifying triggers, each recorded from its own success path:
//   • "plan"   — a plan was created or joined successfully.
//   • "moment" — the first Moment DRAFT with real content was saved on-device
//                by a guest. (The server save path already requires auth, so a
//                signed-out capture can only ever be a local draft — that is
//                exactly the moment to say "own your memories".)
//
// Unlike the native push gate (lib/nativePushPrompt.ts, PR #299), which never
// re-offers within the same action sequence, this gate is TIME-based: a
// "not now" dismissal is remembered and the gate stays shut for N days, then
// re-opens on the next qualifying action. It never fires once signed in and
// never fires for a web crawler / SSR render (both would be pure noise and
// could pollute prerendered HTML). Browsing, map, and prices are untouched.
//
// Storage mirrors the lib/firstRunTour.ts / lib/nativePushPrompt.ts idiom:
// localStorage-backed, SSR-safe, same-tab CHANGE_EVENT for useSyncExternalStore,
// no-ops when storage is unavailable (private mode / disabled).
//
// ── Ordering vs the native push prompt (PR #299) ─────────────────────────────
// In the native shell BOTH this identity nudge and the push pre-permission
// prompt can be armed by the same plan success. Identity wins first: the push
// prompt must defer to the NEXT qualifying action whenever an identity nudge is
// pending for a signed-out user. The push wiring consults isIdentityNudgePending()
// (below) before it bumps its own action sequence; when #299 lands, the plan
// success path records the identity nudge first, then only records the push
// action if `!isIdentityNudgePending()`. On the web the push gate is inert
// (native-only), so there is no conflict there.

export type IdentityNudgeTrigger = "plan" | "moment";

const DISMISSED_AT_KEY = "pubmax:identityNudge:dismissedAt:v1";
const PENDING_KEY = "pubmax:identityNudge:pending:v1";

/** How long a "not now" keeps the gate shut before the next qualifying action can re-open it. */
export const IDENTITY_NUDGE_COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
export const IDENTITY_NUDGE_COOLDOWN_MS = IDENTITY_NUDGE_COOLDOWN_DAYS * DAY_MS;

/** Same-tab notify so useSyncExternalStore clients (the nudge UI) re-read after a write. */
export const IDENTITY_NUDGE_EVENT = "pubmax:identity-nudge";

// Conservative bot/crawler UA match — enough to keep the nudge out of
// prerender/screenshot/social-unfurl traffic without trying to be exhaustive.
const CRAWLER_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|prerender|headlesschrome|lighthouse|pingdom|gtmetrix/i;

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readOptionalInt(key: string): number | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function readPending(): IdentityNudgeTrigger | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    return raw === "plan" || raw === "moment" ? raw : null;
  } catch {
    return null;
  }
}

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(IDENTITY_NUDGE_EVENT));
  } catch {
    // Older environments without an Event ctor still keep the storage write.
  }
}

/** True for a web crawler / prerender agent — never nudge those. SSR-safe. */
export function isWebCrawler(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return typeof ua === "string" && CRAWLER_UA.test(ua);
}

export type IdentityNudgeGateState = {
  /** A qualifying action is waiting to be offered ("plan" | "moment"), or none. */
  pendingTrigger: IdentityNudgeTrigger | null;
  /** The user already has an account/session — never nudge. */
  signedIn: boolean;
  /** Web crawler / prerender / SSR — never nudge. */
  isCrawler: boolean;
  /** Epoch ms of the last "not now", or null if never dismissed. */
  lastDismissedAt: number | null;
  /** Current epoch ms. */
  now: number;
  /** Dismissal cooldown window in ms. */
  cooldownMs: number;
};

/**
 * Pure gate — exported for unit testing. No storage / DOM access. Offers the
 * nudge only when a qualifying action is pending, the user is signed out, this
 * is not a crawler/SSR path, and any prior "not now" is older than the cooldown.
 */
export function shouldOfferIdentityNudge(state: IdentityNudgeGateState): boolean {
  if (state.signedIn) return false;
  if (state.isCrawler) return false;
  if (state.pendingTrigger === null) return false;
  if (
    state.lastDismissedAt !== null &&
    state.now - state.lastDismissedAt < state.cooldownMs
  ) {
    return false;
  }
  return true;
}

/**
 * Record a successful plan create/join. Arms the "plan" nudge for the next
 * render if nothing is already pending (first qualifying action wins its copy).
 * A no-op on SSR / storage failure — the nudge simply never arms there.
 */
export function recordPlanNudgeTrigger(): void {
  armTrigger("plan");
}

/**
 * Record the first on-device Moment draft save by a guest. Arms the "moment"
 * nudge. Callers should only invoke this for a signed-out user with real draft
 * content; the gate re-checks signedIn/cooldown regardless.
 */
export function recordMomentNudgeTrigger(): void {
  armTrigger("moment");
}

function armTrigger(trigger: IdentityNudgeTrigger): void {
  if (!hasStorage()) return;
  try {
    // First qualifying action keeps its copy until the nudge resolves; a second
    // trigger before resolution does not clobber the first.
    if (window.localStorage.getItem(PENDING_KEY)) return;
    window.localStorage.setItem(PENDING_KEY, trigger);
  } catch {
    return;
  }
  notify();
}

/**
 * Whether an identity nudge is currently armed for a signed-out user (ignoring
 * live auth, which storage can't see). Consumed by the native push prompt
 * wiring (PR #299) so push DEFERS while identity is pending — identity wins
 * first. See the ordering note in the file header.
 */
export function isIdentityNudgePending(): boolean {
  return shouldOfferIdentityNudge({
    pendingTrigger: readPending(),
    signedIn: false,
    isCrawler: isWebCrawler(),
    lastDismissedAt: readOptionalInt(DISMISSED_AT_KEY),
    now: Date.now(),
    cooldownMs: IDENTITY_NUDGE_COOLDOWN_MS,
  });
}

/**
 * Client snapshot for useSyncExternalStore: the trigger to show right now, or
 * null. Signed-in state is applied by the component (from useAuth) so the nudge
 * reacts to a live sign-in; this snapshot folds pending + crawler + cooldown and
 * returns a stable primitive ("plan" | "moment" | null) safe for re-render.
 */
export function getIdentityNudgeClientSnapshot(): IdentityNudgeTrigger | null {
  const pendingTrigger = readPending();
  const offer = shouldOfferIdentityNudge({
    pendingTrigger,
    signedIn: false,
    isCrawler: isWebCrawler(),
    lastDismissedAt: readOptionalInt(DISMISSED_AT_KEY),
    now: Date.now(),
    cooldownMs: IDENTITY_NUDGE_COOLDOWN_MS,
  });
  return offer ? pendingTrigger : null;
}

/** Server snapshot — always null so nothing renders during SSR / prerender. */
export function getIdentityNudgeServerSnapshot(): IdentityNudgeTrigger | null {
  return null;
}

/** Subscribe to nudge-visibility changes (same-tab writes + cross-tab `storage`). */
export function subscribeIdentityNudge(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(IDENTITY_NUDGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(IDENTITY_NUDGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** User tapped "not now" — start the cooldown and clear the pending trigger. */
export function markIdentityNudgeDismissed(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    window.localStorage.removeItem(PENDING_KEY);
    notify();
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

/**
 * User chose to sign in — clear the pending trigger so the nudge does not
 * re-appear on return from the OAuth redirect (a live session hides it anyway).
 * Does NOT set the cooldown: accepting is not a decline.
 */
export function markIdentityNudgeAccepted(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(PENDING_KEY);
    notify();
  } catch {
    // ignore
  }
}

/** Clear all nudge state — handy for local testing. */
export function resetIdentityNudge(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(DISMISSED_AT_KEY);
    window.localStorage.removeItem(PENDING_KEY);
    notify();
  } catch {
    // ignore
  }
}
