// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

type Frame = [string | null, string | null, string, string, Record<string, unknown>];

// All auth and transport data in this proof is synthetic. The SDK, browser
// client factory and subscription helper are real. No request leaves this test.
function token(role: string, revision: number): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: "fixture-account", role, revision, exp: Math.floor(Date.now() / 1000) + 3600,
  })}.fixture-signature`;
}

function controlledTransport(anonymousToken: string) {
  const frames: Frame[] = [];
  const sockets: ControlledSocket[] = [];
  let authorizedToken: string | null = null;
  let refused = 0;
  let holdLeaves = false;
  const leaveReplies: Array<() => void> = [];

  class ControlledSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    binaryType = "arraybuffer";
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    active = new Map<string, { joinRef: string | null; token: unknown }>();

    constructor() {
      sockets.push(this);
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
    }

    addEventListener() {}
    removeEventListener() {}

    receive(frame: Frame) {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }

    send(raw: string) {
      const frame = JSON.parse(raw) as Frame;
      frames.push(frame);
      const [joinRef, ref, topic, event, payload] = frame;
      queueMicrotask(() => {
        if (event === "phx_join") {
          const allowed = payload.access_token === authorizedToken && authorizedToken !== null;
          if (allowed) this.active.set(topic, { joinRef, token: payload.access_token });
          else refused += 1;
          this.receive([joinRef, ref, topic, "phx_reply", allowed
            ? { status: "ok", response: {} }
            : { status: "error", response: { reason: "Unauthorized" } }]);
        } else if (event === "access_token") {
          const active = this.active.get(topic);
          if (active) active.token = payload.access_token;
          if (payload.access_token === anonymousToken) {
            this.active.delete(topic);
            if (!holdLeaves) this.receive([joinRef, null, topic, "phx_error", {}]);
          }
        } else if (event === "phx_leave") {
          this.active.delete(topic);
          const reply = () => this.receive([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]);
          if (holdLeaves) leaveReplies.push(reply);
          else reply();
        } else if (event === "heartbeat") {
          this.receive([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]);
        }
      });
    }

    close() { this.readyState = 3; this.onclose?.(); }
  }

  return {
    Socket: ControlledSocket,
    frames,
    authorize(value: string | null) { authorizedToken = value; },
    refusals: () => refused,
    holdLeaves() { holdLeaves = true; },
    finishLeaves() { holdLeaves = false; leaveReplies.splice(0).forEach((reply) => reply()); },
    signal(event = "drop") {
      for (const socket of sockets) {
        for (const [topic, active] of socket.active) {
          if (active.token === authorizedToken && authorizedToken !== null) {
            socket.receive([active.joinRef, null, topic, "broadcast", {
              event, payload: { ignored: "content-must-not-cross" },
            }]);
          }
        }
      }
    },
  };
}

let client: SupabaseClient | null = null;
let unsubscribe: (() => void) | undefined;
let fixtureNumber = 0;

async function prepare() {
  vi.useFakeTimers();
  const anonymous = token("anon", 0);
  const signedIn = token("authenticated", 1);
  const refreshed = token("authenticated", 2);
  const transport = controlledTransport(anonymous);
  const origin = `https://realtime-fixture-${++fixtureNumber}.invalid`;
  vi.stubGlobal("WebSocket", transport.Socket);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", anonymous);
  const user = { id: "fixture-account", aud: "authenticated", role: "authenticated", created_at: "2026-01-01T00:00:00Z" };
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.origin !== origin) throw new Error("Unexpected network request");
    if (url.pathname === "/auth/v1/token") {
      const access = url.searchParams.get("grant_type") === "refresh_token" ? refreshed : signedIn;
      transport.authorize(access);
      return Response.json({ access_token: access, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, user });
    }
    if (url.pathname === "/auth/v1/logout") {
      transport.authorize(null);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected auth path: ${url.pathname}`);
  }));
  const auth = await import("@/lib/authClient");
  client = await auth.ensureSupabaseBrowser();
  expect(client).not.toBeNull();
  return { anonymous, signedIn, refreshed, transport, requests };
}

afterEach(async () => {
  unsubscribe?.();
  unsubscribe = undefined;
  if (client) {
    await client.removeAllChannels();
    client.auth.stopAutoRefresh();
    await client.realtime.disconnect();
  }
  client = null;
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Realtime auth lifecycle through the browser client and SDK", () => {
  it("polls without an anonymous join, recovers on sign-in, refreshes tokens, and retires delivery after sign-out", async () => {
    const { signedIn, refreshed, transport, requests } = await prepare();
    const live = await import("@/lib/realtime");
    const nudge = vi.fn();
    const poll = vi.fn();
    unsubscribe = live.subscribeToNewDrops(nudge, { poll });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(nudge).not.toHaveBeenCalled();
    expect(transport.refusals()).toBe(0);
    expect((await client!.auth.signInWithPassword({ email: "fixture@example.invalid", password: "fixture-password" })).error).toBeNull();
    await vi.waitFor(() => expect(transport.frames.some((frame) => frame[3] === "phx_join" && frame[4].access_token === signedIn)).toBe(true));
    transport.signal();
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(nudge.mock.calls[0]).toEqual([]);

    expect((await client!.auth.refreshSession()).error).toBeNull();
    await vi.waitFor(() => expect(transport.frames.some((frame) => frame[3] === "access_token" && frame[4].access_token === refreshed)).toBe(true));
    transport.signal();
    expect(nudge).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(1);

    expect((await client!.auth.signOut()).error).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.frames.some((frame) => frame[3] === "phx_leave")).toBe(true);
    transport.signal();
    expect(nudge).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(transport.refusals()).toBe(0);
    expect(requests).toEqual(["/auth/v1/token", "/auth/v1/token", "/auth/v1/logout"]);
  });

  it.each(["thread", "inbox"] as const)("keeps an authenticated %s live across token refresh and polls after sign-out", async (surface) => {
    const { anonymous, signedIn, refreshed, transport } = await prepare();
    const live = await import("@/lib/messagesRealtime");
    expect((await client!.auth.signInWithPassword({ email: "fixture@example.invalid", password: "fixture-password" })).error).toBeNull();
    const nudge = vi.fn();
    const poll = vi.fn();
    const onStatus = vi.fn();
    unsubscribe = surface === "thread"
      ? live.subscribeToMessages("fixture-thread", nudge, { poll, onStatus })
      : live.subscribeToInbox("fixture-handle", nudge, { poll, onStatus });
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("live"));
    expect(transport.frames.some((frame) => frame[3] === "phx_join" && frame[4].access_token === signedIn)).toBe(true);
    transport.signal("message");
    expect(nudge.mock.calls).toEqual([[]]);

    expect((await client!.auth.refreshSession()).error).toBeNull();
    await vi.waitFor(() => expect(transport.frames.some((frame) => frame[3] === "access_token" && frame[4].access_token === refreshed)).toBe(true));
    transport.signal("message");
    expect(nudge.mock.calls).toEqual([[], []]);

    expect((await client!.auth.signOut()).error).toBeNull();
    await vi.waitFor(() => expect(transport.frames.some((frame) => frame[3] === "access_token" && frame[4].access_token === anonymous)).toBe(true));
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("polling"));
    transport.signal("message");
    expect(nudge).toHaveBeenCalledTimes(2);
    // The caller normally unmounts this surface on sign-out. An unmounted
    // caller must also cancel the bounded retry and every fallback poll.
    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.refusals()).toBe(0);
    expect(poll).not.toHaveBeenCalled();
  });

  it("recovers when a Pint Drop mount overlaps sign-in before a session exists", async () => {
    const { signedIn, transport } = await prepare();
    const live = await import("@/lib/realtime");
    const signingIn = client!.auth.signInWithPassword({ email: "fixture@example.invalid", password: "fixture-password" });
    const nudge = vi.fn();
    const poll = vi.fn();
    unsubscribe = live.subscribeToNewDrops(nudge, { poll });
    expect((await signingIn).error).toBeNull();
    await vi.waitFor(() => expect(transport.frames.some((frame) => frame[3] === "phx_join" && frame[4].access_token === signedIn)).toBe(true));
    transport.signal();
    expect(poll).not.toHaveBeenCalled();
    expect(nudge.mock.calls).toEqual([[]]);
    expect(transport.refusals()).toBe(0);
  });

  it("recovers a new sign-in while the old channel is still leaving", async () => {
    const { transport } = await prepare();
    const live = await import("@/lib/realtime");
    const signIn = () => client!.auth.signInWithPassword({ email: "fixture@example.invalid", password: "fixture-password" });
    expect((await signIn()).error).toBeNull();
    const nudge = vi.fn();
    unsubscribe = live.subscribeToNewDrops(nudge, { poll: vi.fn() });
    await vi.waitFor(() => expect(transport.frames.filter((frame) => frame[3] === "phx_join")).toHaveLength(1));
    transport.holdLeaves();
    expect((await client!.auth.signOut()).error).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect((await signIn()).error).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    transport.finishLeaves();
    await vi.waitFor(() => expect(transport.frames.filter((frame) => frame[3] === "phx_join")).toHaveLength(2));
    transport.signal();
    expect(nudge.mock.calls).toEqual([[]]);
    expect(transport.refusals()).toBe(0);
  });

  it("keeps the poll fallback after an authenticated refusal without retrying on token refresh", async () => {
    const { transport } = await prepare();
    const live = await import("@/lib/realtime");
    expect((await client!.auth.signInWithPassword({ email: "fixture@example.invalid", password: "fixture-password" })).error).toBeNull();
    transport.authorize(null);
    const poll = vi.fn();
    unsubscribe = live.subscribeToNewDrops(vi.fn(), { poll });
    await vi.waitFor(() => expect(transport.refusals()).toBe(1));
    expect((await client!.auth.refreshSession()).error).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(transport.frames.filter((frame) => frame[3] === "phx_join")).toHaveLength(1);
    expect(transport.refusals()).toBe(1);
  });
});
