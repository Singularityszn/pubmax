import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { beginCoordinatedAuthAttempt, cancelAuthAttempt, type AuthFragmentStorage } from "@/lib/authRedirect";
import { GET } from "@/app/auth/callback/route";
import { completeNativeEmailLink, prepareNativeEmailReceipt, requestNativeEmailLink } from "@/lib/nativeEmailAuth";
import { createEmailPkce, NATIVE_EMAIL_RECEIPT_KEY, readNativeEmailReceipt } from "@/lib/nativeEmailPkce";
import { nativeDeepLinkPath } from "@/lib/nativeDeepLinks";

function storage() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const adapter: AuthFragmentStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes.push(value); values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  return { adapter, writes, values };
}
const config = { url: "https://native-email-test.supabase.co", key: "sb_publishable_offline_fixture" };
const token = ["e30", Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "unsigned"].join(".");
const session = { access_token: token, refresh_token: "native-refresh-never-persisted", user: { id: "email-account", email: "native@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" } } as Session;
async function harness(email: string | null = "native@example.test", now = Date.now()) {
  const persistent = storage(); const tab = storage();
  const lockManager = { request: async (_name: string, callback: () => Promise<unknown>) => callback() } as unknown as LockManager;
  const ownership = { persistentStorage: persistent.adapter, tabStorage: tab.adapter, lockManager };
  const attempt = await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map#return-fragment", undefined, { ...ownership, cryptoProvider: crypto, now });
  if (!attempt.ok) throw new Error(attempt.message);
  const prepared = await prepareNativeEmailReceipt(attempt, email, persistent.adapter, now, () => true, config);
  if (prepared.status !== "prepared") throw new Error("receipt failed");
  const callback = new URL(prepared.receipt.callbackUrl); callback.searchParams.set("code", "email-code");
  const raw = (await GET(new Request(callback))).headers.get("location")!;
  let user: Record<string, unknown> = { ...session.user };
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/token") {
      expect(url.searchParams.get("grant_type")).toBe("pkce");
      const body = JSON.parse(String(init?.body));
      expect(body.auth_code).toBe("email-code");
      expect(createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(prepared.challenge);
      return Response.json(session);
    }
    if (url.pathname === "/auth/v1/user") return Response.json(user);
    return Response.json({});
  });
  const install = vi.fn(async (value: Session) => ({ data: { session: value }, error: null }));
  const deps = { storage: persistent.adapter, origin: "https://pubmaxxing.com", ownership, config, current: () => true, fetchImpl: request, install };
  return { attempt, prepared, raw, request, install, deps, persistent, tab, user: (value: Record<string, unknown>) => { user = value; } };
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", config.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", config.key);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("native email PKCE transport and receipt", () => {
  it("uses standard S256 with a verifier that never enters the redirect", async () => {
    const h = await harness();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/auth/v1/otp");
      expect(url.searchParams.get("redirect_to")).toBe(h.prepared.receipt.callbackUrl);
      expect(url.toString()).not.toContain(h.prepared.receipt.verifier);
      expect(JSON.parse(String(init?.body))).toEqual({ email: "native@example.test", create_user: true, code_challenge: h.prepared.challenge, code_challenge_method: "s256" });
      expect(init?.credentials).toBe("omit"); expect(init?.redirect).toBe("error");
      return Response.json({});
    });
    expect((await requestNativeEmailLink(" Native@Example.Test ", h.prepared.receipt, h.prepared.challenge, config, request)).status).toBe("sent");
  });

  it("exchanges and verifies without persisting session credentials", async () => {
    const h = await harness();
    const result = await completeNativeEmailLink(h.raw, h.deps);
    expect(result.status).toBe("established");
    if (result.status === "established") expect(result.captured.cleanUrl).toBe("/map#return-fragment");
    expect(h.install).toHaveBeenCalledOnce();
    expect(h.persistent.adapter.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
    for (const value of h.persistent.writes) { expect(value).not.toContain(token); expect(value).not.toContain(session.refresh_token); }
    expect(nativeDeepLinkPath(h.raw)).toBeNull();
  });

  it.each([
    "pubmaxx://native-email/callback?code=email-code&_authAttempt=" + "b".repeat(32),
    "pubmaxx://native-email/callback?code=email-code&_authAttempt=ATTEMPT#access_token=secret",
    "pubmaxx://native-email/callback?code=email-code&_authAttempt=ATTEMPT&refresh_token=secret",
    "pubmaxx://native-email/callback?code=email-code&code=duplicate&_authAttempt=ATTEMPT",
    "pubmaxx://native-email/callback?code=email-code&_authAttempt=ATTEMPT&_authAttempt=ATTEMPT",
    "pubmaxx://user@native-email/callback?code=email-code&_authAttempt=ATTEMPT",
    "pubmaxx://native-email:44/callback?code=email-code&_authAttempt=ATTEMPT",
    "pubmaxx://native-email/%63allback?code=email-code&_authAttempt=ATTEMPT",
    "https://pubmaxxing.com/auth/callback?code=email-code&_authAttempt=ATTEMPT",
  ])("ignores unowned or malformed callback %s", async (raw) => {
    const h = await harness();
    expect((await completeNativeEmailLink(raw.replaceAll("ATTEMPT", h.attempt.id), h.deps)).status).toBe("ignored");
    expect(h.request).not.toHaveBeenCalled(); expect(h.install).not.toHaveBeenCalled();
  });

  it("rejects replay and removes the receipt before exchange", async () => {
    const h = await harness();
    expect((await completeNativeEmailLink(h.raw, h.deps)).status).toBe("established");
    expect((await completeNativeEmailLink(h.raw, h.deps)).status).toBe("ignored");
    expect(h.install).toHaveBeenCalledOnce();
  });

  it("refuses a cancelled coordinator claim even when a receipt remains", async () => {
    const h = await harness();
    cancelAuthAttempt(h.persistent.adapter, h.tab.adapter);
    expect((await completeNativeEmailLink(h.raw, h.deps)).status).toBe("ignored");
    expect(h.request).not.toHaveBeenCalled();
  });

  it("expires and erases its bounded verifier receipt", async () => {
    const h = await harness("native@example.test", Date.now() - 3_600_001);
    expect((await completeNativeEmailLink(h.raw, h.deps)).status).toBe("ignored");
    expect(h.request).not.toHaveBeenCalled();
    expect(h.persistent.adapter.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
  });

  it.each([
    { ...session.user, email: "other@example.test" },
    { ...session.user, id: "other-account" },
    { ...session.user, email_confirmed_at: undefined },
    { ...session.user, banned_until: "2099-01-01T00:00:00Z" },
  ])("refuses a mismatched, unconfirmed or banned remote email identity", async (user) => {
    const h = await harness(); h.user(user);
    expect((await completeNativeEmailLink(h.raw, h.deps)).status).toBe("failed");
    expect(h.install).not.toHaveBeenCalled();
    expect(h.persistent.adapter.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
  });

  it("requires email confirmation for cookie resume as well", async () => {
    const h = await harness(null); h.user({ ...session.user, email_confirmed_at: undefined });
    expect((await completeNativeEmailLink(h.raw, h.deps)).status).toBe("failed");
    expect(h.install).not.toHaveBeenCalled();
  });

  it("does not create a receipt when durable storage refuses writes", async () => {
    const h = await harness();
    expect(await prepareNativeEmailReceipt(h.attempt, "native@example.test", { getItem: () => null, setItem: () => { throw new Error("storage disabled"); }, removeItem: () => {} }, Date.now(), () => true, config)).toEqual({ status: "storage" });
  });

  it("does not overwrite a newer receipt when an earlier crypto preparation finishes late", async () => {
    const h = await harness();
    let finish!: (digest: ArrayBuffer) => void;
    const delayed = new Promise<ArrayBuffer>((resolve) => { finish = resolve; });
    vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(delayed);
    let current = true;
    const earlier = prepareNativeEmailReceipt(h.attempt, "native@example.test", h.persistent.adapter, Date.now(), () => current, config);
    current = false;
    const newerAttempt = { ...h.attempt, id: "c".repeat(32), callbackUrl: h.attempt.callbackUrl.replace(h.attempt.id, "c".repeat(32)) };
    const newer = await prepareNativeEmailReceipt(newerAttempt, "native@example.test", h.persistent.adapter, Date.now(), () => true, config);
    expect(newer.status).toBe("prepared");
    finish(new ArrayBuffer(32));
    expect(await earlier).toEqual({ status: "obsolete" });
    expect(readNativeEmailReceipt(h.persistent.adapter, h.deps.origin)?.id).toBe(newerAttempt.id);
  });

  it("generates the RFC 7636 verifier-to-challenge relationship", async () => {
    const pkce = await createEmailPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(createHash("sha256").update(pkce.verifier).digest("base64url")).toBe(pkce.challenge);
  });
  it("keeps account-sensitive send refusals neutral through the existing normalizer", async () => {
    const h = await harness();
    const request = vi.fn(async () => Response.json({ code: "email_exists", msg: "already registered" }, { status: 400 }));
    expect((await requestNativeEmailLink("native@example.test", h.prepared.receipt, h.prepared.challenge, config, request)).status).toBe("sent");
  });

  it("does not install an expired code response or retain its verifier", async () => {
    const h = await harness();
    h.request.mockResolvedValueOnce(Response.json({ code: "flow_state_expired" }, { status: 400 }));
    expect((await completeNativeEmailLink(h.raw, h.deps)).status).toBe("failed");
    expect(h.install).not.toHaveBeenCalled();
    expect(h.persistent.adapter.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
  });

  it("consumes an owned failed relay without forwarding provider errors", async () => {
    const h = await harness();
    const callback = new URL(h.prepared.receipt.callbackUrl);
    callback.searchParams.set("error", "access_denied");
    const response = await GET(new Request(callback));
    const raw = response.headers.get("location")!;
    expect(raw).toBe("pubmaxx://native-email/callback?_authAttempt=" + h.attempt.id + "#");
    expect((await completeNativeEmailLink(raw, h.deps)).status).toBe("failed");
    expect(h.request).not.toHaveBeenCalled();
    expect(h.install).not.toHaveBeenCalled();
  });

  it("refuses cross-origin or token-bearing direct HTTPS callbacks", async () => {
    const h = await harness();
    for (const raw of [
      "https://evil.example/auth/callback?native=ios-email-pkce&code=email-code&_authAttempt=" + h.attempt.id,
      "https://pubmaxxing.com/auth/callback?native=ios-email-pkce&code=email-code&_authAttempt=" + h.attempt.id + "&access_token=private",
      "https://pubmaxxing.com/auth/callback?native=ios-email-pkce&code=email-code&_authAttempt=" + h.attempt.id + "#refresh_token=private",
      "https://pubmaxxing.com/auth/callback?native=ios-email-pkce&native=ios-email-pkce&code=email-code&_authAttempt=" + h.attempt.id,
    ]) expect((await completeNativeEmailLink(raw, h.deps)).status).toBe("ignored");
    expect(h.request).not.toHaveBeenCalled();
  });
  it("claims a direct GoTrue terminal error without exchanging or retaining its text", async () => {
    const h = await harness();
    const incoming = new URL(h.prepared.receipt.callbackUrl);
    const error = new URLSearchParams({ error: "access_denied", error_code: "otp_expired", error_description: "private provider prose" });
    for (const [key, value] of error) incoming.searchParams.set(key, value);
    incoming.hash = new URLSearchParams([...error, ["sb", ""]]).toString();
    const result = await completeNativeEmailLink(incoming.toString(), h.deps);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("private provider prose");
    expect(h.request).not.toHaveBeenCalled(); expect(h.install).not.toHaveBeenCalled();
    expect(h.persistent.adapter.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
  });
  it("leaves the pending receipt intact for unowned or malformed HTTPS errors", async () => {
    const h = await harness();
    const incoming = new URL(h.prepared.receipt.callbackUrl);
    incoming.searchParams.set("error", "access_denied"); incoming.searchParams.set("error_code", "otp_expired");
    for (const mutate of [
      (url: URL) => { url.hostname = "evil.example"; },
      (url: URL) => { url.searchParams.set("_authAttempt", "d".repeat(32)); },
      (url: URL) => { url.hash = "access_token=private"; },
      (url: URL) => { url.searchParams.set("refresh_token", "private"); },
      (url: URL) => { url.searchParams.set("code", "email-code"); },
      (url: URL) => { url.hash = "error_code=other_error&sb="; },
      (url: URL) => { url.hash = "error_code=otp_expired&error_code=otp_expired&sb="; },
      (url: URL) => { url.protocol = "pubmaxx:"; url.hostname = "native-email"; url.pathname = "/callback"; },
    ]) {
      const raw = new URL(incoming); mutate(raw);
      expect((await completeNativeEmailLink(raw.toString(), h.deps)).status).toBe("ignored");
      expect(h.persistent.adapter.getItem(NATIVE_EMAIL_RECEIPT_KEY)).not.toBeNull();
    }
    expect(h.request).not.toHaveBeenCalled(); expect(h.install).not.toHaveBeenCalled();
  });
});

// An open chunked body, as a route handler answers: only cancel can end it.
function openBody(status: number) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
    cancel() { cancelled = true; },
  });
  return { response: new Response(body, { status }), cancelled: () => cancelled };
}

