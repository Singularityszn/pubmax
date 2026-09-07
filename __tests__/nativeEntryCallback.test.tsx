// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppEntryRoute from "@/components/native/AppEntryRoute";
import { readAuthCallbackAttempt } from "@/lib/authRedirect";
import { establishAuthCallbackSession } from "@/lib/authCallbackClient";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace }),
}));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => true }));

const source = readFileSync("public/theme-init.js", "utf8");
const routedKey = "pubmax:nativeFirstRun:routed:v1";
const fragment = "#access_token=synthetic-access&refresh_token=synthetic-refresh&type=magiclink";
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  replace.mockClear();
  window.history.replaceState(null, "", "/");
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe.each([false, true])("native callback, previously routed=%s", (routed) => {
  it.each(["script", "React"])("%s preserves tokens for callback completion", async (path) => {
    if (routed) localStorage.setItem(routedKey, "1");
    window.history.replaceState(null, "", "/" + fragment);
    if (path === "script") {
      new Function("window", source)({
        Capacitor: { isNativePlatform: () => true },
        location: { pathname: "/", hash: fragment, search: "", replace },
        localStorage,
        sessionStorage,
      });
    } else {
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      await act(() => root!.render(createElement(AppEntryRoute)));
    }
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem(routedKey)).toBe(routed ? "1" : null);
    expect(window.location.hash).toBe(fragment);
    const callback = readAuthCallbackAttempt(window.location.href);
    expect(callback?.tokens).toEqual({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh" });
    const setSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: "synthetic-user" } } }, error: null });
    await establishAuthCallbackSession({ setSession }, callback!.tokens!);
    expect(setSession).toHaveBeenCalledWith({ access_token: "synthetic-access", refresh_token: "synthetic-refresh" });
  });

  it.each(["script", "React"])("%s preserves a marked provider error", async (path) => {
    if (routed) localStorage.setItem(routedKey, "1");
    const search = "?_authCallback=1&authError=1";
    window.history.replaceState(null, "", "/" + search);
    if (path === "script") {
      new Function("window", source)({
        Capacitor: { isNativePlatform: () => true },
        location: { pathname: "/", hash: "", search, replace },
        localStorage,
        sessionStorage,
      });
    } else {
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      await act(() => root!.render(createElement(AppEntryRoute)));
    }
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(window.location.search).toBe(search);
    expect(readAuthCallbackAttempt(window.location.href)?.providerError).toBe(true);
  });

  it("keeps ordinary React entry routing", async () => {
    if (routed) localStorage.setItem(routedKey, "1");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root!.render(createElement(AppEntryRoute)));
    expect(replace).toHaveBeenCalledWith(routed ? "/tonight" : "/onboarding");
  });

  it.each([
    "#error=access_denied", "#error_code=otp_expired",
    "#access_token=synthetic-access", "#refresh_token=synthetic-refresh",
    "#access_token=&refresh_token=", "#%65rror=access_denied",
  ])("keeps unmarked root response %s outside callback handling", async (hash) => {
    if (routed) localStorage.setItem(routedKey, "1");
    window.history.replaceState(null, "", "/" + hash);
    new Function("window", source)({
      Capacitor: { isNativePlatform: () => true },
      location: { pathname: "/", hash, search: "", replace },
      localStorage,
      sessionStorage,
    });
    expect(replace).toHaveBeenCalledWith(routed ? "/tonight" : "/onboarding");
    replace.mockClear();
    sessionStorage.clear();
    if (!routed) localStorage.removeItem(routedKey);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root!.render(createElement(AppEntryRoute)));
    expect(replace).toHaveBeenCalledWith(routed ? "/tonight" : "/onboarding");
    // Unmarked root errors remain outside callback validation's accepted scope.
    expect(readAuthCallbackAttempt(window.location.href)).toBeNull();
  });
});
