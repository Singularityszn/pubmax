import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import {
  beginCoordinatedAuthAttempt, cancelAuthAttempt, releaseAuthAttempt,
  type AuthFragmentStorage,
} from "@/lib/authRedirect";
import { completeNativeIOSOAuth, type NativeIOSOAuthDeps } from "@/lib/nativeIOSOAuth";
import { createNativeAuthLifetime } from "@/lib/nativeAuthSession";

function storage(): AuthFragmentStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const oldSession = { user: { id: "original" }, access_token: "original-access", refresh_token: "original-refresh" } as Session;
const token = ["e30", Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "unsigned"].join(".");
const returnedSession = { user: { id: "new-account" }, access_token: token, refresh_token: "new-refresh" } as Session;

async function harness() {
  const persistentStorage = storage();
  const tabStorage = storage();
  const lockManager = { request: vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback()) } as unknown as LockManager;
  const ownership = { persistentStorage, tabStorage, lockManager };
  const attempt = await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map?area=soho#invite-secret", undefined, { ...ownership, cryptoProvider: crypto });
  if (!attempt.ok) throw new Error(attempt.message);
  let canonical = oldSession;
  const auth = {
    signInWithOAuth: vi.fn(async () => ({ data: { url: "https://provider.example/auth/v1/authorize" }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session: returnedSession }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: returnedSession.user }, error: null })),
    stopAutoRefresh: vi.fn(async () => {}),
  };
  const lifetime = createNativeAuthLifetime();
  const ticket = lifetime.begin();
  const install = vi.fn(async (session: Session) => ticket.install(async () => {
    canonical = session;
    return { data: { session, user: session.user }, error: null };
  }));
  const deps: NativeIOSOAuthDeps = {
    ownership, current: ticket.current, install,
    createClient: async () => ({ auth }) as unknown as Awaited<ReturnType<NonNullable<NativeIOSOAuthDeps["createClient"]>>>,
    authenticate: vi.fn(async () => ({ url: `pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=${attempt.id}#` })),
  };
  return { attempt, auth, deps, canonical: () => canonical, lifetime, install };
}