describe("native email responses it decides not to read", () => {
  it("releases the OTP success body without changing the sent outcome", async () => {
    const h = await harness();
    const otp = openBody(200);
    const request = vi.fn(async () => otp.response);
    expect((await requestNativeEmailLink("native@example.test", h.prepared.receipt, h.prepared.challenge, config, request)).status).toBe("sent");
    await vi.waitFor(() => expect(otp.cancelled()).toBe(true), { timeout: 1000 });
  });

  it("still reads an OTP refusal body for its outcome", async () => {
    const h = await harness();
    const refusal = Response.json({ error_code: "over_email_send_rate_limit" }, { status: 429 });
    const result = await requestNativeEmailLink("native@example.test", h.prepared.receipt, h.prepared.challenge, config, vi.fn(async () => refusal));
    expect(result.status).toBe("rate_limited");
    expect(refusal.bodyUsed).toBe(true);
  });

  it.each([
    ["token", "refusal"], ["token", "ownership loss"], ["user", "refusal"], ["user", "ownership loss"],
  ] as const)("releases the unread %s body on %s without installing", async (stage, exit) => {
    const h = await harness();
    const unread = openBody(exit === "refusal" ? 400 : 200);
    let current = true;
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === `/auth/v1/${stage}`) {
        if (exit === "ownership loss") current = false;
        return unread.response;
      }
      if (path === "/auth/v1/token") return Response.json(session);
      return Response.json(session.user);
    });
    const result = await completeNativeEmailLink(h.raw, { ...h.deps, fetchImpl: request, current: () => current });
    expect(result.status).toBe("failed");
    expect(h.install).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(stage === "token" ? 1 : 2);
    expect(h.persistent.adapter.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
    await vi.waitFor(() => expect(unread.cancelled()).toBe(true), { timeout: 1000 });
  });
});
