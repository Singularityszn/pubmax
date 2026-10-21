// @vitest-environment jsdom

import { act, Fragment, StrictMode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";
import { useFocusTrap } from "@/lib/useFocusTrap";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function ProtectedDialog() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(true, ref);
  return <div ref={ref} role="dialog" aria-label="Account dialog" tabIndex={-1}>Account</div>;
}

function MapJourney({ keepOpener = false, provideFallback = true, protectAfterClose = false }: {
  keepOpener?: boolean;
  provideFallback?: boolean;
  protectAfterClose?: boolean;
}) {
  const searchControl = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState(false);
  const [open, setOpen] = useState(false);
  return <>
    <button ref={searchControl} aria-label="Search the map">Search</button>
    {!picked || keepOpener ? <input aria-label="Search pubs" /> : null}
    <button onClick={() => { setPicked(true); setOpen(true); }}>Choose Golden Lion</button>
    <button aria-label="Another map control">Other</button>
    {picked && !open && protectAfterClose ? <ProtectedDialog /> : null}
    <MobileSharedSheet
      kind={open ? "venue" : null}
      title="Golden Lion"
      onClose={() => setOpen(false)}
      returnFocusTarget={provideFallback ? () => searchControl.current : undefined}
    >Pub details</MobileSharedSheet>
  </>;
}

let host: HTMLDivElement;
let root: Root;
let inertDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  inertDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value: boolean) { this.toggleAttribute("inert", value); },
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  if (inertDescriptor) Object.defineProperty(HTMLElement.prototype, "inert", inertDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "inert");
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function choosePub() {
  const opener = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    opener.focus();
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Choose Golden Lion")!.click();
    await frame();
  });
  await act(async () => { await frame(); });
  expect(document.querySelector(".mobileSharedSheet")).not.toBeNull();
  expect(document.activeElement).toBe(document.querySelector(".mobileSharedSheet"));
  return opener;
}

async function closePub() {
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close venue detail"]')!;
  await act(async () => { close.focus(); close.click(); await frame(); });
  await act(async () => { await frame(); });
  expect(document.querySelector(".mobileSharedSheet")).toBeNull();
}

it.each([false, true])("returns to the current map search control after its opener leaves (StrictMode=%s)", async (strict) => {
  const Wrapper = strict ? StrictMode : Fragment;
  await act(async () => root.render(<Wrapper><MapJourney /></Wrapper>));
  const opener = await choosePub();
  expect(opener.isConnected).toBe(false);

  await closePub();

  expect(document.activeElement).toBe(host.querySelector('[aria-label="Search the map"]'));
});

it.each([false, true])("keeps a connected opener as the return target (fallback=%s)", async (provideFallback) => {
  await act(async () => root.render(<MapJourney keepOpener provideFallback={provideFallback} />));
  const opener = await choosePub();
  expect(opener.isConnected).toBe(true);

  await closePub();

  expect(document.activeElement).toBe(opener);
});

it("respects a newer focus choice after the sheet closes", async () => {
  await act(async () => root.render(<MapJourney />));
  await choosePub();
  const other = host.querySelector<HTMLButtonElement>('[aria-label="Another map control"]')!;
  const observer = new MutationObserver(() => {
    if (!document.querySelector(".mobileSharedSheet")) queueMicrotask(() => other.focus());
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    await closePub();
    expect(document.activeElement).toBe(other);
  } finally {
    observer.disconnect();
  }
});

it("leaves focus to a strict dialog that takes ownership during close", async () => {
  await act(async () => root.render(<MapJourney protectAfterClose />));
  await choosePub();

  await closePub();

  const search = host.querySelector('[aria-label="Search the map"]')!;
  expect(host.querySelector('[role="dialog"][aria-label="Account dialog"]')).not.toBeNull();
  expect(search.closest("[inert]")).not.toBeNull();
  expect(document.activeElement).not.toBe(search);
});