describe("an iPhone OAuth return", () => {
  it("exchanges on the starting client, verifies the user, and installs into the canonical session", async () => {
    const h = await harness();
    const result = await completeNativeIOSOAuth("google", h.attempt, h.deps);
    expect(result?.session.user.id).toBe("new-account");
    expect(result?.captured.cleanUrl).toBe("/map?area=soho#invite-secret");
    expect(h.auth.exchangeCodeForSession).toHaveBeenCalledWith("one-use-code");
    expect(h.auth.getUser).toHaveBeenCalledWith(token);
    expect(h.install).toHaveBeenCalledOnce();
    expect(h.canonical()).toBe(returnedSession);
    const start = h.auth.signInWithOAuth.mock.calls[0] as unknown as [{ options: { redirectTo: string; skipBrowserRedirect: boolean } }];
    expect(new URL(start[0].options.redirectTo).searchParams.get("native")).toBe("ios-pkce");
    expect(start[0].options.skipBrowserRedirect).toBe(true);
    expect(h.auth.stopAutoRefresh).toHaveBeenCalledOnce();
  });

  it.each([
    "pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=" + "b".repeat(32),
    "pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=ATTEMPT#access_token=secret",
    "pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=ATTEMPT&access_token=secret",
    "pubmaxx://auth/callback?code=one-use-code&_authAttempt=ATTEMPT",
    "https://pubmaxxing.com/auth/callback?code=one-use-code&_authAttempt=ATTEMPT",
    "pubmaxx://native-auth/callback?code=one-use-code&code=duplicate&_authAttempt=ATTEMPT",
  ])("rejects an invalid callback before any exchange: %s", async (url) => {
    const h = await harness();
    h.deps.authenticate = async () => ({ url: url.replace("ATTEMPT", h.attempt.id) });
    expect(await completeNativeIOSOAuth("google", h.attempt, h.deps)).toBeNull();
    expect(h.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(h.canonical()).toBe(oldSession);
  });

  it("rejects an unsolicited or cancelled callback without changing the original account", async () => {
    const h = await harness();
    cancelAuthAttempt(h.deps.ownership.persistentStorage, h.deps.ownership.tabStorage);
    expect(await completeNativeIOSOAuth("google", h.attempt, h.deps)).toBeNull();
    expect(h.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(h.canonical()).toBe(oldSession);
  });

  it("refuses an expired attempt through the existing coordinator", async () => {
    const h = await harness();
    h.deps.ownership.now = Date.now() + 3_600_001;
    expect(await completeNativeIOSOAuth("google", h.attempt, h.deps)).toBeNull();
    expect(h.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(h.install).not.toHaveBeenCalled();
  });

  it("rejects replayed callbacks through the existing attempt claim", async () => {
    const h = await harness();
    expect(await completeNativeIOSOAuth("google", h.attempt, h.deps)).not.toBeNull();
    expect(await completeNativeIOSOAuth("google", h.attempt, h.deps)).toBeNull();
    expect(h.install).toHaveBeenCalledOnce();
  });

  it("preserves the original account on user cancellation", async () => {
    const h = await harness();
    h.deps.authenticate = async () => { throw new Error("cancelled"); };
    expect(await completeNativeIOSOAuth("apple", h.attempt, h.deps)).toBeNull();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.canonical()).toBe(oldSession);
  });

  it("preserves the original account when exchange fails", async () => {
    const h = await harness();
    h.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: "expired" } } as never);
    expect(await completeNativeIOSOAuth("azure", h.attempt, h.deps)).toBeNull();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.canonical()).toBe(oldSession);
  });

  it("preserves the original account when the replacement token would trigger canonical refresh", async () => {
    const h = await harness();
    const expired = { ...returnedSession, access_token: "e30." + Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url") + ".unsigned" };
    h.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: expired }, error: null });
    expect(await completeNativeIOSOAuth("google", h.attempt, h.deps)).toBeNull();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.canonical()).toBe(oldSession);
  });

  it("refuses a verified banned account without clearing the current account", async () => {
    const h = await harness();
    h.auth.getUser.mockResolvedValue({ data: { user: { ...returnedSession.user, banned_until: "2099-01-01T00:00:00Z" } }, error: null } as never);
    expect(await completeNativeIOSOAuth("google", h.attempt, h.deps)).toBeNull();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.canonical()).toBe(oldSession);
  });

  it("refuses a session whose verified identity differs", async () => {
    const h = await harness();
    h.auth.getUser.mockResolvedValue({ data: { user: { id: "other" } }, error: null } as never);
    expect(await completeNativeIOSOAuth("google", h.attempt, h.deps)).toBeNull();
    expect(h.install).not.toHaveBeenCalled();
  });

  it.each(["sign-out", "account switch", "supersession"])("does not install a delayed result after %s", async () => {
    const h = await harness();
    const exchange = deferred<Awaited<ReturnType<typeof h.auth.exchangeCodeForSession>>>();
    h.auth.exchangeCodeForSession.mockReturnValue(exchange.promise);
    const run = completeNativeIOSOAuth("google", h.attempt, h.deps);
    await vi.waitFor(() => expect(h.auth.exchangeCodeForSession).toHaveBeenCalledOnce());
    await h.lifetime.invalidate();
    releaseAuthAttempt(h.attempt.id, h.deps.ownership.persistentStorage, h.deps.ownership.tabStorage);
    exchange.resolve({ data: { session: returnedSession }, error: null });
    expect(await run).toBeNull();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.canonical()).toBe(oldSession);
  });

  it("holds an account action until a started session installation settles", async () => {
    const h = await harness();
    const installation = deferred<string>();
    const ticket = h.lifetime.begin();
    const pending = ticket.install(() => installation.promise);
    let signOutFinished = false;
    const signOut = h.lifetime.invalidate().then(() => { signOutFinished = true; });
    await Promise.resolve();
    expect(signOutFinished).toBe(false);
    expect(ticket.current()).toBe(false);
    installation.resolve("installed");
    await pending;
    await signOut;
    expect(signOutFinished).toBe(true);
    expect(await ticket.install(async () => "late install")).toBeNull();
  });
});
