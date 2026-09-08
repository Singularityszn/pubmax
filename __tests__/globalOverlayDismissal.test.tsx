// @vitest-environment jsdom

import { act, createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, auth } = vi.hoisted(() => ({
  push: vi.fn(),
  auth: {
    user: null,
    handle: null,
    configured: true,
    clerkIntegrationConfigured: false,
    socialProviders: { google: false, apple: false },
    supabaseAuthState: "signed-out",
    cancelAuthAttempt: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ push }),
}));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props),
}));
vi.mock("next/dynamic", async () => {
  const { default: CommandPalette } = await import("@/components/command/CommandPalette");
  return { default: () => CommandPalette };
});
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/auth/useDeviceAccounts", () => ({ useDeviceAccounts: () => [] }));
vi.mock("@/components/auth/SocialSignInButtons", () => ({ default: () => null }));
vi.mock("@/components/auth/MagicLinkForm", () => ({
  default: () => createElement("div", null,
    createElement("input", { type: "email", "aria-label": "Email" }),
    createElement("button", null, "Email me a sign-in link")),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import SignInButton from "@/components/auth/SignInButton";
import SiteNavMore from "@/components/nav/SiteNavMore";
import CommandPaletteProvider from "@/components/command/CommandPaletteProvider";
import AddPageShell from "@/app/add/[handle]/AddPageShell";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";

let host: HTMLDivElement;
let root: Root;

function UnderlyingList({ dismiss }: { dismiss: () => void }) {
  useDismissOnEscape(true, dismiss);
  return createElement("section", { "aria-label": "London venue list" }, "Venues");
}

function render(children: ReactNode) {
  act(() => root.render(children));
}

function key(key: string, target: EventTarget = window, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  act(() => { target.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  push.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("global overlays dismiss before the surface below them", () => {
  it("closes More pages and restores its trigger before closing the venue list", () => {
    const dismissList = vi.fn();
    render([
      createElement(UnderlyingList, { key: "list", dismiss: dismissList }),
      createElement(SiteNavMore, { key: "nav" }),
    ]);
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="More pages"]')!;
    act(() => trigger.click());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    key("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(dismissList).not.toHaveBeenCalled();
    key("Escape");
    expect(dismissList).toHaveBeenCalledTimes(1);
  });

  it("closes the sign-in popover from its email field without closing the venue list", () => {
    const dismissList = vi.fn();
    render([
      createElement(UnderlyingList, { key: "list", dismiss: dismissList }),
      createElement(SignInButton, { key: "auth", compact: true }),
    ]);
    const trigger = host.querySelector<HTMLButtonElement>(".authCompactTrigger")!;
    act(() => trigger.click());
    const email = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    expect(document.activeElement).toBe(email);
    key("Escape", email);
    expect(host.querySelector('input[type="email"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(dismissList).not.toHaveBeenCalled();
  });

  it("native Back closes the command palette before an underlying owner", () => {
    const dismissList = vi.fn();
    render(createElement(CommandPaletteProvider, null,
      createElement(UnderlyingList, { dismiss: dismissList })));
    key("k", window, { ctrlKey: true });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    let consumed = false;
    act(() => { consumed = dispatchDismissKey(); });
    expect(consumed).toBe(true);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(dismissList).not.toHaveBeenCalled();
    key("Escape");
    expect(dismissList).toHaveBeenCalledTimes(1);
  });

  it("keeps palette chords and focused-input Escape working", () => {
    const dismissList = vi.fn();
    render(createElement(CommandPaletteProvider, null,
      createElement(UnderlyingList, { dismiss: dismissList })));
    key("K", window, { metaKey: true });
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    expect(input).not.toBeNull();
    key("Escape", input);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(dismissList).not.toHaveBeenCalled();
    key("k", window, { ctrlKey: true });
    key("k", host.querySelector<HTMLInputElement>('[role="combobox"]')!, { ctrlKey: true });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(dismissList).not.toHaveBeenCalled();
  });

  it("keeps palette input keys above an open sign-in popover", () => {
    const dismissList = vi.fn();
    render(createElement(CommandPaletteProvider, null,
      createElement(UnderlyingList, { dismiss: dismissList }),
      createElement(SignInButton, { compact: true })));
    act(() => host.querySelector<HTMLButtonElement>(".authCompactTrigger")!.click());
    key("k", window, { ctrlKey: true });
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    act(() => input.focus());
    key("Tab", input);
    expect(document.activeElement).toBe(input);
    key("Escape", input);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
    expect(dismissList).not.toHaveBeenCalled();
    act(() => { expect(dispatchDismissKey()).toBe(true); });
    expect(host.querySelector('input[type="email"]')).toBeNull();
    expect(dismissList).not.toHaveBeenCalled();
  });

  it("leaves the Add page in place when a nav menu owns Escape", () => {
    render(createElement(AddPageShell, null, createElement(SiteNavMore)));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="More pages"]')!.click());
    key("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(push).not.toHaveBeenCalled();
    key("Escape");
    expect(push).toHaveBeenCalledExactlyOnceWith("/social");
  });
});
