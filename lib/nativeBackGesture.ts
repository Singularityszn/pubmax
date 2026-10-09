// Android hardware/gesture Back and iOS shell edge-swipe seam.
//
// Without a `backButton` listener a Capacitor Android app closes on the first
// Back, whatever is on screen: a half-open venue sheet, a plan the person was
// filling in, the map they had panned across. Android's Back is not "leave the
// app", it is "undo the last thing that put something in front of me", and an
// app that gets that wrong feels borrowed from the web on the very first tap.
//
// The whole policy is decideBackAction() below, and it is THREE STEPS in a
// fixed order. Each step is somebody else's existing contract, which is the
// point: this module owns the ORDER, not the behaviour.
//
//   1. A DISMISSIBLE PANEL FIRST. lib/useDismissOnEscape.ts is the house rule
//      that Escape leaves the panel that is open, and its handler claims the
//      key with preventDefault(). So Back dispatches one cancelable Escape and
//      reads defaultPrevented: a panel that took the key has already closed
//      itself, and Back is spent. AGENTS.md states the same equivalence from
//      the other side - "Escape is keyboard Back and fling-dismiss is gesture
//      Back" - so this is that sentence made executable.
//   2. THEN THE SURFACE TRAIL. Everything in the trail is a history entry
//      (components/map/pubmap/useMapSurfaceNavigation.ts is the only
//      browser-history owner and its own back() is exactly history.back()), so
//      one history.back() pops the venue sheet, then the drawer, then the
//      route, and its popstate listener restores the landed snapshot. This
//      module never reaches into that hook, never calls history.go(), and
//      never needs to know a surface exists.
//   3. THEN LEAVE ON ANDROID. With no panel and no history there is nothing to
//      undo, and holding the person inside a dead Back is worse than leaving.
//      LEAVING IS BACKGROUNDING, NEVER EXITING. App.exitApp() calls finish()
//      and destroys the activity, which costs two things: no predictive-back
//      animation ever plays (this app targets SDK 36, where predictive back is
//      on by default), and the next launch is a full COLD start. The shell is
//      remote-URL mode over a tiny stub (capacitor.config.ts), so a cold
//      start is a complete network fetch of the production document plus the
//      JS plus the map shards - perf/route-budgets.json puts /map pins on
//      screen at 2713 ms AFTER the document arrives. Destroying the process on
//      the most common exit gesture turns every re-entry into that. minimize
//      leaves the activity alive, so Back is one animation and re-entry is
//      warm.
//
// The decision is a pure function of a snapshot so it unit tests in the node
// vitest env, mirroring lib/entryDecision.ts. Web and SSR never register the
// listener at all - the gate is the canonical isNativeApp().

import { isNativeApp } from "@/lib/nativePlatform";

export type BackContext = {
  /**
   * A dismissible panel consumed the Escape we dispatched. Sourced from the
   * live dispatch in activateNativeBackGesture(); injectable so the decision
   * stays DOM-free.
   */
  panelDismissed: boolean;
  /**
   * The WebView reports history behind this document through Android's
   * backButton listener or the iOS edge event. The first page has none.
   */
  canGoBack: boolean;
};

export type BackAction =
  | { kind: "dismissed"; reason: "panel" }
  | { kind: "history" }
  | { kind: "exit" };

/**
 * The single Back decision. Pure and total. Order is the contract: a panel
 * always wins over history, and history always wins over leaving.
 */
export function decideBackAction(context: BackContext): BackAction {
  if (context.panelDismissed) return { kind: "dismissed", reason: "panel" };
  if (context.canGoBack) return { kind: "history" };
  return { kind: "exit" };
}

/**
 * Ask the open panel, if any, to close - and report whether one did.
 *
 * The event is cancelable so useDismissOnEscape's preventDefault() is readable
 * as an answer. A surface that closes on Escape without claiming the key is
 * indistinguishable from no surface at all, which is why claiming it is the
 * house rule rather than a detail.
 */
export function dispatchDismissKey(target: Window = window): boolean {
  try {
    const event = escapeKeyEvent();
    target.dispatchEvent(event);
    return event.defaultPrevented;
  } catch {
    // Nothing dispatchable. Fall through to history, which is the safer
    // answer: at worst the person goes back one surface too far, where
    // swallowing Back would strand them.
    return false;
  }
}

/**
 * An Escape keydown a listener can both recognise and claim.
 *
 * Every browser and every WebView has KeyboardEvent, so that is the real path.
 * The fallback exists because a plain `Event` has no `key`, and a handler that
 * reads `event.key !== "Escape"` would ignore it - which would silently turn
 * every Back into a navigation past whatever was open.
 */
function escapeKeyEvent(): Event {
  const init = { bubbles: true, cancelable: true } as const;
  const Keyboard = (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent;
  if (Keyboard) return new Keyboard("keydown", { ...init, key: "Escape", code: "Escape" });
  return Object.defineProperties(new Event("keydown", init), {
    key: { value: "Escape", enumerable: true },
    code: { value: "Escape", enumerable: true },
  });
}

export type BackGestureDeps = {
  /** Close the open panel and say whether there was one. */
  dismiss: () => boolean;
  /** Pop one surface off the trail. */
  goBack: () => void;
  /**
   * Leave the app: background it, never destroy it. See step 3 above for what
   * exiting costs.
   */
  exit: () => Promise<void> | void;
};

/** Run one Back against the decision. Exported so the test drives it directly. */
export function performBackAction(canGoBack: boolean, deps: BackGestureDeps): BackAction {
  const action = decideBackAction({ panelDismissed: deps.dismiss(), canGoBack });
  if (action.kind === "history") deps.goBack();
  if (action.kind === "exit") void deps.exit();
  return action;
}

/**
 * Register native Back handling with an idempotent cleanup. Web and SSR are
 * safe no-ops. Plugin failure leaves the iOS edge listener active.
 *
 * iOS sends pubmax:ios-back from the shell's left-edge recognizer. It shares
 * panel dismissal and history handling, but stays in the app at the root.
 * The Android plugin's backButton listener keeps its existing behaviour.
 */
export async function activateNativeBackGesture(
  overrides: Partial<BackGestureDeps> = {},
): Promise<() => void> {
  if (!isNativeApp()) return () => {};

  const onIosBack = (event: Event) => {
    const canGoBack = (event as CustomEvent<{ canGoBack?: boolean }>).detail?.canGoBack === true;
    performBackAction(canGoBack, {
      dismiss: overrides.dismiss ?? (() => dispatchDismissKey()),
      goBack: overrides.goBack ?? (() => window.history.back()),
      exit: () => {},
    });
  };
  window.addEventListener?.("pubmax:ios-back", onIosBack);
  const removeIosListener = () => window.removeEventListener?.("pubmax:ios-back", onIosBack);

  let removeListener: (() => Promise<void>) | undefined;
  try {
    const { App } = await import("@capacitor/app");
    const deps: BackGestureDeps = {
      dismiss: () => dispatchDismissKey(),
      goBack: () => window.history.back(),
      exit: () => App.minimizeApp(),
      ...overrides,
    };

    const listener = await App.addListener("backButton", ({ canGoBack }) => {
      performBackAction(canGoBack === true, deps);
    });
    removeListener = () => listener.remove();

    return () => {
      removeIosListener();
      void removeListener?.();
      removeListener = undefined;
    };
  } catch {
    void removeListener?.();
    return removeIosListener;
  }
}
