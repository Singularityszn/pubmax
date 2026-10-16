// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CityStatusBanner from "@/components/map/CityStatusBanner";
import { dispatchDismissKey, performBackAction } from "@/lib/nativeBackGesture";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

// This test owns dismissal after the feed arrives. The stagger delay has its
// own tests, so do not spend a real timer to reach this public control.
vi.mock("@/lib/useStaggeredRead", () => ({ useStaggeredRead: () => true }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  clearSurfaceCache();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
    signals: [{
      headline: "Kingston Market Place closed following fire",
      severity: "major",
      kind: "alert",
      areas: ["Kingston"],
    }],
  }), { status: 200 }))));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearSurfaceCache();
  vi.unstubAllGlobals();
});

function control<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

async function expandFeed() {
  await act(async () => {
    root.render(<CityStatusBanner cityId="london" viewedArea="Kingston" />);
  });
  await act(async () => control<HTMLButtonElement>(".cityStatusBannerLink").click());
  expect(host.querySelector(".cityStatusSignalSheet")).not.toBeNull();
}

describe("London updates claims Escape only while its feed is visible", () => {
  it("keeps native Back on the expanded feed and restores its trigger focus", async () => {
    await expandFeed();
    const trigger = control<HTMLButtonElement>(".cityStatusBannerLink");
    act(() => control<HTMLButtonElement>('[aria-label="Close signals list"]').focus());
    let consumed = false;
    act(() => { consumed = dispatchDismissKey(); });
    expect(consumed).toBe(true);
    expect(host.querySelector(".cityStatusSignalSheet")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("releases keyboard Escape after session Dismiss hides an expanded feed", async () => {
    await expandFeed();
    await act(async () => control<HTMLButtonElement>('[aria-label="Dismiss city status"]').click());
    expect(host.querySelector(".cityStatusStack")).toBeNull();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => document.body.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false);
  });

  it("releases native window Back to history after session Dismiss hides an expanded feed", async () => {
    await expandFeed();
    await act(async () => control<HTMLButtonElement>('[aria-label="Dismiss city status"]').click());
    expect(host.querySelector(".cityStatusStack")).toBeNull();
    const goBack = vi.fn();
    const exit = vi.fn();
    let action: ReturnType<typeof performBackAction> | undefined;
    act(() => {
      action = performBackAction(true, { dismiss: () => dispatchDismissKey(), goBack, exit });
    });
    expect(action).toEqual({ kind: "history" });
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("releases native window Back when a city change removes the expanded feed", async () => {
    await expandFeed();
    await act(async () => root.render(<CityStatusBanner cityId="manchester" viewedArea="Kingston" />));
    expect(host.querySelector(".cityStatusStack")).toBeNull();
    let consumed = true;
    act(() => { consumed = dispatchDismissKey(); });
    expect(consumed).toBe(false);
  });
});
