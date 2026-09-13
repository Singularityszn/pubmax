// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE SHELL CHROME IS WHAT LIFTS THE LAUNCH SPLASH.
//
// lib/nativeSplash.ts holds the mark until a painted frame, and nothing calls
// it but NativeShellChrome. If the chrome stopped starting the release, every
// launch would stand on the splash for the full 12s ceiling.

const isNativeApp = vi.fn(() => true);
const cancelSplashRelease = vi.fn();
const releaseNativeSplashOnFirstPaint = vi.fn(() => cancelSplashRelease);

vi.mock("@/lib/nativePlatform", () => ({
  isNativeApp: () => isNativeApp(),
  nativePlatform: () => "ios",
}));
vi.mock("@/lib/nativeSplash", () => ({
  releaseNativeSplashOnFirstPaint: () => releaseNativeSplashOnFirstPaint(),
}));
vi.mock("@/lib/nativeTextScale", () => ({ followNativeTextScale: () => () => {} }));
vi.mock("@/lib/nativeWebShareBridge", () => ({ installNativeWebShareBridge: () => () => {} }));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount() {
  const { default: NativeShellChrome } = await import("@/components/native/NativeShellChrome");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(NativeShellChrome));
  });
}

async function unmount() {
  await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  isNativeApp.mockReturnValue(true);
});

afterEach(async () => {
  if (root) await unmount();
});

describe("NativeShellChrome and the launch splash", () => {
  it("starts the release when it mounts in the shell and cancels it when it unmounts", async () => {
    await mount();
    expect(releaseNativeSplashOnFirstPaint).toHaveBeenCalledOnce();
    expect(cancelSplashRelease).not.toHaveBeenCalled();

    await unmount();
    expect(cancelSplashRelease).toHaveBeenCalledOnce();
  });

  it("starts no release on the web", async () => {
    isNativeApp.mockReturnValue(false);
    await mount();
    await unmount();
    expect(releaseNativeSplashOnFirstPaint).not.toHaveBeenCalled();
    expect(cancelSplashRelease).not.toHaveBeenCalled();
  });
});
