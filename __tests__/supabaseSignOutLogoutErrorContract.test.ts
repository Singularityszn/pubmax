// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

// The installed Supabase client runs for real against isolated in-memory
// storage, synthetic tokens and a controlled transport. No provider is
// contacted. This pins what AuthProvider.signOut may infer from a logout error.

const STORAGE_KEY = "pubmax-sdk-contract-auth-token";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function syntheticSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: "account-a", aud: "authenticated", role: "authenticated", email: "a@example.com",
    app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z",
  };
  return {
    access_token: `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ sub: user.id, exp: expiresAt, role: "authenticated" })}.synthetic`,
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  };
}

function harness(logout: () => Promise<Response>) {
  const items = new Map<string, string>([[STORAGE_KEY, JSON.stringify(syntheticSession())]]);
  const requests: string[] = [];
  const client = createClient("http://auth-contract.invalid", "synthetic-public-key", {
    auth: {
      storageKey: STORAGE_KEY,
      storage: {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => { items.set(key, value); },
        removeItem: (key) => { items.delete(key); },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        requests.push(new URL(url).pathname);
        if (url.includes("/auth/v1/logout")) return logout();
        throw new Error(`Unexpected synthetic request: ${url}`);
      },
    },
  });
  const events: string[] = [];
  client.auth.onAuthStateChange((event) => { events.push(event); });
  return { client, items, requests, events };
}

describe("installed Supabase signOut on a failed logout request", () => {
  it.each([
    ["a network failure", async () => { throw new TypeError("Failed to fetch"); }],
    ["a 503 response", async () => new Response(JSON.stringify({ code: 503, msg: "unavailable" }), {
      status: 503, headers: { "content-type": "application/json" },
    })],
  ])("removes the local session and emits SIGNED_OUT before returning the error for %s", async (_label, logout) => {
    const { client, items, requests, events } = harness(logout);
    expect((await client.auth.getSession()).data.session?.user.id).toBe("account-a");

    const result = await client.auth.signOut();

    expect(requests).toEqual(["/auth/v1/logout"]);
    expect(result.error).not.toBeNull();
    expect(events).toContain("SIGNED_OUT");
    expect(items.has(STORAGE_KEY)).toBe(false);
    expect((await client.auth.getSession()).data.session).toBeNull();
  });
});
