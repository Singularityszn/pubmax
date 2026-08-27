// @vitest-environment jsdom

import { act, createElement, Profiler, type ProfilerOnRenderCallback } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TonightShareButton from "@/app/tonight/TonightShareButton";

const trackEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/analytics", () => ({ trackEvent }));

let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = null;
  trackEvent.mockClear();
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  host.remove();
  vi.restoreAllMocks();
});

function shareButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("Share button did not render.");
  return button;
}

describe("Tonight share hydration", () => {
  it("keeps server markup inert and enables a client-only mount in its first commit", async () => {
    host.innerHTML = renderToString(createElement(TonightShareButton));
    expect(shareButton().disabled).toBe(true);

    host.replaceChildren();
    const commits: Parameters<ProfilerOnRenderCallback>[1][] = [];
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(
          Profiler,
          {
            id: "tonight-share",
            onRender: (_id, phase) => commits.push(phase),
          },
          createElement(TonightShareButton),
        ),
      );
    });

    expect(shareButton().disabled).toBe(false);
    expect(commits).toEqual(["mount"]);
  });

  it("opens native share with canonical Tonight details", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(TonightShareButton));
    });

    await act(async () => shareButton().click());

    expect(share).toHaveBeenCalledWith({
      title: "Tonight in London · PUBMAXXING",
      text: "What's on in London tonight. A grounded, live read.",
      url: `${window.location.origin}/tonight`,
    });
    expect(trackEvent).toHaveBeenCalledWith("poster_shared", {
      surface: "tonight",
    });
  });
});
