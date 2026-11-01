// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapGlobalPopupJourney } from "./helpers/mapGlobalPopupJourney";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";
import MapArrivalCard from "@/components/map/MapArrivalCard";
import { ChooseAreaDesktopDialog } from "@/components/map/ChooseAreaSheet";
import { MapOnboardingOverlay } from "@/components/map/pubmap/MapOnboardingOverlay";
import { useFocusTrap } from "@/lib/useFocusTrap";

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ push: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

function OtherStrictModal() {
  const dialogRef = useRef<HTMLElement>(null);
  useFocusTrap(true, dialogRef, "strict-modal");
  return <section ref={dialogRef} role="dialog" aria-label="Account dialog"><button type="button">Account action</button></section>;
}

describe("global popups close before the held map journey", () => {
  it.each(["arrival", "area", "onboarding"] as const)("native Back leaves a newly mounted inert %s panel alone", async (panel) => {
    const dismiss = vi.fn();
    await act(async () => root.render(<MapGlobalPopupJourney drawer={false} />));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k", metaKey: true, bubbles: true, cancelable: true,
    })));
    await act(async () => { await import("@/components/command/CommandPalette"); });
    expect(host.querySelector('[aria-label="Search commands"]')).not.toBeNull();
    const lazyPanel = panel === "arrival"
      ? <MapArrivalCard onUseLocation={() => {}} onChooseArea={() => {}} onDismiss={dismiss} />
      : panel === "area"
        ? <ChooseAreaDesktopDialog open onClose={dismiss}>Pick an area</ChooseAreaDesktopDialog>
        : <MapOnboardingOverlay crawls={[]} onLoadCrawl={() => {}} onDismiss={dismiss} />;
    await act(async () => root.render(<MapGlobalPopupJourney drawer={false} nav={<div inert>{lazyPanel}</div>} />));
    nativeBack();
    expect(host.querySelector(".cmdkPanel")).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
    expect(host.querySelector(panel === "arrival" ? ".mapArrivalCard" : panel === "area" ? ".chooseAreaDesktop" : ".mapOnboarding")).not.toBeNull();
  });

  it.each([false, true])("keeps another strict modal's focus when the palette was already requested=%s", async (requested) => {
    await act(async () => root.render(<MapGlobalPopupJourney drawer />));
    openTray();
    if (requested) {
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "k", metaKey: true, bubbles: true, cancelable: true,
      })));
      expect(control<HTMLOutputElement>('[aria-label="Command palette open"]').textContent).toBe("true");
    }
    const modalHost = document.body.appendChild(document.createElement("div"));
    const modalRoot = createRoot(modalHost);
    try {
      await act(async () => modalRoot.render(<OtherStrictModal />));
      const action = modalHost.querySelector<HTMLButtonElement>("button")!;
      await act(async () => action.focus());
      if (!requested) {
        await act(async () => action.dispatchEvent(new KeyboardEvent("keydown", {
          key: "k", metaKey: true, bubbles: true, cancelable: true,
        })));
      }
      await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      expect(control<HTMLOutputElement>('[aria-label="Command palette open"]').textContent).toBe("false");
      expect(host.querySelector(".cmdkPanel")).toBeNull();
      expect(document.activeElement).toBe(action);
      expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
      expect(host.querySelector(".mapDrawer.right.open")).not.toBeNull();
    } finally {
      await act(async () => modalRoot.unmount());
      modalHost.remove();
    }
  });

  it.each([
    { tray: true, drawer: false, method: "keyboard" },
    { tray: true, drawer: false, method: "native" },
    { tray: false, drawer: true, method: "keyboard" },
    { tray: false, drawer: true, method: "native" },
    { tray: true, drawer: true, method: "keyboard" },
    { tray: true, drawer: true, method: "native" },
  ])("$method Back closes the command palette over tray=$tray drawer=$drawer", async ({ tray, drawer, method }) => {
    await act(async () => root.render(<MapGlobalPopupJourney drawer={drawer} />));
    const origin = tray ? openTray() : control<HTMLInputElement>('[aria-label="Search pubs"]');
    act(() => origin.focus());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k", metaKey: true, bubbles: true, cancelable: true,
    })));
    // Keep completion of the provider's real lazy import inside act.
    await act(async () => { await import("@/components/command/CommandPalette"); });
    expect(host.querySelector('[aria-label="Search commands"]')).not.toBeNull();
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const input = control<HTMLInputElement>('[aria-label="Search commands"]');
    expect(document.activeElement).toBe(input);
    if (method === "native") nativeBack();
    else pressEscape(input);
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".cmdkPanel")).toBeNull();
    expect(Boolean(host.querySelector(".mapToolbarDrinkChoices"))).toBe(tray);
    expect(Boolean(host.querySelector(".mapDrawer.right.open"))).toBe(drawer);
    expect(document.activeElement).toBe(origin);
    expectQueryHeld();
  });

});
