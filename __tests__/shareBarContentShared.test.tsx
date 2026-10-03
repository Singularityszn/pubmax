// @vitest-environment jsdom

import { act, createElement } from "react";
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
