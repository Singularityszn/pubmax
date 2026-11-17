// @vitest-environment jsdom
import type { Session } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";

function session(id: string, nonce = "initial"): Session {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: id, exp, session_id: nonce })).toString("base64url");
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.unsigned`, refresh_token: `${id}-${nonce}-refresh`, token_type: "bearer", expires_in: 3600, expires_at: exp,
    user: { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-17T00:00:00Z" },
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

it.each(["account-switch", "same-account-switch", "replacement-link", "unmount"])("does not install a recovered session after %s during the SDK user lookup", async mode => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://recovery-install-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_recovery_test");
  const a = session("recovering-a"), b = session(mode === "same-account-switch" ? "recovering-a" : "active-b", "concurrent");
  let release!: () => void;
  let reached!: () => void;
  const started = new Promise<void>(resolve => { reached = resolve; });
  let current = true;
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (new Headers(init?.headers).get("authorization") === `Bearer ${a.access_token}`) {
      reached();
      await new Promise<void>(resolve => { release = resolve; });
      return Response.json(a.user);
    }
    return Response.json(b.user);
  });
  const { ensureSupabaseBrowser, captureRecoverySessionBaseline, installRecoveredSession } = await import("@/lib/authClient");
  const client = await ensureSupabaseBrowser();
  if (!client) throw new Error("Missing fixture client");
  const installing = installRecoveredSession(a, () => current, captureRecoverySessionBaseline());
  await started;
  current = false;
  if (mode.includes("switch")) await client.auth.setSession(b);
  release();
  expect(await installing).toBe(false);
  expect((await client.auth.getSession()).data.session?.refresh_token ?? null).toBe(mode.includes("switch") ? b.refresh_token : null);
  await client.auth.stopAutoRefresh();
});

it("rolls back a cancelled save before publishing identity, and keeps a valid save", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://recovery-event-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_recovery_event");
  const a = session("recovering-a");
  vi.stubGlobal("fetch", async () => Response.json(a.user));
  const { ensureSupabaseBrowser, captureRecoverySessionBaseline, installRecoveredSession, ignoreStaleRecoverySessionEvent } = await import("@/lib/authClient");
  const client = await ensureSupabaseBrowser();
  if (!client) throw new Error("Missing fixture client");
  let current = true;
  let cancel = true;
  const published: string[] = [];
  const registration = client.auth.onAuthStateChange((event, value) => {
    if (event !== "SIGNED_IN" || !value) return;
    if (cancel) current = false;
    if (!ignoreStaleRecoverySessionEvent(value)) { published.push(value.user.id); current = false; }
  });
  expect(await installRecoveredSession(a, () => current, captureRecoverySessionBaseline())).toBe(false);
  expect((await client.auth.getSession()).data.session).toBeNull();
  expect(published).toEqual([]);
  current = true; cancel = false;
  expect(await installRecoveredSession(a, () => current, captureRecoverySessionBaseline())).toBe(true);
  expect(published).toEqual([a.user.id]);
  registration.data.subscription.unsubscribe();
  await client.auth.stopAutoRefresh();
});

it("does not renew and install a cancelled recovery after a suspended tab resumes with expired tokens", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://recovery-expiry-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_recovery_expiry");
  let now = Date.now();
  let suspended = false;
  vi.spyOn(Date, "now").mockImplementation(() => suspended ? (now += 60_000) : now);
  const a = session("recovering-a");
  const request = vi.fn(async () => Response.json(session("recovering-a", "refreshed")));
  vi.stubGlobal("fetch", request);
  const { ensureSupabaseBrowser, captureRecoverySessionBaseline, installRecoveredSession } = await import("@/lib/authClient");
  const client = await ensureSupabaseBrowser();
  if (!client) throw new Error("Missing fixture client");
  await client.auth.initialize();
  let current = true;
  const install = client.auth.setSession.bind(client.auth);
  vi.spyOn(client.auth, "setSession").mockImplementation(async tokens => {
    now += 2 * 60 * 60_000;
    suspended = true;
    current = false;
    return install(tokens);
  });
  expect(await installRecoveredSession(a, () => current, captureRecoverySessionBaseline())).toBe(false);
  expect((await client.auth.getSession()).data.session).toBeNull();
  expect(request).not.toHaveBeenCalled();
  await client.auth.stopAutoRefresh();
});

it("preserves a same-user login completed after submission but before recovery installation starts", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://recovery-baseline-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_recovery_baseline");
  const initial = session("same-user", "initial"), recovered = session("same-user", "recovered"), concurrent = session("same-user", "concurrent");
  vi.stubGlobal("fetch", async () => Response.json(initial.user));
  const { ensureSupabaseBrowser, captureRecoverySessionBaseline, installRecoveredSession } = await import("@/lib/authClient");
  const client = await ensureSupabaseBrowser();
  if (!client) throw new Error("Missing fixture client");
  await client.auth.setSession(initial);
  const baseline = captureRecoverySessionBaseline();
  await client.auth.setSession(concurrent);
  expect(await installRecoveredSession(recovered, () => true, baseline)).toBe(false);
  expect((await client.auth.getSession()).data.session?.refresh_token).toBe(concurrent.refresh_token);
  await client.auth.stopAutoRefresh();
});
