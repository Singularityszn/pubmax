import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { installNativeWebShareBridge, webShareDataIsShareable } from "@/lib/nativeWebShareBridge";

// THE ANDROID WEBVIEW HAS NO navigator.share, AND NINE SURFACES CALL IT.
// Measured on the Pixel 7 emulator: the Tonight share button answered "Could
// not share tonight" while the Share plugin, called directly, opened the OS
// picker (docs/proof/mobile-app-design/android-emu-pixel7/share/). The
// bridge fills the API over the plugin inside the shell and nowhere else.

const ROOT = join(__dirname, "..");

function fakeNavigator(withShare = false) {
  const nav: { share?: unknown; canShare?: unknown } = {};
  if (withShare) nav.share = async () => {};
  return nav;
}

describe("installNativeWebShareBridge", () => {
  it("does nothing off the shell, and never overrides an API the WebView has", () => {
    const off = fakeNavigator();
    installNativeWebShareBridge({ isNative: () => false, nav: off as Navigator });
    expect(off.share).toBeUndefined();

    const own = async () => {};
    const has = { share: own };
    installNativeWebShareBridge({ isNative: () => true, nav: has as unknown as Navigator });
    expect(has.share).toBe(own);
  });

  it("fills navigator.share and canShare over the native sheet inside the shell", async () => {
    const nav = fakeNavigator();
    const shareNatively = vi.fn(async () => "shared" as const);
    const release = installNativeWebShareBridge({
      isNative: () => true,
      nav: nav as Navigator,
      shareNatively,
    });
    expect(typeof nav.share).toBe("function");
    await expect(
      (nav.share as (d: unknown) => Promise<void>)({ title: "t", text: "x", url: "https://pubmaxxing.com/tonight" }),
    ).resolves.toBeUndefined();
    expect(shareNatively).toHaveBeenCalledWith({ title: "t", text: "x", url: "https://pubmaxxing.com/tonight" });
    expect((nav.canShare as (d: unknown) => boolean)({ url: "https://pubmaxxing.com" })).toBe(true);
    expect((nav.canShare as (d: unknown) => boolean)({})).toBe(false);
    release();
    expect(nav.share).toBeUndefined();
    expect(nav.canShare).toBeUndefined();
  });

  it("rejects a dismissed sheet with AbortError, the shape every caller already handles", async () => {
    const nav = fakeNavigator();
    installNativeWebShareBridge({
      isNative: () => true,
      nav: nav as Navigator,
      shareNatively: async () => "cancelled",
    });
    await expect((nav.share as (d: unknown) => Promise<void>)({ url: "https://x" })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects a sheet that could not open with something that is NOT a cancel, so the caller's fallback runs", async () => {
    const nav = fakeNavigator();
    installNativeWebShareBridge({
      isNative: () => true,
      nav: nav as Navigator,
      shareNatively: async () => "unavailable",
    });
    await expect((nav.share as (d: unknown) => Promise<void>)({ url: "https://x" })).rejects.not.toMatchObject({
      name: "AbortError",
    });
    await expect((nav.share as (d: unknown) => Promise<void>)({})).rejects.toBeInstanceOf(TypeError);
  });

  it("is what decides shareable", () => {
    expect(webShareDataIsShareable(null)).toBe(false);
    expect(webShareDataIsShareable({ title: "" })).toBe(false);
    expect(webShareDataIsShareable({ text: "x" })).toBe(true);
  });
});

describe("the shell installs the bridge with its document marker", () => {
  it("is wired from NativeShellChrome, the one place the shell marks the document", () => {
    const chrome = readFileSync(join(ROOT, "components/native/NativeShellChrome.tsx"), "utf8");
    expect(chrome).toContain("installNativeWebShareBridge()");
  });
});
