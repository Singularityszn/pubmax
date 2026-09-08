// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/map/glasgow" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => createElement("a", props) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/pubpal/PubPalAvatar", () => ({ PubPalAvatar: () => null }));

import PubPalSummon, { observePubPalHeight } from "@/components/pubpal/PubPalSummon";

const token = "--pal-summon-rendered-h";
let height: number;
let host: HTMLDivElement;
let root: Root | undefined;
let callbacks: Array<() => void>;
let disconnects: Array<ReturnType<typeof vi.fn>>;
let cleanups: Array<() => void>;
let fonts: EventTarget;
let originalFonts: PropertyDescriptor | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  height = 52;
  callbacks = [];
  disconnects = [];
  cleanups = [];
  route.pathname = "/map/glasgow";
  localStorage.clear();
  fonts = new EventTarget();
  Object.defineProperty(fonts, "ready", { value: Promise.resolve(fonts) });
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(callback: () => void) {
      callbacks.push(callback);
      disconnects.push(this.disconnect);
    }
  });
  originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
  Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { height: this.style.display === "none" ? 0 : height } as DOMRect;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  for (const cleanup of cleanups) cleanup();
  host.remove();
  document.body.style.removeProperty(token);
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountObserver() {
  const element = document.createElement("a");
  host.appendChild(element);
  const cleanup = observePubPalHeight(element);
  cleanups.push(cleanup);
  return { element, cleanup };
}
const published = () => document.body.style.getPropertyValue(token);

describe("Pub Pal rendered height", () => {
  it("publishes growth and shrink without changing the link minimum", () => {
    const { element } = mountObserver();
    expect(published()).toBe("52px");
    height = 70;
    callbacks[0]();
    expect(published()).toBe("70px");
    height = 52;
    callbacks[0]();
    expect(published()).toBe("52px");
    expect(element.style.cssText).toBe("");
  });

  it("updates after resize and font completion", async () => {
    mountObserver();
    height = 84;
    window.dispatchEvent(new Event("resize"));
    expect(published()).toBe("84px");
    height = 96;
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(published()).toBe("96px");
    height = 100;
    await Promise.resolve();
    expect(published()).toBe("100px");
  });

  it("releases hidden geometry and clears its value on removal", async () => {
    const { element, cleanup } = mountObserver();
    element.style.display = "none";
    callbacks[0]();
    expect(published()).toBe("0px");
    element.style.display = "";
    height = 70;
    callbacks[0]();
    expect(published()).toBe("70px");
    cleanup();
    height = 90;
    callbacks[0]();
    window.dispatchEvent(new Event("resize"));
    fonts.dispatchEvent(new Event("loadingdone"));
    await Promise.resolve();
    expect(published()).toBe("");
    expect(disconnects[0]).toHaveBeenCalled();
  });

  it("does not let an older observer erase a replacement", () => {
    const first = mountObserver();
    height = 70;
    mountObserver();
    first.cleanup();
    callbacks[0]();
    expect(published()).toBe("70px");
  });

  it("binds on component mount and cleans up for hidden or excluded routes", async () => {
    localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({ name: "Ada", appearance: {}, hidden: false }));
    root = createRoot(host);
    await act(async () => root?.render(createElement(PubPalSummon)));
    expect(host.querySelector(".palSummon")?.getAttribute("aria-label")).toBe("Summon Ada, your Pub Pal");
    expect(published()).toBe("52px");
    localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({ name: "Ada", appearance: {}, hidden: true }));
    route.pathname = "/map/london";
    await act(async () => root?.render(createElement(PubPalSummon)));
    expect(host.querySelector(".palSummon")).toBeNull();
    expect(published()).toBe("");
    localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({ name: "Ada", appearance: {}, hidden: false }));
    route.pathname = "/plan";
    await act(async () => root?.render(createElement(PubPalSummon)));
    expect(published()).toBe("52px");
    route.pathname = "/about";
    await act(async () => root?.render(createElement(PubPalSummon)));
    expect(published()).toBe("");
  });
});
