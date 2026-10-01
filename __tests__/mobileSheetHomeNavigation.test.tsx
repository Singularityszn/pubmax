// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

describe("mobile sheet Home navigation", () => {
  it("returns Home through onClose and keeps Back on its parent callback", async () => {
    const onClose = vi.fn();
    const onDismiss = vi.fn();
    const onBack = vi.fn();

    await act(async () => {
      root!.render(
        <MobileSharedSheet
          kind="filters"
          title="Filters"
          initialSnap="peek"
          onClose={onClose}
          onDismiss={onDismiss}
          backLabel="Back to the venue"
          onBack={onBack}
        >
          <p>Filter venues</p>
        </MobileSharedSheet>,
      );
    });

    const home = document.body.querySelector<HTMLButtonElement>(".surfaceNavHome");
    const back = document.body.querySelector<HTMLButtonElement>(".surfaceNavBack");
    expect(home).not.toBeNull();
    expect(back).not.toBeNull();

    await act(async () => home!.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => back!.click());
    expect(onBack).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
