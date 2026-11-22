// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/components/auth/authContext";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/messages" }));
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ nativePlatform: () => null, isNativeApp: () => false }));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: true, apple: true, microsoft: true }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/identityClient", async (original) => ({
  ...await original<typeof import("@/lib/identityClient")>(),
  handleClaimRouteAfterSignIn: async () => null,
  resolveCanonicalIdentity: async () => ({ ok: true, identity: null }),
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { browserResumePersistence } from "@/lib/authResumePersistence";
import { rememberDeviceAccount } from "@/lib/deviceAccountSessions";

const URL = "https://session-loss.supabase.co";
function session(id: string, version: string): Session {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const claims = Buffer.from(JSON.stringify({ sub: id, exp, session_id: version })).toString("base64url");
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${claims}.unsigned`, refresh_token: `${id}-${version}`,
    token_type: "bearer", expires_in: 3600, expires_at: exp,
    user: { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-17T00:00:00Z" },
  };
}
const original = session("account-a", "older");
const restored = session("account-a", "resume");
const other = session("account-b", "switch");
let actions: AuthContextValue;
function Probe() {
  const auth = useAuth();
  const viewer = useViewerSession();
  useEffect(() => { actions = auth; }, [auth]);
  return createElement("output", null, `${auth.user?.id ?? "none"}:${viewer.phase}`);
}
function json(body: unknown) { return Response.json(body); }
let root: Root;
let container: HTMLDivElement;
let redeem!: (value: Response) => void;
let redeemStarted: Promise<void>;
let requests: string[];
let cookie: Session | null;
let beforeUser: (() => Promise<void>) | null;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => unknown) => callback() } });
  requests = [];
  beforeUser = null;
  cookie = restored;
  let started!: () => void;
  redeemStarted = new Promise<void>((resolve) => { started = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/session") {
      if (init?.method === "DELETE") { cookie = null; requests.push("delete"); return json({ ok: true }); }
      if (init?.method !== "POST") return json({ hint: cookie ? { maskedEmail: null } : null });
      const body = JSON.parse(String(init.body));
      requests.push(body.action);
      if (body.action === "redeem") {
        started();
        const response = await new Promise<Response>((resolve) => { redeem = resolve; });
        const result = await response.clone().json();
        if (result.status === "restored") cookie = result.session;
        requests.push("redeem done");
        return response;
      }
      cookie = [original, restored, other].find((value) => value.refresh_token === body.refreshToken) ?? cookie;
      return json({ status: "stored" });
    }
    if (url.startsWith(`${URL}/auth/v1/user`)) {
      await beforeUser?.();
      const bearer = new Headers(init?.headers).get("authorization");
      return json([restored, other].find((value) => bearer === `Bearer ${value.access_token}`)?.user ?? original.user);
    }
    if (url.startsWith(`${URL}/auth/v1/token`)) {
      requests.push("token exchange");
      return json(JSON.parse(String(init?.body)).refresh_token === original.refresh_token ? original : other);
    }
    if (url === "/api/identity/onboarding") return json({ complete: true });
    return json({});
  }));
  const client = (await ensureSupabaseBrowser())!;
  await client.auth.setSession(original);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => {
    await import("@/components/identity/AccountOnboarding");
    root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe)));
  });
  await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("account-a:signed-in"));
  cookie = restored;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await browserResumePersistence.clear();
  await (await ensureSupabaseBrowser())?.auth.stopAutoRefresh();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

// Issue #3050 requires runtime cookie recovery, not a new sign-in door.
// The real SDK emits SIGNED_OUT. Only its HTTP boundaries are replaced.
it("restores an unsolicited session loss without reloading or showing a sign-in door", async () => {
  const client = (await ensureSupabaseBrowser())!;
  await act(async () => { await client.auth.signOut({ scope: "local" }); });
  expect(container.querySelector("output")?.textContent).toBe("none:unresolved");
  await redeemStarted;
  await act(async () => { redeem(json({ status: "restored", session: restored })); });
  await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("account-a:signed-in"));
  expect((await client.auth.getSession()).data.session?.refresh_token).toBe(restored.refresh_token);
});

it("keeps explicit sign-out signed out and never redeems its cookie", async () => {
  await act(async () => { await actions.signOut("device"); });
  expect(container.querySelector("output")?.textContent).toBe("none:signed-out");
  expect(cookie).toBeNull();
  expect(requests).not.toContain("redeem");
});

it.each(["sign-out", "switch"] as const)("discards a pending redeem after an explicit %s", async (action) => {
  const client = (await ensureSupabaseBrowser())!;
  await act(async () => { await client.auth.signOut({ scope: "local" }); });
  await redeemStarted;
  rememberDeviceAccount(localStorage, { userId: other.user.id, refreshToken: other.refresh_token }, Date.now());
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = action === "sign-out" ? actions.signOut("device") : actions.switchAccount(other.user.id);
  });
  const wroteBeforeRedeem = requests.includes(action === "sign-out" ? "delete" : "token exchange");
  await act(async () => {
    redeem(json({ status: "restored", session: restored }));
    await pending;
  });
  expect(wroteBeforeRedeem).toBe(false);
  expect((await client.auth.getSession()).data.session?.user.id ?? null).toBe(action === "switch" ? other.user.id : null);
  expect(container.querySelector("output")?.textContent).toBe(action === "switch" ? "account-b:signed-in" : "none:signed-out");
  expect(cookie?.user.id ?? null).toBe(action === "switch" ? other.user.id : null);
});

it("forgets the lost account on account sign-out instead of reactivating it", async () => {
  const client = (await ensureSupabaseBrowser())!;
  await act(async () => { await client.auth.signOut({ scope: "local" }); });
  await redeemStarted;
  let pending!: Promise<void>;
  await act(async () => { pending = actions.signOut("account"); });
  await act(async () => {
    redeem(json({ status: "restored", session: restored }));
    await pending;
  });
  expect((await client.auth.getSession()).data.session).toBeNull();
  expect(container.querySelector("output")?.textContent).toBe("none:signed-out");
});

it("keeps a newer account's cookie when an older resume response arrives last", async () => {
  const client = (await ensureSupabaseBrowser())!;
  await act(async () => { await client.auth.signOut({ scope: "local" }); });
  await redeemStarted;
  await act(async () => { await client.auth.setSession(other); });
  await act(async () => { redeem(json({ status: "restored", session: restored })); });
  expect((await client.auth.getSession()).data.session?.user.id).toBe(other.user.id);
  expect(container.querySelector("output")?.textContent).toBe("account-b:signed-in");
  expect(cookie?.user.id).toBe(other.user.id);
});

it("rejects a different account's cookie instead of silently switching the viewer", async () => {
  const client = (await ensureSupabaseBrowser())!;
  await act(async () => { await client.auth.signOut({ scope: "local" }); });
  await redeemStarted;
  await act(async () => { redeem(json({ status: "restored", session: other })); });
  expect((await client.auth.getSession()).data.session).toBeNull();
  expect(container.querySelector("output")?.textContent).toBe("none:unresolved");
});

it("does not save a recovery cancelled during the real SDK's user lookup", async () => {
  const client = (await ensureSupabaseBrowser())!;
  let releaseUser!: () => void;
  let userStarted!: () => void;
  const started = new Promise<void>((resolve) => { userStarted = resolve; });
  const user = new Promise<void>((resolve) => { releaseUser = resolve; });
  beforeUser = async () => { userStarted(); await user; };
  await act(async () => { await client.auth.signOut({ scope: "local" }); });
  await redeemStarted;
  await act(async () => { redeem(json({ status: "restored", session: restored })); });
  await started;
  await act(async () => {
    const signingOut = actions.signOut("device");
    releaseUser();
    await signingOut;
  });
  expect((await client.auth.getSession()).data.session).toBeNull();
  expect(container.querySelector("output")?.textContent).toBe("none:signed-out");
});

it("retries an unavailable runtime resume on focus without declaring sign-out", async () => {
  const client = (await ensureSupabaseBrowser())!;
  await act(async () => { await client.auth.signOut({ scope: "local" }); });
  await redeemStarted;
  await act(async () => { redeem(json({ status: "unavailable" })); });
  expect(container.querySelector("output")?.textContent).toBe("none:unresolved");
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(requests.filter((action) => action === "redeem")).toHaveLength(2);
  await act(async () => { redeem(json({ status: "restored", session: restored })); });
  await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("account-a:signed-in"));
});

it.each(["none", "expired", "banned"])("publishes signed-out only after the cookie answers %s", async (status) => {
  const client = (await ensureSupabaseBrowser())!;
  await act(async () => { await client.auth.signOut({ scope: "local" }); });
  await redeemStarted;
  await act(async () => { redeem(json({ status, maskedEmail: null, message: "This account has been banned." })); });
  expect(container.querySelector("output")?.textContent).toBe("none:signed-out");
  expect((await client.auth.getSession()).data.session).toBeNull();
});
