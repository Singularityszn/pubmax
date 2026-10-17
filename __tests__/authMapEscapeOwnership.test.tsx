// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapGlobalPopupJourney } from "./helpers/mapGlobalPopupJourney";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";

import SignInButton from "@/components/auth/SignInButton";

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: auth.signedIn ? { id: "test-user", email: "test@example.com", user_metadata: {} } : null,
    session: null,
    handle: auth.signedIn ? "test-user" : null,
    configured: true,
    supabaseAuthState: auth.signedIn ? "authenticated" : "signed-out",
    clerkIntegrationConfigured: false,
    socialProviders: { google: false, apple: false, microsoft: false },
    signInWithGoogle: async () => ({}),
    signInWithApple: async () => ({}),
    signInWithMicrosoft: async () => ({}),
    signInWithEmail: async () => ({}),
    cancelAuthAttempt: () => {},
    signOut: async () => {},
    switchAccount: async () => ({}),
  }),
}));
vi.mock("@/components/auth/useDeviceAccounts", () => ({ useDeviceAccounts: () => [] }));
vi.mock("@/components/auth/usePublicProfileCard", () => ({ usePublicProfileCard: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  auth.signedIn = true;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

function control<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

function openTray() {
  const trigger = control<HTMLButtonElement>(".mapToolbarDrinkLaneBtn");
  act(() => { trigger.focus(); trigger.click(); });
  expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
  return trigger;
}

function pressEscape(target: HTMLElement) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  })));
}

function nativeBack() {
  let consumed = false;
  act(() => { consumed = dispatchDismissKey(); });
  expect(consumed).toBe(true);
}

function expectQueryHeld() {
  expect(control<HTMLInputElement>('[aria-label="Search pubs"]').value).toBe("Camden");
  expect(control<HTMLButtonElement>(".mapToolbarDrinkLaneBtn").textContent).toBe("Drink: Wine");
}

describe("compact auth owns Escape above the held map journey", () => {
  it.each([true, false])("native Back leaves the palette, auth menu and tray in order when signedIn=%s", async (signedIn) => {
    auth.signedIn = signedIn;
    await act(async () => root.render(<MapGlobalPopupJourney drawer nav={<SignInButton compact />} />));
    openTray();
    const trigger = control<HTMLButtonElement>(".authCompactTrigger");
    await act(async () => { trigger.focus(); trigger.click(); });
    const origin = document.activeElement;
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k", metaKey: true, bubbles: true, cancelable: true,
    })));
    await vi.waitFor(async () => {
      await act(async () => { await Promise.resolve(); });
      expect(host.querySelector('[aria-label="Search commands"]')).not.toBeNull();
    });
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    nativeBack();
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".cmdkPanel")).toBeNull();
    expect(host.querySelector(".authMenu")).not.toBeNull();
    expect(document.activeElement).toBe(origin);
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expect(host.querySelector(".mapDrawer.right.open")).not.toBeNull();
    nativeBack();
    expect(host.querySelector(".authMenu")).toBeNull();
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expect(host.querySelector(".mapDrawer.right.open")).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    expectQueryHeld();
  });

  it.each([
    { signedIn: true, method: "keyboard" },
    { signedIn: true, method: "native" },
    { signedIn: false, method: "keyboard" },
    { signedIn: false, method: "native" },
  ])("$method Back closes compact auth first when signedIn=$signedIn", async ({ signedIn, method }) => {
    auth.signedIn = signedIn;
    await act(async () => root.render(<MapGlobalPopupJourney drawer nav={<SignInButton compact />} />));
    openTray();
    const trigger = control<HTMLButtonElement>(".authCompactTrigger");
  // Enter's default activation has no pointerdown, so the held tray stays
    // open when keyboard users reach the compact account/sign-in control.
    await act(async () => { trigger.focus(); trigger.click(); });
    expect(host.querySelector(".authMenu")).not.toBeNull();
    const focused = document.activeElement;
    expect(focused instanceof HTMLElement && host.querySelector(".authMenu")?.contains(focused)).toBe(true);
    if (method === "native") nativeBack();
    else pressEscape(focused as HTMLElement);
    expect(host.querySelector(".authMenu")).toBeNull();
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expect(host.querySelector(".mapDrawer.right.open")).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    expectQueryHeld();
  });
});
