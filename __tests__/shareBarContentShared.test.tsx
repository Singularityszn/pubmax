// @vitest-environment jsdom

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@/lib/analytics", () => ({ trackEvent: analytics.trackEvent }));

import ShareBar from "@/components/share/ShareBar";

let container: HTMLDivElement;
let root: Root;

async function render(url: string): Promise<void> {
  await act(async () => {
    root.render(createElement(ShareBar, { url, title: "A night out" }));
  });
}

async function copyLink(): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Copy link"], button[aria-label="Link copied"]')?.click();
    await Promise.resolve();
  });
}

function sharedSurfaces(): unknown[] {
  return analytics.trackEvent.mock.calls
    .filter(([name]) => name === "content_shared")
    .map(([, props]) => (props as { surface: string }).surface);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  analytics.trackEvent.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ShareBar emitted links", () => {
  it("uses the production origin for both anchors, copy, and native share", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pubmaxxing.com");
    const previousShare = Object.getOwnPropertyDescriptor(navigator, "share");
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    try {
      await render("/plan/abc?vibe=quiet-pint#invite=token");
      const expected = "https://pubmaxxing.com/plan/abc?vibe=quiet-pint#invite=token";
      const whatsapp = new URL(container.querySelector<HTMLAnchorElement>('a[aria-label="Share on WhatsApp"]')!.href);
      const tweet = new URL(container.querySelector<HTMLAnchorElement>('a[aria-label="Share on X"]')!.href);
      expect(whatsapp.searchParams.get("text")).toBe(`A night out ${expected}`);
      expect(tweet.searchParams.get("url")).toBe(expected);
      await copyLink();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected);
      await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Share to another app"]')!.click(); });
      expect(share).toHaveBeenCalledWith({ title: "A night out", text: "A night out", url: expected });
    } finally {
      if (previousShare) Object.defineProperty(navigator, "share", previousShare);
      else Reflect.deleteProperty(navigator, "share");
      vi.unstubAllEnvs();
    }
  });

  it("emits absolute invite URLs during SSR and after mounting", async () => {
    const path = "/plan/abc?vibe=date-night#invite=secret-token";
    const server = document.createElement("div");
    server.innerHTML = renderToStaticMarkup(createElement(ShareBar, { url: path, title: "A night out" }));
    const assertLinks = (element: HTMLDivElement, expected: string) => {
      const whatsapp = new URL(element.querySelector<HTMLAnchorElement>('a[aria-label="Share on WhatsApp"]')!.href);
      const tweet = new URL(element.querySelector<HTMLAnchorElement>('a[aria-label="Share on X"]')!.href);
      expect(whatsapp.searchParams.get("text")).toBe(`A night out ${expected}`);
      expect(tweet.searchParams.get("url")).toBe(expected);
    };
    assertLinks(server, "https://pubmaxxing.com/plan/abc?vibe=date-night#invite=secret-token");
    await render(path);
    assertLinks(container, `${window.location.origin}${path}`);
    await copyLink();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}${path}`);
  });
});

describe("ShareBar content_shared surface", () => {
  it.each([
    ["/plan/abc?invite=tok", "plan"],
    ["/plan/abc/recap", "recap"],
    ["/recap/story-1", "recap"],
    ["/crawls/soho-classic", "poster"],
    ["/tonight", "tonight"],
    ["/p/drop-1", "other"],
    ["https://pubmaxxing.com/historic/the-lamb", "other"],
  ])("labels %s as %s", async (url, surface) => {
    await render(url);
    await copyLink();
    expect(analytics.trackEvent).toHaveBeenCalledWith("content_shared", { channel: "copy", surface });
  });

  it("reports the current url after a re-render with a new link", async () => {
    await render("/plan/abc");
    await copyLink();
    await render("/plan/abc/recap");
    await copyLink();
    expect(sharedSurfaces()).toEqual(["plan", "recap"]);
  });
});

describe("ShareBar copied flash", () => {
  afterEach(() => vi.useRealTimers());

  it("leaves no reset timer running once the bar unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render("/plan/abc");
    await copyLink();
    expect(container.querySelector('button[aria-label="Link copied"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ShareBar intent shares", () => {
  // Per the HTML spec, window.open returns null whenever "noopener" is in the
  // features, and only a blocked popup returns null otherwise.
  function stubWindowOpen(blocked: boolean) {
    const popup = { opener: window as unknown };
    return vi.spyOn(window, "open").mockImplementation((_url, _target, features) => {
      if (blocked || String(features ?? "").includes("noopener")) return null;
      return popup as unknown as Window;
    });
  }

  async function clickShare(label: string): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLAnchorElement>(`a[aria-label="${label}"]`)?.click();
    });
  }

  function status(): string {
    return container.querySelector('[role="status"]')?.textContent ?? "";
  }

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["Share on X", "x"],
    ["Share on WhatsApp", "whatsapp"],
  ])("%s records content_shared and severs the opener", async (label, channel) => {
    const open = stubWindowOpen(false);
    await render("/plan/abc");
    await clickShare(label);
    expect(analytics.trackEvent).toHaveBeenCalledWith("content_shared", { channel, surface: "plan" });
    expect(status()).toBe("");
    expect(open.mock.results[0]?.value).toMatchObject({ opener: null });
  });

  it("reports a blocked popup without recording a share", async () => {
    stubWindowOpen(true);
    await render("/plan/abc");
    await clickShare("Share on X");
    expect(sharedSurfaces()).toEqual([]);
    expect(status()).toBe("Could not open sharing app. Try again.");
  });
});
