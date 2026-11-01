// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import SiteNav from "@/components/nav/SiteNav";
import CommandPaletteProvider from "@/components/command/CommandPaletteProvider";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalInert = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
let host: HTMLDivElement;
let root: Root;
const onBack = vi.fn();

function SelectedPub({ open }: { open: boolean }) {
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(open, drawerRef, "map-surface");
  useMapKeyboardShortcuts({
    mobileViewport: false, planningOpen: false,
    selectedVenueId: open ? "selected-pub" : "", onBack,
    onInterruptReveal: () => undefined,
    logIntentFallbackVisible: false, dismissLogIntent: () => undefined,
  });
  return open ? <aside ref={drawerRef} aria-label="Selected pub"><button>Pub details</button></aside> : null;
}

async function render(drawer: boolean) {
  await act(async () => root.render(
    <CommandPaletteProvider>
      <div className="appShell"><SiteNav active="map" /><SelectedPub open={drawer} /></div>
    </CommandPaletteProvider>,
  ));
}

function control<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value: boolean) { this.toggleAttribute("inert", value); },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.localStorage.clear();
  document.documentElement.dataset.theme = "light";
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  onBack.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  if (originalInert) Object.defineProperty(HTMLElement.prototype, "inert", originalInert);
  else Reflect.deleteProperty(HTMLElement.prototype, "inert");
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

it("keeps visible navigation and theme usable beside a nonmodal selected pub", async () => {
  await render(true);
  for (const link of document.querySelectorAll<HTMLAnchorElement>(".siteNavLinks a")) {
    expect(link.closest("[inert]")).toBeNull();
  }
  const theme = control<HTMLButtonElement>('button[aria-label="Switch to dark theme"]');
  expect(theme.closest("[inert]")).toBeNull();
  await act(async () => { theme.click(); });
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(window.localStorage.getItem("pubmax-theme")).toBe("dark");
  expect(theme.getAttribute("aria-label")).toBe("Switch to light theme");
  await act(async () => { theme.click(); });
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(window.localStorage.getItem("pubmax-theme")).toBe("light");
  expect(document.querySelector('[aria-label="Selected pub"]')).not.toBeNull();
  expect(onBack).not.toHaveBeenCalled();
});

it("keeps an existing portalled More menu usable when a pub drawer opens", async () => {
  await render(false);
  const trigger = control<HTMLButtonElement>(".siteNavMoreBtn");
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  });
  const menu = control<HTMLDivElement>('[role="menu"][aria-label="More pages"]');
  const first = menu.querySelector<HTMLAnchorElement>("a")!;
  expect(document.activeElement).toBe(first);
  await render(true);
  expect(menu.closest("[inert]")).toBeNull();
  await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(document.querySelector('[aria-label="Selected pub"]')).not.toBeNull();
  expect(onBack).not.toHaveBeenCalled();
});

it("isolates the palette over navigation and portalled More, then restores the held pub journey", async () => {
  await render(true);
  const more = control<HTMLButtonElement>(".siteNavMoreBtn");
  await act(async () => { more.focus(); more.click(); });
  const menu = control<HTMLDivElement>('[role="menu"][aria-label="More pages"]');
  const opener = control<HTMLButtonElement>(".siteNavCmdk");
  expect(opener.closest("[inert]")).toBeNull();
  await act(async () => { opener.focus(); opener.click(); });
  // Keep the real chunk's completion inside act, including cold transforms.
  await act(async () => { await import("@/components/command/CommandPalette"); });
  expect(document.querySelector('[aria-label="Search commands"]')).not.toBeNull();
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const input = control<HTMLInputElement>('[aria-label="Search commands"]');
  expect(document.activeElement).toBe(input);
  expect(opener.closest("[inert]")).not.toBeNull();
  expect(menu.closest("[inert]")).not.toBeNull();
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await act(async () => { await Promise.resolve(); });
  expect(document.querySelector(".cmdkPanel")).toBeNull();
  expect(opener.closest("[inert]")).toBeNull();
  expect(menu.closest("[inert]")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(document.querySelector('[role="menu"]')).toBe(menu);
  expect(document.querySelector('[aria-label="Selected pub"]')).not.toBeNull();
  expect(onBack).not.toHaveBeenCalled();
  await act(async () => opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(more);
  expect(onBack).not.toHaveBeenCalled();
});
