// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import capacitorConfig from "../capacitor.config";
import { BRAND_COLORS } from "@/lib/brandMark.mjs";
import {
  NATIVE_FIRST_PAINT_EVENT,
  NATIVE_SPLASH_CEILING_MS,
  releaseNativeSplashOnFirstPaint,
} from "@/lib/nativeSplash";

// THE APP OPENED ON A BLACK FIELD FOR TWENTY SECONDS.
//
// Measured on the pubmaxx-390x844 simulator on 13 September 2026, a clean
// install of main against production: the WebView's provisional load started
// 1.7s after launch and the first document did not commit until 21.5s, and
// every frame between was the ink field with no mark on it. The page itself
// then painted in 0.9s. Nothing held the launch mark over that wait, because
// the shell had no splash plugin: UILaunchScreen is dismissed with the first
// native frame, whatever the WebView is still doing.
//
// The splash now stays up until the page has painted, and never longer than a
// fixed ceiling, so a dead network still reaches the bundled offline page.

const rootFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

afterEach(() => {
  delete (window as { __pubmaxFirstPaint?: boolean }).__pubmaxFirstPaint;
});

function frames() {
  const queue: Array<() => void> = [];
  return {
    afterPaint: (callback: () => void) => {
      queue.push(callback);
    },
    flush: () => {
      while (queue.length) queue.shift()?.();
    },
  };
}

describe("the launch splash is held until the page paints", () => {
  it("does nothing off the shell: no event, no plugin load", async () => {
    const loadPlugin = vi.fn();
    const heard = vi.fn();
    window.addEventListener(NATIVE_FIRST_PAINT_EVENT, heard);
    const clock = frames();
    releaseNativeSplashOnFirstPaint({
      isNative: () => false,
      loadPlugin,
      afterPaint: clock.afterPaint,
    });
    clock.flush();
    await Promise.resolve();
    expect(loadPlugin).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener(NATIVE_FIRST_PAINT_EVENT, heard);
  });

  it("announces first paint once and hides the splash once, after the frame", async () => {
    const hide = vi.fn(async () => {});
    const heard = vi.fn();
    window.addEventListener(NATIVE_FIRST_PAINT_EVENT, heard);
    const clock = frames();
    const deps = {
      isNative: () => true,
      loadPlugin: async () => ({ hide }),
      afterPaint: clock.afterPaint,
    };
    releaseNativeSplashOnFirstPaint(deps);
    // Nothing before the page has had a frame to paint in.
    expect(heard).not.toHaveBeenCalled();
    clock.flush();
    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
    expect(heard).toHaveBeenCalledOnce();

    // A second mount (a remounted shell chrome) spends nothing.
    releaseNativeSplashOnFirstPaint(deps);
    clock.flush();
    await Promise.resolve();
    expect(heard).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    window.removeEventListener(NATIVE_FIRST_PAINT_EVENT, heard);
  });

  it("stays silent when the plugin cannot load, because the ceiling still hides it", async () => {
    const clock = frames();
    releaseNativeSplashOnFirstPaint({
      isNative: () => true,
      loadPlugin: () => Promise.reject(new Error("not implemented")),
      afterPaint: clock.afterPaint,
    });
    expect(() => clock.flush()).not.toThrow();
    await Promise.resolve();
  });

  it("releases nothing when the chrome unmounts before the frame", async () => {
    const hide = vi.fn(async () => {});
    const clock = frames();
    const cancel = releaseNativeSplashOnFirstPaint({
      isNative: () => true,
      loadPlugin: async () => ({ hide }),
      afterPaint: clock.afterPaint,
    });
    cancel();
    clock.flush();
    await Promise.resolve();
    expect(hide).not.toHaveBeenCalled();
  });
});

describe("the splash is configured and wired on both shells", () => {
  it("auto-hides at the ceiling, on the launch field, with no spinner", () => {
    const splash = capacitorConfig.plugins?.SplashScreen as Record<string, unknown> | undefined;
    expect(splash).toBeDefined();
    // Auto-hide stays ON: it is the ceiling. The page hides it sooner.
    expect(splash?.launchAutoHide).toBe(true);
    expect(splash?.launchShowDuration).toBe(NATIVE_SPLASH_CEILING_MS);
    expect(NATIVE_SPLASH_CEILING_MS).toBe(12_000);
    expect(splash?.showSpinner).toBe(false);
    expect(splash?.backgroundColor).toBe(BRAND_COLORS.inkDeep);
  });

  it("carries the plugin as a dependency, so npx cap sync wires both shells", () => {
    const pkg = JSON.parse(rootFile("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@capacitor/splash-screen"]).toBeDefined();
  });

  it("releases the splash from the shell chrome, not from a web route's first read", () => {
    const chrome = rootFile("components/native/NativeShellChrome.tsx");
    expect(chrome).toContain("releaseNativeSplashOnFirstPaint");
  });

  it("releases the splash on the bundled offline page too", () => {
    // The offline page is served from the binary with no app bundle, so the
    // splash would otherwise stand over it until the ceiling.
    const offline = rootFile("native/web-stub/offline.html");
    expect(offline).toContain("SplashScreen");
    expect(offline).toContain(".hide(");
  });

  it("marks the shell's user agent, so the edge can tell the app from a stranger", () => {
    expect(capacitorConfig.appendUserAgent).toBe("PUBMAXXING-App");
  });
});

describe("the loading skeleton puts the nav where the loaded page puts it", () => {
  // ios-relaunch-4s.png: the skeleton drew the nav at 95px, the loaded page at
  // 57px, a 38px jump. SiteNav's bar already adds the top safe-area inset
  // (components/nav/siteNav.css), and the skeleton added it a second time as
  // its own top padding.
  const css = rootFile("components/nav/mobileNav.css");
  const firstBlock = (selector: string, source: string) => {
    const start = source.indexOf(`${selector} {`);
    expect(start, `${selector} rule is missing`).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf("}", start));
  };

  it("does not add the top inset the nav bar already adds", () => {
    expect(firstBlock(".routeLoadingShell", css)).not.toContain("safe-area-inset-top");
  });

  it("uses the same top padding as /tonight at every width", () => {
    const tonight = rootFile("app/tonight/tonight.css");
    expect(firstBlock(".tonightPage", tonight)).toContain("padding: 16px");
    expect(firstBlock(".routeLoadingShell", css)).toContain("padding: 16px");
    expect(tonight).toMatch(/@media \(max-width: 640px\) \{\s*\.tonightPage \{\s*padding-top: 10px;/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.routeLoadingShell \{\s*padding-top: 10px;/);
  });
});
