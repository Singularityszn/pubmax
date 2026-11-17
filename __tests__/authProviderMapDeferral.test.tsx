// @vitest-environment jsdom
// A signed-out reader opening the map, driven through the real AuthProvider.
// Only the Supabase client and the network are fakes.
import { act, createElement } from "react";
import { performance as timing } from "node:perf_hooks";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loads: 0,
  hint: null as unknown,
  built: Promise.resolve() as Promise<unknown>,
  announceClient: () => {},
  sessionRead: Promise.resolve({ data: { session: null }, error: null }),
  initialEvent: null as null | ((event: string, session: null) => void),
  emitInitial: true,
  storedSession: false,
  signInWithOtp: vi.fn(async () => ({ error: null })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => window.location.pathname }));
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ nativePlatform: () => null, isNativeApp: () => false }));
vi.mock("@/lib/authClient", async (original) => {
  const browser = async () => {
    h.loads += 1;
    h.announceClient();
    return { auth: {
      getSession: () => h.sessionRead,
      signInWithOtp: h.signInWithOtp,
      onAuthStateChange: (callback: (event: string, session: null) => void) => {
        h.initialEvent = callback;
        if (h.emitInitial) queueMicrotask(() => callback("INITIAL_SESSION", null));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    } };
  };
  return {
    ...await original<typeof import("@/lib/authClient")>(),
    isAuthConfigured: () => true,
    ensureSupabaseBrowser: browser,
    ensureSupabaseBrowserForSession: () => h.built,
    hasStoredBrowserSession: () => h.storedSession,
  };
});
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: true, apple: true, microsoft: true }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
  guardSocialAuthProvider: async (_provider: string, start: () => Promise<unknown>) => ({ result: await start() }),
  hasSocialAuthProviders: (providers: Record<string, boolean>) => Object.values(providers).some(Boolean),
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";
import { beginAuthAttempt } from "@/lib/authRedirect";
import SignInButton from "@/components/auth/SignInButton";

function Probe() {
  const auth = useAuth();
  return createElement("output", null, `${auth.loading ? "loading" : "settled"}:${auth.supabaseAuthState}`);
}

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://deferral.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } });
  window.history.replaceState(null, "", "/map");
  h.loads = 0;
  h.hint = null;
  h.built = new Promise((resolve) => { h.announceClient = () => resolve(null); });
  h.sessionRead = Promise.resolve({ data: { session: null }, error: null });
  h.initialEvent = null;
  h.emitInitial = true;
  h.storedSession = false;
  h.signInWithOtp.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/auth/session") return new Response(JSON.stringify({ hint: h.hint }), { status: 200 });
    return new Response("{}", { status: 200 });
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function mount() {
  await act(async () => { root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe))); });
}

