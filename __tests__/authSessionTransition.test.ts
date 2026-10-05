// @vitest-environment jsdom
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createAuthSessionTransitionTracker } from "@/lib/authSessionTransition";

describe("auth session transition telemetry", () => {
  // The installed SDK, offline, with a synthetic session in its own storage.
  function sdkEvents(stored: boolean) {
    const base64Url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: "user-a", aud: "authenticated", role: "authenticated", email: "a@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z" };
    const session = {
      access_token: `${base64Url({ alg: "HS256" })}.${base64Url({ sub: "user-a", exp })}.${base64Url("signature")}`,
      refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: exp, user,
    };
    const items = new Map(stored ? [["transition", JSON.stringify(session)]] : []);
    const client = createClient("http://transition.invalid", "synthetic-key", {
      auth: {
        storageKey: "transition",
        storage: { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); }, removeItem: (key) => { items.delete(key); } },
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: async () => new Response(JSON.stringify(user), { headers: { "content-type": "application/json" } }) },
    });
    const events: Array<[string, string | null]> = [];
    client.auth.onAuthStateChange((event, next) => { events.push([event, next?.user.id ?? null]); });
    return { client, session, events };
  }

  it("does not read the SDK's cold-boot replay of a stored session as a sign-in", async () => {
    const { events } = sdkEvents(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events.map(([event]) => event).slice(0, 2)).toEqual(["SIGNED_IN", "INITIAL_SESSION"]);
    const tracker = createAuthSessionTransitionTracker();
    expect(events.map(([event, userId]) => tracker.update(event, userId))).not.toContain(true);
  });

  it("reads the SDK's SIGNED_IN after INITIAL_SESSION as a sign-in", async () => {
    const { client, session, events } = sdkEvents(false);
    await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events.map(([event]) => event)).toEqual(["INITIAL_SESSION", "SIGNED_IN"]);
    const tracker = createAuthSessionTransitionTracker();
    expect(events.map(([event, userId]) => tracker.update(event, userId))).toEqual([false, true]);
  });

  it("tracks only a SIGNED_IN transition from no session", () => {
    const tracker = createAuthSessionTransitionTracker();

    expect(tracker.update("INITIAL_SESSION", "user-a")).toBe(false);
    expect(tracker.update("SIGNED_IN", "user-a")).toBe(false);
    expect(tracker.update("TOKEN_REFRESHED", "user-a")).toBe(false);
    expect(tracker.update("SIGNED_OUT", null)).toBe(false);
    expect(tracker.update("SIGNED_IN", "user-a")).toBe(true);
    expect(tracker.update("SIGNED_IN", "user-a")).toBe(false);
  });

  it("seeds restored sessions without reporting a sign-in", () => {
    const tracker = createAuthSessionTransitionTracker();

    expect(tracker.update(null, "user-a")).toBe(false);
    expect(tracker.update("SIGNED_IN", "user-a")).toBe(false);
  });

  it("exposes the latest auth owner synchronously with each transition", () => {
    const tracker = createAuthSessionTransitionTracker();

    tracker.update("SIGNED_IN", "user-a");
    expect(tracker.currentUserId()).toBe("user-a");

    tracker.update("SIGNED_IN", "user-b");
    expect(tracker.currentUserId()).toBe("user-b");

    tracker.update("SIGNED_OUT", null);
    expect(tracker.currentUserId()).toBeNull();
  });
});
