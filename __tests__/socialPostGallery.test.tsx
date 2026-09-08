// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SocialPostPhoto } from "@/lib/socialPosts";

vi.mock("@/components/social/SocialPostMedia", () => ({
  default: ({ media }: { media: SocialPostPhoto }) => createElement("div", { "data-media-id": media.mediaId },
    createElement("img", { alt: media.altText }),
    createElement("button", { type: "button" }, "Retry media")),
}));

import SocialPostGallery from "@/components/social/SocialPostGallery";

const photos: SocialPostPhoto[] = Array.from({ length: 5 }, (_, index) => ({
  mediaId: `photo-${index + 1}`, altText: `Evening photo ${index + 1}`, kind: "photo",
}));
let container: HTMLDivElement;
let root: Root;
let width: number;
let resize: Array<() => void>;
let disconnect: ReturnType<typeof vi.fn<() => void>>;
let scrollTo: ReturnType<typeof vi.fn>;
let oldScrollTo: PropertyDescriptor | undefined;

function track() { return container.querySelector<HTMLDivElement>(".socialPostGallery__track")!; }
function indicator() { return container.querySelector('[role="status"]')?.textContent; }
function mounted() { return [...container.querySelectorAll("[data-media-id]")].map(element => element.getAttribute("data-media-id")); }
function button(name: string) { return container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!; }

async function render(items = photos) {
  await act(async () => root.render(createElement(SocialPostGallery, { photos: items })));
}

async function key(value: string, element: Element = track(), modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...modifiers });
  await act(async () => { element.dispatchEvent(event); });
  return event;
}

