// @vitest-environment jsdom
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapAuthSession } from "@/lib/authSessionBootstrap";
import { clearPersistedSession, persistSessionForResume } from "@/lib/authSessionResumeClient";

// The installed Supabase client, the boot resolver and the durable resume
// client run for real. The /auth/v1 provider and the /api/auth/session cookie
// endpoint are explicit in-memory doubles holding synthetic tokens; "offline"
// makes both reject. This proves the device-side restore decision, not real
// GoTrue revocation or a real HttpOnly cookie.

type Account = { id: string; email: string };
const A: Account = { id: "account-a", email: "a@example.com" };
const B: Account = { id: "account-b", email: "b@example.com" };
const SDK_STORAGE_KEY = "pubmax-resume-journey-auth-token";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function accessTokenFor(account: Account): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ sub: account.id, exp, role: "authenticated" })}.${base64Url("synthetic-signature")}`;
}

function userFor(account: Account) {
  return {
    id: account.id, aud: "authenticated", role: "authenticated", email: account.email,
    app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z",
  };
}

function sessionFor(account: Account) {
  return {
    access_token: accessTokenFor(account), refresh_token: `synthetic-refresh-${account.id}`,
    token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: userFor(account),
  };
}

let online: boolean;
let deleteStatus: number;
let cookie: Account | null;
let sdkItems: Map<string, string>;
let cookieRequests: string[];
let heldPersist: (() => void) | null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function cookieEndpoint(init: RequestInit = {}): Promise<Response> {
  if (!online) throw new TypeError("Failed to fetch");
  const method = init.method ?? "GET";
  if (method === "GET") {
    cookieRequests.push("hint");
    return json({ hint: cookie ? { maskedEmail: "a***@example.com" } : null });
  }
  if (method === "DELETE") {
    cookieRequests.push(`delete:${deleteStatus}`);
    if (deleteStatus !== 200) return json({ error: "synthetic outage" }, deleteStatus);
    cookie = null;
    return json({ ok: true });
  }
  const body = JSON.parse(String(init.body)) as { action: string; refreshToken?: string };
  cookieRequests.push(body.action);
  if (body.action === "redeem") {
    return cookie ? json({ status: "restored", session: sessionFor(cookie) }) : json({ status: "none" });
  }
  const owner = [A, B].find((account) => body.refreshToken === `synthetic-refresh-${account.id}`) ?? null;
  if (heldPersist === null) {
    cookie = owner;
    return json({ ok: true });
  }
  return new Promise<Response>((resolve) => {
    heldPersist = () => {
      cookie = owner;
      resolve(json({ ok: true }));
    };
  });
}

function makeClient() {
  return createClient("http://auth-journey.invalid", "synthetic-public-key", {
    auth: {
      storageKey: SDK_STORAGE_KEY,
      storage: {
        getItem: (key) => sdkItems.get(key) ?? null,
        setItem: (key, value) => { sdkItems.set(key, value); },
        removeItem: (key) => { sdkItems.delete(key); },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!online) throw new TypeError("Failed to fetch");
        if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
        if (url.includes("/auth/v1/user")) return json(userFor(cookie ?? A));
        throw new Error(`Unexpected synthetic provider request: ${url}`);
      },
    },
  });
}

function signedInAs(account: Account) {
  sdkItems.set(SDK_STORAGE_KEY, JSON.stringify(sessionFor(account)));
  cookie = account;
  return makeClient();
}

/** The two device steps AuthProvider.signOut awaits, in its order. */
async function explicitSignOut(client: ReturnType<typeof makeClient>) {
  const result = await client.auth.signOut();
  await clearPersistedSession();
  return result;
}

async function reload() {
  const client = makeClient();
  const outcome = await bootstrapAuthSession(client.auth);
  return { client, outcome };
}

beforeEach(() => {
  localStorage.clear();
  online = true;
  deleteStatus = 200;
  cookie = null;
  sdkItems = new Map();
  cookieRequests = [];
  heldPersist = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/auth/session") return cookieEndpoint(init);
    throw new Error(`Unexpected synthetic request: ${String(input)}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("explicit sign-out against the durable resume cookie", () => {
  it.each([
    ["the device is offline", () => { online = false; }],
    ["the cookie endpoint answers 503", () => { deleteStatus = 503; }],
  ])("does not restore the departed account after reconnecting when %s at sign-out", async (_label, fail) => {
    const client = signedInAs(A);
    fail();
    await explicitSignOut(client);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(cookie).toEqual(A);

    online = true;
    deleteStatus = 200;
    const { client: reloaded, outcome } = await reload();
    expect(outcome.status).toBe("none");
    expect((await reloaded.auth.getSession()).data.session).toBeNull();
    expect(cookie).toBeNull();
    expect(cookieRequests).not.toContain("redeem");
  });

  it("stays signed out across an offline reload, then clears the cookie once reconnected", async () => {
    const client = signedInAs(A);
    online = false;
    await explicitSignOut(client);
    const offline = await reload();
    expect(offline.outcome.status).toBe("none");
    online = true;
    const { outcome } = await reload();
    expect(outcome.status).toBe("none");
    expect(cookie).toBeNull();
    const after = await reload();
    expect(after.outcome.status).toBe("none");
    expect(cookieRequests.filter((request) => request === "redeem")).toEqual([]);
    expect(cookieRequests.at(-1)).toBe("hint");
  });

  it("does not let a persist that was in flight at sign-out bring the departed account back", async () => {
    const client = signedInAs(A);
    heldPersist = () => {};
    const stalePersist = persistSessionForResume(sessionFor(A));
    await vi.waitFor(() => expect(cookieRequests).toContain("persist"));
    await explicitSignOut(client);
    expect(cookie).toBeNull();
    heldPersist();
    await stalePersist;
    expect(cookie).toEqual(A);

    const { outcome } = await reload();
    expect(outcome.status).toBe("none");
    expect(cookie).toBeNull();
  });

  it("keeps durable resume for an intentional new sign-in after a failed clear", async () => {
    const client = signedInAs(A);
    online = false;
    await explicitSignOut(client);
    online = true;
    expect(await persistSessionForResume(sessionFor(B))).toBe("stored");
    expect(cookie).toEqual(B);

    const { outcome } = await reload();
    expect(outcome).toMatchObject({ status: "restored", session: { refresh_token: `synthetic-refresh-${B.id}` } });
  });

  it("still restores an account whose local session was evicted without a sign-out", async () => {
    signedInAs(A);
    sdkItems.clear();
    const { client, outcome } = await reload();
    expect(outcome).toMatchObject({ status: "restored", session: { refresh_token: `synthetic-refresh-${A.id}` } });
    expect((await client.auth.getSession()).data.session?.user.id).toBe(A.id);
  });

  it("clears the cookie and resumes nothing when the sign-out DELETE succeeds", async () => {
    const client = signedInAs(A);
    await explicitSignOut(client);
    expect(cookie).toBeNull();
    const { outcome } = await reload();
    expect(outcome.status).toBe("none");
  });

  it("still sends the DELETE when the device cannot record the pending clear", async () => {
    const client = signedInAs(A);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    await explicitSignOut(client);
    expect(cookieRequests).toContain("delete:200");
    expect(cookie).toBeNull();
  });
});
