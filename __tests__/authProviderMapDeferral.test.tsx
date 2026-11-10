// @vitest-environment jsdom
// A signed-out reader opening the map, driven through the real AuthProvider.
// Only the Supabase client and the network are fakes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ loads: 0, hint: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => window.location.pathname }));
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ nativePlatform: () => null, isNativeApp: () => false }));
vi.mock("@/lib/authClient", async (original) => {
  const browser = async () => {
    h.loads += 1;
    return { auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: (callback: (event: string, session: null) => void) => {
        queueMicrotask(() => callback("INITIAL_SESSION", null));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    } };
  };
  return {
    ...await original<typeof import("@/lib/authClient")>(),
    isAuthConfigured: () => true,
    ensureSupabaseBrowser: browser,
  };
});
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: true, apple: true, microsoft: true }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
  guardSocialAuthProvider: async (_provider: string, start: () => Promise<unknown>) => ({ result: await start() }),
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";

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
  it("is answered signed out before the pins without loading supabase-js", async () => {
    await mount();

    await vi.waitFor(() => expect(container.textContent).toBe("settled:signed-out"));
    expect(h.loads).toBe(0);

    await act(async () => { window.dispatchEvent(new Event(PINS_VISIBLE_EVENT)); });
    await vi.waitFor(() => expect(h.loads).toBe(1));
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
        await vi.waitFor(() => expect(h.loads).toBe(1));
      }
    } finally {
      Object.defineProperty(window, "localStorage", storage);
    }
  });

  it.each([429, 503, "timeout"] as const)("keeps auth unresolved until pins when the resume probe fails with %s", async (failure) => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/auth/session") {
        if (failure === "timeout") throw new DOMException("Request timed out", "TimeoutError");
        return new Response("{}", { status: failure });
      }
      return new Response("{}", { status: 200 });
    });
    await mount();

    expect(h.loads).toBe(0);
    expect(container.textContent).toBe("loading:unresolved");

    await act(async () => { window.dispatchEvent(new Event(PINS_VISIBLE_EVENT)); });

    await vi.waitFor(() => expect(container.textContent).toBe("settled:unavailable"));
    expect(h.loads).toBe(1);
  });

  it.each(["/", "/tonight", "/mapping"])("settles unresolved auth after leaving the map for %s", async (pathname) => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 503 }));
    await mount();
    expect(h.loads).toBe(0);
    expect(container.textContent).toBe("loading:unresolved");

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
