// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  auth: { user: { id: "push-user" } },
  webEnabled: vi.fn(),
  cheapEnabled: vi.fn(),
  actionFetch: vi.fn(),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => harness.auth }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: harness.actionFetch }));
vi.mock("@/lib/promptBudget", () => ({ claimPromptBudget: vi.fn(), hasPromptBudgetFor: () => true }));
vi.mock("@/lib/webPushPrompt", () => ({
  subscribeWebPushPrompt: () => () => undefined,
  getWebPushPromptVisibleSnapshot: () => true,
  getWebPushPromptServerSnapshot: () => false,
  markWebPushPromptEnabled: harness.webEnabled,
  markWebPushPromptDismissed: vi.fn(),
}));
vi.mock("@/lib/cheapPintPingPrompt", () => ({
  CHEAP_PINT_PING_PROMPT_SURFACE: "cheap-pint-ping",
  subscribeCheapPintPingPrompt: () => () => undefined,
  getCheapPintPingPromptVisibleSnapshot: () => true,
  getCheapPintPingPromptServerSnapshot: () => false,
  markCheapPintPingEnabled: harness.cheapEnabled,
  markCheapPintPingDismissed: vi.fn(),
  syncCheapPintPingPromptFromServer: vi.fn(),
}));

import StepOutNudgePref from "@/components/profile/StepOutNudgePref";
import WebPushPrompt from "@/components/pwa/WebPushPrompt";
import CheapPintPingPrompt from "@/components/pwa/CheapPintPingPrompt";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null;
let container: HTMLDivElement;
let finishSubscription: (value: Pick<PushSubscription, "toJSON">) => void;
let rejectSubscription: (reason: Error) => void;
let subscribe: ReturnType<typeof vi.fn>;
let tokenFetch: ReturnType<typeof vi.fn>;
const subscription: Pick<PushSubscription, "toJSON"> = {
  toJSON: () => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/pending-test",
    keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
  }),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  subscribe = vi.fn(() => new Promise<Pick<PushSubscription, "toJSON">>((resolve, reject) => {
    finishSubscription = resolve;
    rejectSubscription = reject;
  }));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe } }) },
  });
  tokenFetch = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", tokenFetch);
  harness.actionFetch.mockImplementation(async (_url: string, init?: RequestInit) => new Response(
    JSON.stringify({ enabled: init?.method === "POST", canSend: true }),
    { status: 200 },
  ));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Oracle: the captain's decision requires this exact label from 60 seconds,
// no elapsed-time error, and success after an 80-second native subscription.
// A removed timeout alone cannot satisfy the rendered pending-state contract.
describe.each([
  { name: "weekly nudge", Component: StepOutNudgePref, label: "Turn weekly nudge on" },
  { name: "London brief", Component: WebPushPrompt, label: "Turn on" },
  { name: "cheap-pint ping", Component: CheapPintPingPrompt, label: "Yes, ping me" },
])("$name slow push setup", ({ Component, label }) => {
  async function start(): Promise<HTMLButtonElement> {
    await act(async () => { root!.render(createElement(Component)); });
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
    expect(button).toBeDefined();
    await act(async () => { button.click(); });
    expect(subscribe).toHaveBeenCalledOnce();
    return button;
  }

  function expectEnabled(): void {
    expect(tokenFetch).toHaveBeenCalledOnce();
    if (Component === StepOutNudgePref) {
      expect(container.textContent).toContain("Weekly nudge is on.");
    } else if (Component === WebPushPrompt) {
      expect(harness.webEnabled).toHaveBeenCalledOnce();
    } else {
      expect(harness.cheapEnabled).toHaveBeenCalledOnce();
    }
  }

  it("shows calm pending from 60 seconds and enables after 80.6 seconds", async () => {
    const button = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(button.textContent).not.toBe("Still setting up notifications...");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(button.textContent).toBe("Still setting up notifications...");
    expect(button.disabled).toBe(true);
    expect(container.textContent).not.toContain("Could not");
    expect(container.textContent).not.toContain("Couldn't");
    expect(tokenFetch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_600);
      finishSubscription(subscription);
    });
    expectEnabled();
    expect(button.textContent).not.toBe("Still setting up notifications...");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enables after 31.8 seconds without a slow-setup message", async () => {
    const button = await start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_800);
      finishSubscription(subscription);
    });
    expectEnabled();
    expect(button.textContent).not.toBe("Still setting up notifications...");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows an error only when native setup rejects", async () => {
    const button = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(80_600); });
    expect(button.textContent).toBe("Still setting up notifications...");
    await act(async () => { rejectSubscription(new Error("Native push failed")); });
    expect(container.textContent).toMatch(/Could not turn on web push|Couldn't turn on alerts/);
    expect(button.disabled).toBe(false);
    expect(tokenFetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows an error when the token request fails", async () => {
    tokenFetch.mockResolvedValue(new Response(null, { status: 503 }));
    const button = await start();
    await act(async () => { finishSubscription(subscription); });
    expect(container.textContent).toMatch(/Could not turn on web push|Couldn't turn on alerts/);
    expect(button.disabled).toBe(false);
    expect(harness.actionFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(harness.webEnabled).not.toHaveBeenCalled();
    expect(harness.cheapEnabled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([30_000, 80_600])("cancels on unmount after %i ms and ignores a late subscription", async (elapsed) => {
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
    await act(async () => { root!.unmount(); });
    root = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80_600);
      finishSubscription(subscription);
    });
    expect(tokenFetch).not.toHaveBeenCalled();
    expect(harness.actionFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(harness.webEnabled).not.toHaveBeenCalled();
    expect(harness.cheapEnabled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
