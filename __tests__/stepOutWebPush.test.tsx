// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webPushNeedsHomeScreenInstall } from "@/lib/a2hsPrompt";

// Web push needs the Home Screen install on an iPhone or iPad and nowhere else.
// Step Out asked "is this a standalone install?" instead, which is false in
// every browser tab, so it could not be turned on in Chrome, Edge, Firefox or
// Android and answered a laptop with an iPhone instruction.

const CHROME_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.0.0 Mobile/15E148 Safari/604.1";

describe("webPushNeedsHomeScreenInstall", () => {
  it("is false in a desktop or Android browser tab", () => {
    expect(webPushNeedsHomeScreenInstall({ userAgent: CHROME_DESKTOP, maxTouchPoints: 0 })).toBe(false);
    expect(webPushNeedsHomeScreenInstall({ userAgent: CHROME_ANDROID, maxTouchPoints: 5 })).toBe(false);
  });

  it("is true in an iPhone tab, in Safari and in iOS Chrome alike", () => {
    expect(webPushNeedsHomeScreenInstall({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(webPushNeedsHomeScreenInstall({ userAgent: CHROME_IPHONE, maxTouchPoints: 5 })).toBe(true);
  });

  it("treats an iPad that reports a Mac user agent as iOS", () => {
    expect(webPushNeedsHomeScreenInstall({ userAgent: CHROME_DESKTOP, maxTouchPoints: 5 })).toBe(true);
  });

  it("is false once the app is installed or inside the native shell", () => {
    expect(
      webPushNeedsHomeScreenInstall({ userAgent: SAFARI_IPHONE, navigatorStandalone: true }),
    ).toBe(false);
    expect(
      webPushNeedsHomeScreenInstall({ userAgent: SAFARI_IPHONE, displayModeStandalone: true }),
    ).toBe(false);
    expect(webPushNeedsHomeScreenInstall({ userAgent: SAFARI_IPHONE, isNativeApp: true })).toBe(false);
  });
});

const registerWebPush = vi.hoisted(() => vi.fn());
const webPushSupport = vi.hoisted(() => vi.fn());
const authedActionFetch = vi.hoisted(() => vi.fn());

// One user object for every render: the component refetches when `user` changes
// identity, so a fresh object per call would refetch for ever.
const signedInAuth = vi.hoisted(() => ({ user: { id: "user-1" } }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => signedInAuth }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));
vi.mock("@/lib/webPush", () => ({
  registerWebPush,
  unregisterWebPush: vi.fn(),
  webPushSupport,
}));

import StepOutNudgePref from "@/components/profile/StepOutNudgePref";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function setUserAgent(userAgent: string, maxTouchPoints = 0): void {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints,
  });
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  registerWebPush.mockReset();
  webPushSupport.mockReset().mockReturnValue("supported");
  authedActionFetch.mockReset().mockImplementation(async (_input: string, init?: { method?: string }) =>
    init?.method === "POST"
      ? new Response(JSON.stringify({ enabled: true, lastSentAt: null, canSend: true }), { status: 200 })
      : new Response(JSON.stringify({ enabled: false, lastSentAt: null, canSend: false, maxPerWeek: 1 }), {
          status: 200,
        }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(StepOutNudgePref));
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function turnOn(): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Turn Step Out on",
  )!;
}

describe("StepOutNudgePref in a browser tab", () => {
  it("offers web push in a desktop browser and shows no iPhone note", async () => {
    setUserAgent(CHROME_DESKTOP);
    registerWebPush.mockResolvedValue("encoded-token");
    await render();

    expect(container.querySelector("[data-testid=step-out-ios-install-note]")).toBeNull();

    await act(async () => {
      turnOn().click();
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(registerWebPush).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Step Out is on. At most one place-bound push a week.");
    expect(container.textContent).not.toContain("On iPhone");
  });

  it("keeps the Home Screen note, and does not ask, on an iPhone tab", async () => {
    setUserAgent(SAFARI_IPHONE, 5);
    await render();

    expect(container.querySelector("[data-testid=step-out-ios-install-note]")).not.toBeNull();

    await act(async () => {
      turnOn().click();
    });

    expect(registerWebPush).not.toHaveBeenCalled();
    expect(container.textContent).toContain("On iPhone, add PUBMAXX to your Home Screen first.");
  });

  it("says a browser without web push cannot, instead of a vague failure", async () => {
    setUserAgent(CHROME_DESKTOP);
    webPushSupport.mockReturnValue("unsupported");
    await render();

    await act(async () => {
      turnOn().click();
    });

    expect(registerWebPush).not.toHaveBeenCalled();
    expect(container.textContent).toContain("This browser cannot receive web push.");
  });

  it("says notifications are blocked when the permission was denied", async () => {
    setUserAgent(CHROME_DESKTOP);
    webPushSupport.mockReturnValue("blocked");
    await render();

    await act(async () => {
      turnOn().click();
    });

    expect(registerWebPush).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Notifications are blocked for this site.");
  });
});

describe("StepOutNudgePref inside the native app", () => {
  afterEach(() => {
    delete (window as { Capacitor?: unknown }).Capacitor;
  });

  it("offers no web push switch and says where Step Out works", async () => {
    setUserAgent(SAFARI_IPHONE, 5);
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    await render();

    expect(container.querySelector("[data-testid=step-out-native-note]")?.textContent).toContain(
      "Step Out alerts are not available in the app yet; they work in Chrome, Edge or Firefox on the web.",
    );
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Turn Step Out on"))).toBe(
      false,
    );
    expect(container.querySelector("[data-testid=step-out-ios-install-note]")).toBeNull();
    expect(container.textContent).not.toContain("This browser cannot receive web push.");
  });
});
