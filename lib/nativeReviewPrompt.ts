// Store review seam. Ratings decide store ranking and conversion more than any
// listing copy, and an app with none converts badly - but a rating ask is the
// most expensive prompt a phone app owns, because the platform, not the app,
// decides how often it may be spent. iOS allows SKStoreReviewController about
// three times a year per device and SILENTLY IGNORES every request past that,
// resolving exactly as a shown dialog does; Play In-App Review holds its own
// undocumented quota and does the same. So a request that lands at the wrong
// moment is not merely ignored, it burns the one chance a good moment had.
//
// This module is therefore the ONE place the timing rule lives, in the
// lib/nativePushPrompt.ts idiom: a pure gate function over a plain state
// record, a localStorage-backed store around it, and a dynamic-import plugin
// seam behind the canonical isNativeApp() probe so no Capacitor-shaped module
// lands in the web bundle.
//
// FOUR rules.
//
// 1. ONCE EVER. There is no re-ask, no snooze and no second window. The
//    platform is already rationing the dialog; a second ask from us can only
//    spend a quota we cannot see. hasAskedForStoreReview() is permanent.
// 2. ONLY AFTER A KEPT ACTION, AND NEVER THE FIRST. A kept action is a price
//    a drinker logged or a plan they kept - a moment the person chose and the
//    app confirmed, never a launch, never a navigation, never an error path.
//    The floor below is why the FIRST one does not ask: someone who has kept
//    one thing has not yet decided anything about this app, and the ask would
//    spend the quota on a coin flip.
// 3. THE OS DIALOG IS THE WHOLE UI. We render no rating stars, no "enjoying
//    PUBMAXX?" pre-prompt and no copy asking for a GOOD rating - App Store
//    Review Guideline 1.1.7 and Play's own policy both forbid steering the
//    rating, and a custom dialog in front of the native one is the pattern they
//    name. Nothing here has any copy at all, deliberately.
// 4. IT NEVER GATES THE ACTION. Every path resolves, nothing awaits it before
//    a receipt prints, and off the shell it sends nothing at all.

import { isNativeApp } from "@/lib/nativePlatform";
import { safeLocalStorage } from "@/lib/safeStorage";

/** Permanent: we asked the OS once and will not ask again. */
const ASKED_KEY = "pubmax:storeReview:asked:v1";
/** How many kept actions this device has recorded, ever. */
const KEPT_ACTIONS_KEY = "pubmax:storeReview:keptActions:v1";

/**
 * Kept actions a device must have behind it before the ask is spent.
 *
 * Two rather than one because the first kept action is the moment a person is
 * still deciding what this app is, and the platform quota is too scarce to
 * spend on that. Raising this trades reach for confidence, in one place.
 */
export const REVIEW_PROMPT_KEPT_ACTION_FLOOR = 2;

/**
 * The moments that count, as a closed table in the lib/nativeHaptics.ts idiom:
 * a caller names an OCCASION rather than passing a boolean, so the set cannot
 * drift and widening it is a deliberate edit here. Both entries are confirmed
 * by the app after the person chose them - a price the drinker logged and a
 * plan they kept - so a navigation, a launch or an error path can never become
 * one.
 */
export const KEPT_ACTION_KINDS = ["price-logged", "plan-kept"] as const;

export type KeptActionKind = (typeof KEPT_ACTION_KINDS)[number];

/** Whether a value names a kept action. Guards the seam against a stringy caller. */
export function isKeptActionKind(value: unknown): value is KeptActionKind {
  return KEPT_ACTION_KINDS.includes(value as KeptActionKind);
}

export type ReviewPromptGateState = {
  /** Native shell only - always false (never ask) on web and during SSR. */
  isNative: boolean;
  /** We have already spent the one ask on this device. */
  alreadyAsked: boolean;
  /** Kept actions recorded on this device, including the one just recorded. */
  keptActionCount: number;
};

/**
 * The whole timing rule, pure and exported so it is readable and testable with
 * no DOM, no plugin and no store. Every caller of this seam goes through it;
 * nothing else decides when a review is asked for.
 */
export function shouldRequestStoreReview(state: ReviewPromptGateState): boolean {
  if (!state.isNative) return false;
  if (state.alreadyAsked) return false;
  return state.keptActionCount >= REVIEW_PROMPT_KEPT_ACTION_FLOOR;
}

/**
 * What a request attempt turned out to be. Three-way rather than a boolean,
 * because "we handed the OS the request" and "there was nothing to hand it to"
 * are different facts and only the first one may spend the once-ever ask.
 */
export type StoreReviewOutcome =
  /** We called the platform review API. Whether it drew anything is its own business. */
  | "requested"
  /** No shell or no plugin: nothing was shown, so nothing is spent. */
  | "unavailable"
  /** The rule said no - too few kept actions, already asked, or not native. */
  | "skipped";

/** The single plugin call this seam makes. Nothing wider is needed or used. */
type InAppReviewPlugin = {
  requestReview: () => Promise<void>;
};

