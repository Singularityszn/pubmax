import { afterEach, describe, expect, it, vi } from "vitest";

import { activateNativeDeepLinks } from "@/lib/nativeDeepLinks";
import {
  closeSystemBrowser,
  isOAuthCallbackPath,
  oauthOpensInSystemBrowser,
  openOAuthInSystemBrowser,
} from "@/lib/nativeOAuth";

// THIRD-PARTY SIGN-IN MAY NOT DEAD-END INSIDE THE SHELL.
//
// supabase-js navigates the WebView to the provider; Google refuses OAuth in
// an embedded web view (403 disallowed_useragent). Inside the shell the
// provider URL goes to the system browser and the universal link
// /auth/callback brings the person back; off the shell nothing changes.

const appListeners = new Map<string, (event: { url: string }) => void>();
const nativeApp = vi.fn(() => true);
const browser = { open: vi.fn(async () => {}), close: vi.fn(async () => {}) };

vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => nativeApp() }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (name: string, cb: (event: { url: string }) => void) => {
      appListeners.set(name, cb);
      return { remove: vi.fn(async () => {}) };
    }),
    getLaunchUrl: vi.fn(async () => null),
  },
}));
vi.mock("@capacitor/browser", () => ({ Browser: browser }));

afterEach(() => {
  vi.clearAllMocks();
  appListeners.clear();
  nativeApp.mockReturnValue(true);
});

describe("where an OAuth start goes", () => {
  it("asks for the URL only inside the shell", () => {
    expect(oauthOpensInSystemBrowser({ isNative: () => true })).toBe(true);
    expect(oauthOpensInSystemBrowser({ isNative: () => false })).toBe(false);
  });

  it("opens the provider in the system browser, full screen", async () => {
    const plugin = { open: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    await expect(
      openOAuthInSystemBrowser("https://accounts.google.com/o/oauth2/auth?x=1", {
        isNative: () => true,
        loadPlugin: async () => plugin,
      }),
    ).resolves.toBe("opened");
    expect(plugin.open).toHaveBeenCalledWith({
      url: "https://accounts.google.com/o/oauth2/auth?x=1",
      presentationStyle: "fullscreen",
    });
  });

  it("answers unavailable off the shell and when the plugin cannot load, and never throws", async () => {
    await expect(openOAuthInSystemBrowser("https://x", { isNative: () => false })).resolves.toBe(
      "unavailable",
    );
    await expect(
      openOAuthInSystemBrowser("https://x", {
        isNative: () => true,
        loadPlugin: async () => {
          throw new Error("no plugin");
        },
      }),
    ).resolves.toBe("unavailable");
    await expect(
      openOAuthInSystemBrowser("https://x", {
        isNative: () => true,
        loadPlugin: async () => ({
          open: async () => {
            throw new Error("refused");
          },
          close: async () => {},
        }),
      }),
    ).resolves.toBe("unavailable");
  });
});

describe("the callback closes the system browser", () => {
  it("recognises the callback path with and without a query", () => {
    expect(isOAuthCallbackPath("/auth/callback")).toBe(true);
    expect(isOAuthCallbackPath("/auth/callback?code=abc")).toBe(true);
    expect(isOAuthCallbackPath("/auth/callbacks")).toBe(false);
    expect(isOAuthCallbackPath("/map?sel=venue-1")).toBe(false);
  });

  it("closes through the plugin inside the shell and does nothing off it", async () => {
    const plugin = { open: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    await closeSystemBrowser({ isNative: () => true, loadPlugin: async () => plugin });
    expect(plugin.close).toHaveBeenCalledOnce();
    await closeSystemBrowser({ isNative: () => false, loadPlugin: async () => plugin });
    expect(plugin.close).toHaveBeenCalledOnce();
  });

  it("is what the deep-link route does for /auth/callback and for nothing else", async () => {
    const navigate = vi.fn();
    const cleanup = await activateNativeDeepLinks(navigate);
    const open = appListeners.get("appUrlOpen");
    expect(open).toBeTypeOf("function");

    open!({ url: "https://pubmaxxing.com/map?sel=venue-1" });
    expect(navigate).toHaveBeenLastCalledWith("/map?sel=venue-1");
    await Promise.resolve();
    expect(browser.close).not.toHaveBeenCalled();

    open!({ url: "https://pubmaxxing.com/auth/callback?code=abc" });
    await vi.waitFor(() => expect(navigate).toHaveBeenLastCalledWith("/auth/callback?code=abc"));
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledOnce());
    cleanup();
  });
});