describe("a signed-out reader opening the map", () => {
  it("does not repeat a confirmed negative resume probe on focus", async () => {
    await mount();
    expect(container.textContent).toBe("settled:signed-out");
    const reads = vi.mocked(fetch).mock.calls.length;

    await act(async () => { window.dispatchEvent(new Event("focus")); });

    expect(vi.mocked(fetch).mock.calls).toHaveLength(reads);
    expect(h.loads).toBe(0);
  });

  it("keeps a newly discovered session unavailable until a failed restore can retry", async () => {
    await mount();
    expect(container.textContent).toBe("settled:signed-out");

    await act(async () => {
      h.storedSession = true;
      h.sessionRead = Promise.reject(new Error("session storage read failed"));
      window.dispatchEvent(new Event("storage"));
    });
    await vi.waitFor(() => expect(container.textContent).toBe("settled:unavailable"));

    await act(async () => {
      h.sessionRead = Promise.resolve({ data: { session: null }, error: null });
      window.dispatchEvent(new Event("focus"));
    });
    await vi.waitFor(() => expect(container.textContent).toBe("settled:signed-out"));
  });

  it("marks bootstrap only after the client session read finishes", async () => {
    vi.stubGlobal("performance", timing);
    timing.clearMarks("pubmax:auth-bootstrap-settled");
    await mount();
    expect(timing.getEntriesByName("pubmax:auth-bootstrap-settled")).toHaveLength(0);
    let finish!: () => void;
    h.sessionRead = new Promise((resolve) => {
      finish = () => resolve({ data: { session: null }, error: null });
    });

    window.history.pushState(null, "", "/login");
    await mount();
    expect(h.loads).toBe(1);
    expect(timing.getEntriesByName("pubmax:auth-bootstrap-settled")).toHaveLength(0);

    await act(async () => { finish(); });
    expect(timing.getEntriesByName("pubmax:auth-bootstrap-settled")).toHaveLength(1);
    timing.clearMarks("pubmax:auth-bootstrap-settled");
  });

  it("retains the desktop email confirmation through deferred client initialisation", async () => {
    let finishSessionRead!: () => void;
    h.sessionRead = new Promise((resolve) => {
      finishSessionRead = () => resolve({ data: { session: null }, error: null });
    });
    h.emitInitial = false;
    await act(async () => {
      root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(SignInButton, { compact: true })));
    });
    expect(h.loads).toBe(0);
    await act(async () => container.querySelector<HTMLButtonElement>(".authCompactTrigger")!.click());
    const input = container.querySelector<HTMLInputElement>("input[type=email]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "reader@example.test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = container.querySelector("form")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(h.signInWithOtp).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Link sent");

    await act(async () => { h.initialEvent!("INITIAL_SESSION", null); });
    expect(container.querySelector("form")).toBe(form);
    expect(container.textContent).toContain("Link sent");

    await act(async () => { finishSessionRead(); });
    expect(container.querySelector("form")).toBe(form);
    expect(input.value).toBe("reader@example.test");
    expect(container.textContent).toContain("Link sent");
  });

  it("is answered signed out before the pins without loading supabase-js", async () => {
    await mount();

    await vi.waitFor(() => expect(container.textContent).toBe("settled:signed-out"));
    expect(h.loads).toBe(0);

    await act(async () => { window.dispatchEvent(new Event(PINS_VISIBLE_EVENT)); });
    expect(h.loads).toBe(0);
    expect(container.textContent).toBe("settled:signed-out");
  });

  it("loads the client at once when the durable resume cookie can restore a session", async () => {
    h.hint = { maskedEmail: "k***@example.test" };
    await mount();

    await vi.waitFor(() => expect(h.loads).toBe(1));
  });

  it.each([false, true])("uses the resume hint with blocked storage and a durable session of %s", async (present) => {
    const storage = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    h.hint = present ? { maskedEmail: "k***@example.test" } : null;
    try {
      await mount();

      if (present) {
        await vi.waitFor(() => expect(h.loads).toBe(1));
      } else {
        await vi.waitFor(() => expect(container.textContent).toBe("settled:signed-out"));
        expect(h.loads).toBe(0);
        await act(async () => { window.dispatchEvent(new Event(PINS_VISIBLE_EVENT)); });
        expect(h.loads).toBe(0);
      }
    } finally {
      Object.defineProperty(window, "localStorage", storage);
    }
  });

  it.each([429, 503, "timeout"] as const)("reports an unavailable resume probe without fetching the SDK for %s", async (failure) => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/auth/session") {
        if (failure === "timeout") throw new DOMException("Request timed out", "TimeoutError");
        return new Response("{}", { status: failure });
      }
      return new Response("{}", { status: 200 });
    });
    await mount();

    expect(h.loads).toBe(0);
    expect(container.textContent).toBe("settled:unavailable");
    await act(async () => { window.dispatchEvent(new Event(PINS_VISIBLE_EVENT)); });
    expect(h.loads).toBe(0);
    vi.mocked(fetch).mockImplementation(async () => Response.json({ hint: null }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await vi.waitFor(() => expect(container.textContent).toBe("settled:signed-out"));
    expect(h.loads).toBe(0);
  });

  it.each([
    ["online", false], ["visible", false], ["focus", false],
    ["online", true], ["visible", true], ["focus", true],
  ] as const)("handles %s recovery before pins with a pending sign-in of %s", async (event, pending) => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 503 }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const wake = async () => {
      await act(async () => {
        if (event === "visible") document.dispatchEvent(new Event("visibilitychange"));
        else window.dispatchEvent(new Event(event));
        await vi.runAllTimersAsync();
      });
    };
    try {
      await mount();
      expect(container.textContent).toBe("settled:unavailable");
      expect(h.loads).toBe(0);
      if (pending) {
        expect(beginAuthAttempt(window.location.href, undefined, {
          persistentStorage: localStorage, tabStorage: sessionStorage, cryptoProvider: crypto,
        }).ok).toBe(true);
      }
      await wake();
      if (pending) {
        // A pending sign-in permits recovery to load the SDK before pins.
        expect(h.loads).toBe(1);
        expect(container.textContent).toBe("settled:unavailable");
        vi.mocked(fetch).mockImplementation(async () => Response.json({ hint: null }));
        await wake();
        expect(container.textContent).toBe("settled:signed-out");
      } else {
        expect(h.loads).toBe(0);
        expect(container.textContent).toBe("settled:unavailable");
      }
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each(["/login", "/auth/reset-password", "/auth/callback"])("permits client loading after navigating to %s", async (pathname) => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 503 }));
    await mount();
    expect(h.loads).toBe(0);
    expect(container.textContent).toBe("settled:unavailable");

    window.history.pushState(null, "", "/map/manchester");
    await mount();
    expect(h.loads).toBe(0);

    window.history.pushState(null, "", pathname);
    await mount();
    await vi.waitFor(() => expect(container.textContent).toBe("settled:unavailable"));
    expect(h.loads).toBe(1);

    window.history.replaceState(null, "", "/map");
    await mount();
    expect(h.loads).toBe(1);
  });
});
