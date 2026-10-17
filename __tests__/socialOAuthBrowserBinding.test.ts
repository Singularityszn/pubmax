import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// An OAuth state is bound to the BROWSER that started the flow, not only to the
// account stored beside it on the server.
//
// Without that binding, an attacker starts a connection on their own account,
// stops at the provider's redirect, and sends the callback link to a victim:
// the victim's browser finishes the flow and links the VICTIM's provider
// account to the attacker's profile. Every provider is manual-only today, so
// this certifies X for the length of each case to exercise the latent path.

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

import { POST as connect } from "@/app/api/social-connections/[provider]/route";
import { GET as oauthCallback } from "@/app/api/social-connections/[provider]/callback/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemorySocialConnections, socialConnectionStore } from "@/lib/socialConnectionStore";
import { createSocialOAuthStart, readSocialOAuthState } from "@/lib/socialOAuth";
import { SOCIAL_PROVIDER_CAPABILITIES } from "@/lib/socialProviderCapabilities";

const xParams = { params: Promise.resolve({ provider: "x" }) };

beforeEach(() => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  authState.userId = null;
  __resetMemorySocialConnections();
  __resetPintDrops();
  SOCIAL_PROVIDER_CAPABILITIES.x.oauth_identity = true;
  vi.stubEnv("X_CLIENT_ID", "client-id");
  vi.stubEnv("X_CLIENT_SECRET", "client-secret");
  vi.stubEnv("SOCIAL_CONNECTION_ENCRYPTION_KEY", "k".repeat(32));
});

afterEach(() => {
  SOCIAL_PROVIDER_CAPABILITIES.x.oauth_identity = false;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the OAuth state store", () => {
  it("answers a state only to the browser nonce it was started with", async () => {
    const start = (await createSocialOAuthStart({
      ownerId: "attacker",
      provider: "x",
      origin: "http://localhost",
    })) as { authorizeUrl: string; browserNonce?: string };
    const state = new URL(start.authorizeUrl).searchParams.get("state")!;
    expect(start.browserNonce).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    // A victim's browser holds no nonce, or somebody else's.
    await expect(readSocialOAuthState(state, "x", null)).rejects.toThrow(
      "Expired or mismatched OAuth state",
    );
    await expect(readSocialOAuthState(state, "x", "someone-elses-nonce-value")).rejects.toThrow(
      "Expired or mismatched OAuth state",
    );
    // A refused attempt does not burn the starter's own state.
    await expect(readSocialOAuthState(state, "x", start.browserNonce!)).resolves.toMatchObject({
      ownerId: "attacker",
    });
  });
});

describe("the start and callback routes", () => {
  async function startAsAttacker(): Promise<{ state: string; cookie: string; setCookie: string }> {
    authState.userId = "attacker";
    const response = await connect(
      new Request("http://localhost/api/social-connections/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "oauth" }),
      }),
      xParams,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // The nonce rides only in the HttpOnly cookie, never in a body script can read.
    expect(Object.keys(body)).toEqual(["authorizeUrl"]);
    const setCookie = response.headers.get("set-cookie") ?? "";
    const state = new URL(String(body.authorizeUrl)).searchParams.get("state")!;
    return { state, cookie: setCookie.split(";")[0] ?? "", setCookie };
  }

  function callback(state: string, cookie?: string): Promise<Response> {
    return oauthCallback(
      new Request(`http://localhost/api/social-connections/x/callback?code=abc&state=${state}`, {
        headers: cookie ? { cookie } : {},
      }),
      xParams,
    );
  }

  it("sets a short-lived HttpOnly, SameSite=Lax cookie scoped to these routes", async () => {
    const { setCookie } = await startAsAttacker();
    expect(setCookie).toMatch(/^pubmax_social_oauth=[A-Za-z0-9_-]{32,};/);
    expect(setCookie).toContain("Path=/api/social-connections");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=600");
  });

  it("refuses a callback opened in a browser that did not start the flow", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { state } = await startAsAttacker();

    const response = await callback(state);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("status")).toBe("failed");
    // No code was ever exchanged, and nothing was linked to the attacker.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await socialConnectionStore().list("attacker")).toEqual([]);
  });

  it("completes in the starting browser, and clears the cookie on the way out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes("/oauth2/token")
          ? Response.json({ access_token: "token-1", expires_in: 3600 })
          : Response.json({ data: { id: "x-42", username: "starter" } }),
      ),
    );
    const { state, cookie } = await startAsAttacker();

    const response = await callback(state, cookie);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("status")).toBe("connected");
    const cleared = response.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/^pubmax_social_oauth=;/);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/api/social-connections");
  });
});
