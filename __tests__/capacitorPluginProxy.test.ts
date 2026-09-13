// @vitest-environment jsdom

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeSystemBrowser, openOAuthInSystemBrowser } from "@/lib/nativeOAuth";
import { recordKeptAction, resetStoreReviewPrompt } from "@/lib/nativeReviewPrompt";
import { shareViaNativeSheet } from "@/lib/nativeShare";
import { releaseNativeSplashOnFirstPaint } from "@/lib/nativeSplash";

// A CAPACITOR PLUGIN IS A PROXY THAT ANSWERS "then" WITH A NATIVE CALL.
//
// registerPlugin() hands back a Proxy whose every property is a native method,
// so `return Share` from an async loader made the await look for a thenable,
// call "Share.then()" on the native side and reject with '"Share.then()" is
// not implemented on android'. Three seams did exactly that: the OS share
// sheet never opened (every share fell to its web fallback), the store review
// was never requested, and the system-browser sign-in would have failed the
// same way. Their unit tests injected plain fakes, which is why nothing
// caught it; this file mocks the plugin modules with a proxy shaped like the
// real one and drives each seam's DEFAULT loader.
// Measured: docs/proof/mobile-app-design/android-emu-pixel7/share/.

function capacitorProxy(name: string, methods: Record<string, (...args: unknown[]) => unknown>) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop in methods) return methods[prop];
        return () => Promise.reject(new Error(`"${name}.${prop}()" is not implemented on android`));
      },
    },
  );
}

const share = vi.fn(async () => ({ activityType: "x" }));
const open = vi.fn(async () => {});
const close = vi.fn(async () => {});
const requestReview = vi.fn(async () => {});

vi.mock("@capacitor/share", () => ({ Share: capacitorProxy("Share", { share }) }));
vi.mock("@capacitor/browser", () => ({ Browser: capacitorProxy("Browser", { open, close }) }));
vi.mock("@capacitor-community/in-app-review", () => ({
  InAppReview: capacitorProxy("InAppReview", { requestReview }),
}));
const hide = vi.fn(async () => {});
vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: capacitorProxy("SplashScreen", { hide }),
}));

const memoryStorage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => memoryStorage.set(key, String(value)),
    removeItem: (key: string) => memoryStorage.delete(key),
    clear: () => memoryStorage.clear(),
    key: () => null,
    get length() {
      return memoryStorage.size;
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  memoryStorage.clear();
  resetStoreReviewPrompt();
});

afterEach(() => {
  resetStoreReviewPrompt();
});

const native = { isNative: () => true };

describe("every default plugin loader survives the real plugin's shape", () => {
  it("opens the OS share sheet", async () => {
    await expect(
      shareViaNativeSheet({ title: "t", text: "x", url: "https://pubmaxxing.com/tonight" }, native),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledOnce();
  });

  it("opens and closes the system browser", async () => {
    await expect(openOAuthInSystemBrowser("https://accounts.google.com/x", native)).resolves.toBe("opened");
    expect(open).toHaveBeenCalledWith({ url: "https://accounts.google.com/x", presentationStyle: "fullscreen" });
    await closeSystemBrowser(native);
    expect(close).toHaveBeenCalledOnce();
  });

  it("requests the store review once the floor is met", async () => {
    await expect(recordKeptAction("price-logged", native)).resolves.toBe("skipped");
    await expect(recordKeptAction("price-logged", native)).resolves.toBe("requested");
    expect(requestReview).toHaveBeenCalledOnce();
  });

  it("hides the launch splash on first paint", async () => {
    releaseNativeSplashOnFirstPaint({ isNative: () => true, afterPaint: (paint) => paint() });
    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
  });
});

describe("no native seam returns a plugin proxy from an async loader", () => {
  const ROOT = join(__dirname, "..");
  const PLUGIN_NAMES = [
    "Share",
    "Browser",
    "InAppReview",
    "Camera",
    "Haptics",
    "PushNotifications",
    "App",
    "SystemBars",
    "SplashScreen",
  ];

  it("hands back a plain object that closes over the plugin instead", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(join(ROOT, "lib")).filter((file) => /^native.*\.ts$/.test(file))) {
      const source = readFileSync(join(ROOT, "lib", name), "utf8");
      for (const plugin of PLUGIN_NAMES) {
        if (new RegExp(`\\n\\s*return ${plugin};`).test(source)) offenders.push(`lib/${name}: return ${plugin}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
