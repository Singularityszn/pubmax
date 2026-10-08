// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeferredShellExtras from "@/components/DeferredShellExtras";

// Dynamic features remain unloaded, as they do while their chunks are in flight.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@capacitor/app", () => ({
  App: { addListener: async () => ({ remove: async () => {} }) },
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("iOS back during shell startup", () => {
  it("pops history before dynamic native features load and removes the listener on unmount", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "ios" });
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<DeferredShellExtras />));
    const swipe = () => window.dispatchEvent(new CustomEvent("pubmax:ios-back", { detail: { canGoBack: true } }));

    swipe();
    expect(back).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount());
    root = undefined;
    swipe();
    expect(back).toHaveBeenCalledTimes(1);
  });
});
