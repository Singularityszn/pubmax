/** @vitest-environment jsdom */

import Image from "next/image";
import { act, createElement, StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import HandleAvatar from "@/components/profile/HandleAvatar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function imageAttributes(html: string): Record<string, string> {
  const host = document.createElement("div");
  host.innerHTML = html;
  return Object.fromEntries(
    [...host.querySelector("img")!.attributes].map(({ name, value }) => [name, value]),
  );
}

describe("the unoptimized handle avatar", () => {
  it.each([
    "https://example.test/avatar.jpg?signature=a%2Fb",
    "/api/avatar/person?generation=2",
    "/api/avatar/person?generation=2&dpl=existing",
    "//example.test/avatar.jpg",
    "data:image/png;base64,aA==",
    "blob:https://example.test/avatar",
  ])("preserves the real installed Next server image attributes for %s", (src) => {
    const actual = renderToStaticMarkup(createElement(HandleAvatar, {
      handle: "karan", avatarUrl: src, size: 176,
      className: "avatarFallback", imageClassName: "profileAvatar",
    }));
    const original = renderToStaticMarkup(createElement(Image, {
      src, alt: "", width: 176, height: 176, unoptimized: true,
      className: "profileAvatar", onError: () => {},
    }));
    expect(imageAttributes(actual)).toEqual(imageAttributes(original));
    expect(imageAttributes(actual)).not.toHaveProperty("srcset");
  });

  it("recovers a failed image whose error occurred before hydration", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const element = createElement(HandleAvatar, {
      handle: "karan", avatarUrl: "https://example.test/broken.jpg", className: "avatarFallback",
    });
    host.innerHTML = renderToString(element);
    const image = host.querySelector("img")!;
    image.dispatchEvent(new Event("error"));
    expect(host.querySelector("img")).toBe(image);
    const setter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!.set!;
    const replay = vi.spyOn(HTMLImageElement.prototype, "src", "set")
      .mockImplementation(function (this: HTMLImageElement, value: string) {
        setter.call(this, value);
        this.dispatchEvent(new Event("error"));
      });
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(host, element); });
      expect(replay).toHaveBeenCalledTimes(1);
      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector("span")?.textContent).toBe("K");
      expect(host.querySelector("span")?.className).toBe("avatarFallback");
      expect(host.querySelector("span")?.hasAttribute("style")).toBe(false);
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  });

  it("replays once per actual keyed image through StrictMode, URL changes and remount", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const replay = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    const avatar = (avatarUrl?: string, size = 40) => createElement(StrictMode, null,
      createElement(HandleAvatar, { handle: "karan", avatarUrl, size }));
    try {
      await act(async () => root.render(avatar("https://example.test/one.jpg")));
      const one = host.querySelector("img")!;
      // React commitHostMount writes src once. The guarded layout replay writes it once more.
      expect(replay).toHaveBeenCalledTimes(2);
      await act(async () => root.render(avatar("https://example.test/one.jpg", 56)));
      expect(host.querySelector("img")).toBe(one);
      expect(replay).toHaveBeenCalledTimes(2);
      await act(async () => root.render(avatar("https://example.test/two.jpg")));
      expect(host.querySelector("img")).not.toBe(one);
      expect(replay).toHaveBeenCalledTimes(4);
      await act(async () => one.dispatchEvent(new Event("error")));
      expect(host.querySelector("img")?.src).toBe("https://example.test/two.jpg");
      await act(async () => root.render(avatar()));
      await act(async () => root.render(avatar("https://example.test/two.jpg")));
      expect(replay).toHaveBeenCalledTimes(6);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("retries the failed current URL after the existing online debounce", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(HandleAvatar, {
        handle: "karan", avatarUrl: "https://example.test/one.jpg",
      })));
      await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
      expect(host.querySelector("img")).toBeNull();
      await act(async () => window.dispatchEvent(new Event("online")));
      await act(async () => vi.advanceTimersByTime(149));
      expect(host.querySelector("img")).toBeNull();
      await act(async () => vi.advanceTimersByTime(1));
      expect(host.querySelector("img")?.src).toBe("https://example.test/one.jpg");
      await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
      expect(host.querySelector("img")).toBeNull();
      await act(async () => root.render(createElement(HandleAvatar, {
        handle: "karan", avatarUrl: "https://example.test/two.jpg",
      })));
      expect(host.querySelector("img")?.src).toBe("https://example.test/two.jpg");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("keeps successful rendering, async decoding attributes, consumer focus and clicks", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const clicked = vi.fn();
    try {
      await act(async () => root.render(createElement("button", {
        type: "button", onClick: clicked,
      }, createElement(HandleAvatar, {
        handle: "karan", avatarUrl: "https://example.test/one.jpg",
        className: "avatarFallback", imageClassName: "accountAvatar", size: 44,
      }))));
      const image = host.querySelector("img")!;
      const button = host.querySelector("button")!;
      button.focus();
      await act(async () => image.dispatchEvent(new Event("load")));
      await act(async () => image.dispatchEvent(new Event("load")));
      expect(host.querySelector("img")).toBe(image);
      expect(image.className).toBe("accountAvatar");
      expect(image.width).toBe(44);
      expect(image.height).toBe(44);
      expect(image.alt).toBe("");
      expect(image.getAttribute("decoding")).toBe("async");
      expect(image.style.color).toBe("transparent");
      expect(image.hasAttribute("tabindex")).toBe(false);
      expect(document.activeElement).toBe(button);
      await act(async () => image.click());
      expect(clicked).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(button);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