export type NativeReviewPromptDeps = {
  /** Defaults to the canonical shell probe. */
  isNative?: () => boolean;
  /** Defaults to the dynamic @capacitor-community/in-app-review import. */
  loadPlugin?: () => Promise<InAppReviewPlugin>;
};

// A CAPACITOR PLUGIN IS A PROXY, AND IT ANSWERS "then" WITH A NATIVE CALL.
// registerPlugin() hands back a Proxy whose every property is a method on the
// native side, so returning it from an async function makes the await look
// for a thenable, call the native "InAppReview.then()", and reject with
// '"InAppReview.then()" is not implemented' (measured on the Pixel 7 emulator through
// the WebView's console: docs/proof/mobile-app-design/android-emu-pixel7/share/).
// The loader hands back a plain object that closes over the plugin instead.
// __tests__/capacitorPluginProxy.test.ts holds every loader to this with a
// proxy shaped like the real one.
async function loadInAppReviewPlugin(): Promise<InAppReviewPlugin> {
  const { InAppReview } = await import("@capacitor-community/in-app-review");
  return { requestReview: () => InAppReview.requestReview() };
}

function readInt(key: string): number {
  const storage = safeLocalStorage();
  if (!storage) return 0;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return 0;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

/** Whether the one ask has already been spent on this device. Permanent once true. */
export function hasAskedForStoreReview(): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Kept actions recorded on this device, ever. Exported for the gate and for tests. */
export function keptActionCount(): number {
  return readInt(KEPT_ACTIONS_KEY);
}

/**
 * TWO in-memory latches, because they answer different questions.
 *
 * `askedThisDocument` mirrors the persisted marker, so a storage write that
 * failed (private mode, a full quota) still holds the once-ever rule for the
 * life of this document.
 *
 * `askInFlight` covers the gap the persisted marker cannot: the plugin load is
 * awaited, so two kept actions landing in one tick both pass the gate
 * synchronously and would both reach the OS. It is claimed BEFORE the await and
 * released again only when the plugin could not be loaded, which is the one
 * outcome that spends nothing.
 */
let askedThisDocument = false;
let askInFlight = false;

function markAsked(): void {
  askedThisDocument = true;
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(ASKED_KEY, "1");
  } catch {
    // Storage full, disabled or private mode. The in-memory latch still holds
    // for this document, and a later boot asking once more is the honest cost
    // of a browser that will not remember anything.
  }
}

function bumpKeptActions(): number {
  const next = keptActionCount() + 1;
  const storage = safeLocalStorage();
  if (!storage) return next;
  try {
    storage.setItem(KEPT_ACTIONS_KEY, String(next));
  } catch {
    // Same degrade as above: the count for this tick is still honest.
  }
  return next;
}

/**
 * Record a kept action and, if the rule above says this is the moment, hand the
 * platform its own review request.
 *
 * Call this from a SUCCESS path only, after the receipt the person came for has
 * been set, and never await it: it resolves on every path and gates nothing.
 * Off the native shell it records nothing and sends nothing, so callers invoke
 * it unconditionally.
 */
export async function recordKeptAction(
  kind: KeptActionKind,
  deps: NativeReviewPromptDeps = {},
): Promise<StoreReviewOutcome> {
  // A kind outside the table is a call site that drifted; it counts as nothing
  // rather than quietly spending the once-ever ask on an unnamed moment.
  if (!isKeptActionKind(kind)) return "skipped";
  const isNative = deps.isNative ?? isNativeApp;
  // The web keeps no counter at all. A person who used the site for a year and
  // later installs the app should meet the same floor inside the shell, and a
  // count only the shell can ever spend has no business on the web.
  if (!isNative()) return "skipped";

  const count = bumpKeptActions();
  if (askedThisDocument || askInFlight) return "skipped";
  const passesGate = shouldRequestStoreReview({
    isNative: true,
    alreadyAsked: hasAskedForStoreReview(),
    keptActionCount: count,
  });
  if (!passesGate) return "skipped";

  askInFlight = true;
  let plugin: InAppReviewPlugin;
  try {
    plugin = await (deps.loadPlugin ?? loadInAppReviewPlugin)();
  } catch {
    // An older shell built before the plugin landed. Nothing was shown, so
    // nothing is spent and a later kept action may still ask.
    askInFlight = false;
    return "unavailable";
  }

  // Marked BEFORE the call, not after: the request is what spends the quota,
  // and a rejected promise says nothing about whether the OS drew a dialog.
  // Reading a rejection as "not asked" is what would turn one ask into many.
  markAsked();
  try {
    await plugin.requestReview();
  } catch {
    // The platform declined to draw it, or the flow was dismissed. Both are the
    // platform's own decision and neither earns a retry.
  }
  return "requested";
}

/** Clear all review-prompt state. For local testing only. */
export function resetStoreReviewPrompt(): void {
  askedThisDocument = false;
  askInFlight = false;
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(ASKED_KEY);
    storage.removeItem(KEPT_ACTIONS_KEY);
  } catch {
    // ignore
  }
}
