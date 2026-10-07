// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppEntryRoute from "@/components/native/AppEntryRoute";
import { readAuthCallbackAttempt } from "@/lib/authRedirect";
import { establishAuthCallbackSession } from "@/lib/authCallbackClient";
import { PREFERRED_CITY_KEY } from "@/lib/cityPreference";
import { SESSION_ENTRY_CONSUMED_KEY } from "@/lib/entryDecision";
import { markTourSeen } from "@/lib/firstRunTour";
import {
  NATIVE_FIRST_RUN_DONE_KEY,
  NATIVE_FIRST_RUN_LEGACY_ROUTED_KEY,
  NATIVE_FIRST_RUN_STEP_KEY,
  consumeNativeFirstRunHandoff,
  markNativeFirstRunRouted,
  readNativeFirstRunStep,
  rememberNativeFirstRunStep,
} from "@/lib/nativeFirstRun";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace }),
}));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => true }));

const source = readFileSync("public/theme-init.js", "utf8");
const doneKey = NATIVE_FIRST_RUN_DONE_KEY;
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
    if (routed) localStorage.setItem(doneKey, "1");
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
    expect(sessionStorage.length).toBe(path === "React" ? 1 : 0);
    expect(sessionStorage.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBe(path === "React" ? "1" : null);
    expect(localStorage.getItem(doneKey)).toBe(routed ? "1" : null);
    expect(window.location.hash).toBe(fragment);
    const callback = readAuthCallbackAttempt(window.location.href);
    expect(callback?.tokens).toEqual({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh" });
    const setSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: "synthetic-user" } } }, error: null });
    await establishAuthCallbackSession({ setSession }, callback!.tokens!);
    expect(setSession).toHaveBeenCalledWith({ access_token: "synthetic-access", refresh_token: "synthetic-refresh" });
  });

  it.each(["script", "React"])("%s preserves a marked provider error", async (path) => {
    if (routed) localStorage.setItem(doneKey, "1");
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
    expect(sessionStorage.length).toBe(path === "React" ? 1 : 0);
    expect(sessionStorage.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBe(path === "React" ? "1" : null);
    expect(window.location.search).toBe(search);
    expect(readAuthCallbackAttempt(window.location.href)?.providerError).toBe(true);
  });

  it("counts a React callback boot as the session entry for a later home tap", async () => {
    if (routed) localStorage.setItem(doneKey, "1");
    window.history.replaceState(null, "", "/" + fragment);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root!.render(createElement(AppEntryRoute)));
    await act(() => root!.unmount());
    window.history.replaceState(null, "", "/");
    root = createRoot(container);
    await act(() => root!.render(createElement(AppEntryRoute)));
    if (routed) expect(replace).not.toHaveBeenCalled();
    else expect(replace).toHaveBeenCalledWith("/onboarding");
  });

  it("keeps ordinary React entry routing", async () => {
    if (routed) localStorage.setItem(doneKey, "1");
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
    if (routed) localStorage.setItem(doneKey, "1");
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
    if (!routed) localStorage.removeItem(doneKey);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root!.render(createElement(AppEntryRoute)));
    expect(replace).toHaveBeenCalledWith(routed ? "/tonight" : "/onboarding");
    // Unmarked root errors remain outside callback validation's accepted scope.
    expect(readAuthCallbackAttempt(window.location.href)).toBeNull();
  });
});

// Releases before the resumable journey stamped the routed mark when routing
// STARTED, and stamped the tour mark only on Skip or Plan my night. An upgrade
// must keep a finished device on Tonight and resume an interrupted one, and the
// pre-paint script and the React entry must agree on every one of them.
describe("upgrade from a release that marked routing start", () => {
  async function destinations(seed: () => void): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    for (const path of ["/", "/app-entry", "React"]) {
      localStorage.clear();
      sessionStorage.clear();
      replace.mockClear();
      seed();
      if (path === "React") {
        const container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
        await act(() => root!.render(createElement(AppEntryRoute)));
        await act(() => root!.unmount());
        root = null;
      } else {
        new Function("window", source)({
          Capacitor: { isNativePlatform: () => true },
          location: { pathname: path, hash: "", search: "", replace },
          localStorage,
          sessionStorage,
        });
      }
      result[path] = replace.mock.calls.map(([href]) => href as string);
    }
    return result;
  }

  it.each([
    ["no city", () => {}],
    ["a stored city", () => localStorage.setItem(PREFERRED_CITY_KEY, "london")],
  ])("resumes an interrupted legacy journey with %s on every entry path", async (_label, seedCity) => {
    const seen = await destinations(() => {
      localStorage.setItem(NATIVE_FIRST_RUN_LEGACY_ROUTED_KEY, "1");
      seedCity();
    });
    expect(seen).toEqual({ "/": ["/onboarding"], "/app-entry": ["/onboarding"], React: ["/onboarding"] });
    expect(readNativeFirstRunStep()).toBe("london");
    expect(consumeNativeFirstRunHandoff(true)).toBe(true);
  });

  it.each([
    ["the current tour mark", () => markTourSeen()],
    ["the legacy tour mark", () => localStorage.setItem("pubmax-tour-v1-done", "1")],
  ])("keeps a finished legacy journey on Tonight with %s on every entry path", async (_label, seedTour) => {
    const seen = await destinations(() => {
      localStorage.setItem(NATIVE_FIRST_RUN_LEGACY_ROUTED_KEY, "1");
      seedTour();
    });
    expect(seen).toEqual({ "/": ["/tonight"], "/app-entry": ["/tonight"], React: ["/tonight"] });
    expect(readNativeFirstRunStep()).toBeNull();
  });

  it("finishes a resumed legacy journey on Skip, so the next launch opens Tonight", async () => {
    localStorage.setItem(NATIVE_FIRST_RUN_LEGACY_ROUTED_KEY, "1");
    rememberNativeFirstRunStep("budget");
    markNativeFirstRunRouted();
    markTourSeen();
    const done = { ...localStorage };
    const seen = await destinations(() => {
      for (const [key, value] of Object.entries(done)) localStorage.setItem(key, value);
    });
    expect(seen).toEqual({ "/": ["/tonight"], "/app-entry": ["/tonight"], React: ["/tonight"] });
  });

  it("does not resume a new journey from the tour mark alone", async () => {
    const seen = await destinations(() => {
      markTourSeen();
      localStorage.setItem(NATIVE_FIRST_RUN_STEP_KEY, "location");
    });
    expect(seen).toEqual({ "/": ["/onboarding"], "/app-entry": ["/onboarding"], React: ["/onboarding"] });
    expect(readNativeFirstRunStep()).toBe("location");
  });
});
