// @vitest-environment jsdom
// An account sign-out on a device that holds a second account, driven through
// the real AuthProvider, the real switch and the real resume-cookie client. Only
// the Supabase client and the network are fakes.
//
// THE ORDER UNDER TEST: the durable resume cookie's DELETE finishes before the
// next account is installed. The next account's SIGNED_IN persists a new cookie;
// a DELETE still in flight would land after that persist and leave the device
// with no durable session at all.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/components/auth/authContext";

const h = vi.hoisted(() => ({
  session: null as Session | null,
  subscriber: null as null | ((event: string, session: Session | null) => void),
  log: [] as string[],
  setSession: vi.fn<(tokens: { refresh_token: string }) => Promise<unknown>>(),
  signOut: vi.fn<() => Promise<void>>(),
  refreshSession: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ nativePlatform: () => null, isNativeApp: () => false }));
vi.mock("@/lib/authClient", async (original) => ({
  ...await original<typeof import("@/lib/authClient")>(),
  isAuthConfigured: () => true,
  // A signed-in browser stores its session, so the client loads at once.
  hasStoredBrowserSession: () => h.session !== null,
  ensureSupabaseBrowser: async () => ({ auth: {
    setSession: h.setSession,
    signOut: h.signOut,
    refreshSession: h.refreshSession,
    getSession: async () => ({ data: { session: h.session }, error: null }),
    onAuthStateChange: (callback: typeof h.subscriber) => {
      h.subscriber = callback;
      queueMicrotask(() => callback?.("INITIAL_SESSION", h.session));
      return { data: { subscription: { unsubscribe: () => { h.subscriber = null; } } } };
    },
  } }),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: async () => h.session ? ({ status: "local", session: h.session }) : ({ status: "none" }),
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: true, apple: true, microsoft: true }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
  guardSocialAuthProvider: async (_provider: string, start: () => Promise<unknown>) => ({ result: await start() }),
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: async () => null,
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));

import { deviceAccountOwner } from "@/lib/deviceAccountIdentity";
import { readDeviceAccounts, rememberDeviceAccount } from "@/lib/deviceAccountSessions";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";

const SUPABASE_URL = "https://handoff.supabase.co";
const token = ["e30", Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "unsigned"].join(".");
const leaving = { user: { id: "leaving" }, access_token: token, refresh_token: "leaving-refresh" } as Session;
const NEXT_STORED = "next-stored-refresh";
const NEXT_ROTATED = "next-rotated-refresh";

let actions: AuthContextValue;
function Probe() {
  const auth = useAuth();
  useEffect(() => { actions = auth; }, [auth]);
  return createElement("output", null, auth.user?.id ?? "signed-out");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let finishDelete: () => void;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } });
  window.history.replaceState(null, "", "/map");
  h.session = leaving; h.log = [];
  vi.clearAllMocks();
  h.signOut.mockImplementation(async () => {
    h.log.push("provider sign-out");
    h.session = null;
    h.subscriber?.("SIGNED_OUT", null);
  });
  h.setSession.mockImplementation(async ({ refresh_token }) => {
    h.log.push(`setSession ${refresh_token}`);
    h.session = { user: { id: "next" }, access_token: token, refresh_token } as Session;
    h.subscriber?.("SIGNED_IN", h.session);
    return { data: { session: h.session, user: h.session.user }, error: null };
  });
  const deleted = new Promise<void>((resolve) => { finishDelete = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/auth/session" && method === "DELETE") {
      h.log.push("cookie DELETE sent");
      await deleted;
      h.log.push("cookie DELETE done");
      return json({ ok: true });
    }
    if (url.startsWith(`${SUPABASE_URL}/auth/v1/token`)) {
      h.log.push("token exchange");
      return json({ access_token: token, refresh_token: NEXT_ROTATED, expires_in: 3600, token_type: "bearer" });
    }
    if (url === "/api/auth/session") return json({ status: "stored" });
    return json({});
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe))); });
  await vi.waitFor(() => expect(container.textContent).toBe("leaving"));
  rememberDeviceAccount(localStorage, { userId: "next", refreshToken: NEXT_STORED }, Date.now());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("an account sign-out that hands the device to the next account", () => {
  it("finishes the cookie DELETE before it installs the next account", async () => {
    let pending!: Promise<void>;
    await act(async () => { pending = actions.signOut("account"); });
    await vi.waitFor(() => expect(h.log).toContain("cookie DELETE sent"));
    expect(h.setSession).not.toHaveBeenCalled();

    await act(async () => { finishDelete(); await pending; });

    expect(h.log).toEqual([
      "provider sign-out",
      "cookie DELETE sent",
      "cookie DELETE done",
      "token exchange",
      `setSession ${NEXT_ROTATED}`,
    ]);
    expect(container.textContent).toBe("next");
  });

  it("binds the next account through the auth event and never refreshes the live client", async () => {
    await act(async () => {
      const pending = actions.signOut("account");
      finishDelete();
      await pending;
    });

    expect(deviceAccountOwner(localStorage)).toBe("next");
    expect(readDeviceAccounts(localStorage).map((row) => [row.userId, row.refreshToken]))
      .toEqual([["next", NEXT_ROTATED]]);
    expect(h.refreshSession).not.toHaveBeenCalled();
  });
});