async function swipe(left: number) {
  await act(async () => {
    track().scrollLeft = left;
    track().dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  width = 320;
  resize = [];
  disconnect = vi.fn();
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => width);
  oldScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollLeft = options.left ?? this.scrollLeft;
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize.push(callback); }
    observe() {}
    disconnect() { disconnect(); }
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (oldScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", oldScrollTo);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SocialPostGallery", () => {
  it("renders nothing for an empty gallery", async () => {
    await render([]);
    expect(container.childElementCount).toBe(0);
    expect(resize).toHaveLength(0);
  });

  it("preserves the single-media path without gallery controls or observers", async () => {
    await render([photos[0]]);
    expect(container.firstElementChild?.getAttribute("data-media-id")).toBe(photos[0].mediaId);
    expect(container.querySelector("img")?.alt).toBe(photos[0].altText);
    expect(container.querySelector(".socialPostGallery")).toBeNull();
    expect(resize).toHaveLength(0);
  });

  it("keeps source order and mounts only the first photo and its neighbour", async () => {
    await render();
    expect([...container.querySelectorAll('[aria-roledescription="slide"]')].map(slide => slide.getAttribute("aria-label"))).toEqual([
      "Photo 1 of 5", "Photo 2 of 5", "Photo 3 of 5", "Photo 4 of 5", "Photo 5 of 5",
    ]);
    expect(mounted()).toEqual(["photo-1", "photo-2"]);
    expect(indicator()).toBe("Photo 1 / 5");
    expect(button("Previous photo").disabled).toBe(true);
    expect(button("Next photo").disabled).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("moves the mount window on button navigation and keeps the actual alt text", async () => {
    await render();
    await act(async () => button("Next photo").click());
    expect(indicator()).toBe("Photo 2 / 5");
    expect(mounted()).toEqual(["photo-1", "photo-2", "photo-3"]);
    await act(async () => button("Next photo").click());
    expect(mounted()).toEqual(["photo-2", "photo-3", "photo-4"]);
    const active = container.querySelector('[aria-roledescription="slide"][aria-hidden="false"]')!;
    expect(active.querySelector("img")?.alt).toBe("Evening photo 3");
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 640, behavior: "instant" });
    await act(async () => button("Previous photo").click());
    expect(indicator()).toBe("Photo 2 / 5");
  });

  it("reads the nearest photo from native scrolling and clamps overscroll", async () => {
    await render();
    await swipe(510);
    expect(indicator()).toBe("Photo 3 / 5");
    expect(mounted()).toEqual(["photo-2", "photo-3", "photo-4"]);
    await swipe(10_000);
    expect(indicator()).toBe("Photo 5 / 5");
    expect(button("Next photo").disabled).toBe(true);
    await swipe(-100);
    expect(indicator()).toBe("Photo 1 / 5");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("handles Arrow, Home and End without wrapping or mounting intermediate photos", async () => {
    await render();
    expect((await key("ArrowRight")).defaultPrevented).toBe(true);
    expect(indicator()).toBe("Photo 2 / 5");
    await key("ArrowLeft");
    expect(indicator()).toBe("Photo 1 / 5");
    await key("ArrowLeft");
    expect(indicator()).toBe("Photo 1 / 5");
    await key("End");
    expect(indicator()).toBe("Photo 5 / 5");
    expect(mounted()).toEqual(["photo-4", "photo-5"]);
    expect(button("Next photo").disabled).toBe(true);
    await key("Home");
    expect(indicator()).toBe("Photo 1 / 5");
    expect(mounted()).toEqual(["photo-1", "photo-2"]);
  });

  it("leaves keys on media controls and modified shortcuts alone", async () => {
    await render();
    const retry = container.querySelector('[data-media-id="photo-1"] button')!;
    expect((await key("ArrowRight", retry)).defaultPrevented).toBe(false);
    expect((await key("End", track(), { ctrlKey: true })).defaultPrevented).toBe(false);
    expect((await key("Tab")).defaultPrevented).toBe(false);
    expect(indicator()).toBe("Photo 1 / 5");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("makes offscreen slides inert and links both controls to the focusable scroller", async () => {
    await render();
    expect(track().tabIndex).toBe(0);
    expect(button("Previous photo").getAttribute("aria-controls")).toBe(track().id);
    expect(button("Next photo").getAttribute("aria-controls")).toBe(track().id);
    await key("ArrowRight");
    const slides = [...container.querySelectorAll('[aria-roledescription="slide"]')];
    expect(slides.map(slide => slide.hasAttribute("inert"))).toEqual([true, false, true, true, true]);
    expect(slides.map(slide => slide.getAttribute("aria-hidden"))).toEqual(["true", "false", "true", "true", "true"]);
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-atomic")).toBe("true");
  });

  it("keeps the selected photo aligned after resize, including an early native scroll event", async () => {
    await render();
    await key("End");
    width = 640;
    await swipe(1280);
    expect(indicator()).toBe("Photo 5 / 5");
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 2560, behavior: "instant" });
    width = 390;
    await act(async () => resize[0]());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 1560, behavior: "instant" });
    expect(indicator()).toBe("Photo 5 / 5");
  });

  it("uses window resize when ResizeObserver is unavailable and cleans up", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    await render();
    await key("ArrowRight");
    width = 430;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 430, behavior: "instant" });
    await render([]);
    scrollTo.mockClear();
    window.dispatchEvent(new Event("resize"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("resets on replacement or reordering but preserves position when only alt text changes", async () => {
    await render();
    await key("End");
    await render(photos.map(photo => ({ ...photo, altText: `${photo.altText}, updated` })));
    expect(indicator()).toBe("Photo 5 / 5");
    expect(container.querySelector('[data-media-id="photo-5"] img')?.getAttribute("alt")).toContain("updated");
    await render([...photos].reverse());
    expect(indicator()).toBe("Photo 1 / 5");
    expect(mounted()).toEqual(["photo-5", "photo-4"]);
    expect(disconnect).toHaveBeenCalledOnce();
    await render([photos[0]]);
    expect(container.querySelector(".socialPostGallery")).toBeNull();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("never animates programmatic navigation and ignores a zero-width scroller", async () => {
    await render();
    await key("End");
    expect(scrollTo.mock.calls.every(([options]) => options.behavior === "instant")).toBe(true);
    width = 0;
    await key("Home");
    await swipe(0);
    expect(indicator()).toBe("Photo 5 / 5");
    width = 320;
    await act(async () => resize[0]());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 1280, behavior: "instant" });
  });
});
