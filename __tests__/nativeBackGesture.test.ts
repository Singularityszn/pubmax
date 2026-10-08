import { afterEach, describe, expect, it, vi } from "vitest";

// Android Back is the first tap that tells a person whether they are holding an
// app or a browser. The contract is the ORDER in lib/nativeBackGesture.ts: a
// dismissible panel, then the surface trail, then leaving. Every case below
// drives the pure decision or the injected deps, so nothing here needs a real
// Capacitor plugin; the live listener is the same three lines over the same
// decision.
import {
  activateNativeBackGesture,
  decideBackAction,
  dispatchDismissKey,
  performBackAction,
  type BackGestureDeps,
} from "@/lib/nativeBackGesture";

type AnyGlobal = { window?: unknown };
const g = globalThis as AnyGlobal;

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
});

function deps(overrides: Partial<BackGestureDeps> = {}) {
  return {
    dismiss: vi.fn(() => false),
    goBack: vi.fn(),
    exit: vi.fn(),
    ...overrides,
  };
}

describe("decideBackAction", () => {
  it("spends Back on the open panel before anything else", () => {
    // Even with history behind it: closing what is in front of the reader is
    // what Back means, and navigating instead would take the page away too.
    expect(decideBackAction({ panelDismissed: true, canGoBack: true })).toEqual({
      kind: "dismissed",
      reason: "panel",
    });
  });

  it("pops the surface trail when there is history and no panel", () => {
    expect(decideBackAction({ panelDismissed: false, canGoBack: true })).toEqual({
      kind: "history",
    });
  });

  it("leaves only when there is genuinely nothing to undo", () => {
    expect(decideBackAction({ panelDismissed: false, canGoBack: false })).toEqual({
      kind: "exit",
    });
  });

  it("never leaves while a panel is open, even with no history", () => {
    // The shell's own first page with a sheet over it: Back closes the sheet.
    // Exiting here would throw the app away on the reader's first Back.
    expect(decideBackAction({ panelDismissed: true, canGoBack: false }).kind).toBe(
      "dismissed",
    );
  });
});

describe("performBackAction", () => {
  it("runs exactly one lane per Back", () => {
    const withPanel = deps({ dismiss: vi.fn(() => true) });
    performBackAction(true, withPanel);
    expect(withPanel.goBack).not.toHaveBeenCalled();
    expect(withPanel.exit).not.toHaveBeenCalled();

    const withHistory = deps();
    performBackAction(true, withHistory);
    expect(withHistory.goBack).toHaveBeenCalledTimes(1);
    expect(withHistory.exit).not.toHaveBeenCalled();

    const atRoot = deps();
    performBackAction(false, atRoot);
    expect(atRoot.goBack).not.toHaveBeenCalled();
    expect(atRoot.exit).toHaveBeenCalledTimes(1);
  });

  it("asks the panel exactly once, so a dismiss is never double-fired", () => {
    const once = deps({ dismiss: vi.fn(() => false) });
    performBackAction(true, once);
    expect(once.dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchDismissKey", () => {
  it("reports a panel that claimed the key with preventDefault", () => {
    // This is exactly what lib/useDismissOnEscape.ts does, which is why
    // claiming the key is the house rule rather than an implementation detail.
    const target = new EventTarget() as unknown as Window;
    target.addEventListener("keydown", (event) => event.preventDefault());
    expect(dispatchDismissKey(target)).toBe(true);
  });

  it("reports no panel when nothing claims the key", () => {
    const target = new EventTarget() as unknown as Window;
    expect(dispatchDismissKey(target)).toBe(false);
  });

  it("falls through to history rather than swallowing Back when dispatch throws", () => {
    const target = {
      dispatchEvent: () => {
        throw new Error("no dispatch here");
      },
    } as unknown as Window;
    // false means "no panel", so performBackAction moves on. A thrown true
    // would eat the gesture and strand the reader.
    expect(dispatchDismissKey(target)).toBe(false);
  });
});

const capacitorApp = {
  exitApp: vi.fn(async () => {}),
  minimizeApp: vi.fn(async () => {}),
  addListener: vi.fn(async (_event: string, handler: (payload: { canGoBack?: boolean }) => void) => {
    capacitorApp.handler = handler;
    return { remove: async () => {} };
  }),
  handler: null as null | ((payload: { canGoBack?: boolean }) => void),
};

vi.mock("@capacitor/app", () => ({ App: capacitorApp }));

describe("activateNativeBackGesture", () => {
  it("uses the iOS edge gesture to dismiss a panel or pop history, and stays at the root", async () => {
    const target = Object.assign(new EventTarget(), {
      Capacitor: { isNativePlatform: () => true },
      history: { back: vi.fn() },
    });
    g.window = target;
    const dismiss = vi.fn(() => false);
    const cleanup = await activateNativeBackGesture({ dismiss });
    const swipe = (canGoBack: boolean) => target.dispatchEvent(new CustomEvent("pubmax:ios-back", { detail: { canGoBack } }));
    swipe(true);
    expect(target.history.back).toHaveBeenCalledTimes(1);
    dismiss.mockReturnValueOnce(true);
    swipe(true);
    expect(target.history.back).toHaveBeenCalledTimes(1);
    swipe(false);
    expect(capacitorApp.minimizeApp).not.toHaveBeenCalled();
    cleanup();
    cleanup();
    swipe(true);
    expect(target.history.back).toHaveBeenCalledTimes(1);
  });

  it("registers nothing on the web and returns a safe cleanup", async () => {
    // No window at all: the server render path.
    const cleanup = await activateNativeBackGesture();
    expect(cleanup).toBeTypeOf("function");
    expect(() => cleanup()).not.toThrow();
  });

  it("registers nothing when the bridge reports a web platform", async () => {
    g.window = { Capacitor: { isNativePlatform: () => false } };
    const dismiss = vi.fn(() => true);
    const cleanup = await activateNativeBackGesture({ dismiss });
    cleanup();
    // The gate is read before the plugin import, so nothing was even asked.
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("BACKGROUNDS the app on the last Back, and never destroys it", async () => {
    // exitApp() calls finish() and takes the activity down with it, which costs
    // the predictive-back animation (SDK 36 has it on by default) and makes
    // every re-entry a full cold start: this shell is remote-URL mode over a
    // two-file stub, so a cold start refetches the production document, the JS
    // and the map shards. minimizeApp() leaves the activity alive, so the same
    // gesture animates and the next launch is warm.
    //
    // No platform branch guards it, and none is needed: iOS has no Back, so
    // the listener registered there simply never fires.
    g.window = {
      Capacitor: { isNativePlatform: () => true },
      history: { back: vi.fn() },
    };
    const cleanup = await activateNativeBackGesture({ dismiss: () => false });
    expect(capacitorApp.handler).toBeTypeOf("function");

    capacitorApp.handler?.({ canGoBack: false });
    expect(capacitorApp.minimizeApp).toHaveBeenCalledTimes(1);
    expect(capacitorApp.exitApp).not.toHaveBeenCalled();

    // And a Back with history behind it still pops the trail rather than
    // leaving at all, so the new lane cannot swallow step 2.
    capacitorApp.handler?.({ canGoBack: true });
    expect(capacitorApp.minimizeApp).toHaveBeenCalledTimes(1);
    expect(capacitorApp.exitApp).not.toHaveBeenCalled();

    cleanup();
  });
});
