import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Apple asks every app with Sign in with Apple to revoke the person's Apple
// token when they delete their account (App Review 5.1.1(v)). The revoke call
// needs a client secret, an ES256 JWT signed with the Sign in with Apple key,
// minted fresh for each call. Apple's endpoint is never called from a test.

vi.mock("server-only", () => ({}));

import {
  APPLE_REVOKE_URL,
  APPLE_SIGN_IN_CLIENT_ID,
  revokeAppleToken,
} from "@/lib/appleSignInRevocation.server";
import { appleTokenFromBody } from "@/lib/appleSignInToken";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PRIVATE_PEM = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const ENV = {
  APPLE_SIGN_IN_TEAM_ID: "TEAM123456",
  APPLE_SIGN_IN_KEY_ID: "KEY1234567",
  // Hosts that need one line keep PEM newlines as literal \n escapes.
  APPLE_SIGN_IN_PRIVATE_KEY: PRIVATE_PEM.replace(/\n/g, "\\n"),
};
const NOW_MS = 1_800_000_000_000;
const REFRESH = { value: "r.apple-refresh-token-value", type: "refresh_token" as const };

function fakeFetch(response: Response | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function decodePart(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("revokeAppleToken", () => {
  it("posts the token to Apple with the client id and a freshly signed client secret", async () => {
    const apple = fakeFetch(new Response(null, { status: 200 }));

    const result = await revokeAppleToken(REFRESH, { fetch: apple.fetch, env: ENV, nowMs: NOW_MS });

    expect(result).toEqual({ status: "revoked" });
    expect(apple.calls).toHaveLength(1);
    const [call] = apple.calls;
    expect(call?.url).toBe(APPLE_REVOKE_URL);
    expect(call?.init.method).toBe("POST");
    const form = new URLSearchParams(String(call?.init.body));
    expect(form.get("client_id")).toBe(APPLE_SIGN_IN_CLIENT_ID);
    expect(form.get("token")).toBe(REFRESH.value);
    expect(form.get("token_type_hint")).toBe("refresh_token");

    const secret = form.get("client_secret") ?? "";
    const [header, claims, signature] = secret.split(".");
    expect(decodePart(header ?? "")).toEqual({ alg: "ES256", kid: ENV.APPLE_SIGN_IN_KEY_ID });
    const iat = NOW_MS / 1000;
    expect(decodePart(claims ?? "")).toEqual({
      iss: ENV.APPLE_SIGN_IN_TEAM_ID,
      iat,
      exp: iat + 300,
      aud: "https://appleid.apple.com",
      sub: APPLE_SIGN_IN_CLIENT_ID,
    });
    expect(
      cryptoVerify(
        "sha256",
        Buffer.from(`${header}.${claims}`, "utf8"),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("makes no call when the Sign in with Apple key is not configured", async () => {
    const apple = fakeFetch(new Response(null, { status: 200 }));

    const result = await revokeAppleToken(REFRESH, {
      fetch: apple.fetch,
      env: { ...ENV, APPLE_SIGN_IN_PRIVATE_KEY: "" },
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ status: "not_configured" });
    expect(apple.calls).toHaveLength(0);
  });

  it("reports Apple's refusal by status and error code, never by token", async () => {
    const apple = fakeFetch(
      new Response(JSON.stringify({ error: "invalid_client" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await revokeAppleToken(REFRESH, { fetch: apple.fetch, env: ENV, nowMs: NOW_MS });

    expect(result).toEqual({ status: "failed", reason: "http_400:invalid_client" });
  });

  it("reports an Apple outage as a failure instead of throwing", async () => {
    const apple = fakeFetch(new TypeError(`fetch failed for ${REFRESH.value}`));

    const result = await revokeAppleToken(REFRESH, { fetch: apple.fetch, env: ENV, nowMs: NOW_MS });

    expect(result).toEqual({ status: "failed", reason: "network:TypeError" });
  });

  it("reports an unreadable key as a failure instead of throwing", async () => {
    const apple = fakeFetch(new Response(null, { status: 200 }));

    const result = await revokeAppleToken(REFRESH, {
      fetch: apple.fetch,
      env: { ...ENV, APPLE_SIGN_IN_PRIVATE_KEY: "not-a-key" },
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ status: "failed", reason: "client_secret_unsigned" });
    expect(apple.calls).toHaveLength(0);
  });
});

describe("appleTokenFromBody", () => {
  it("reads an Apple refresh or access token and refuses every other shape", () => {
    expect(appleTokenFromBody({ appleToken: { value: "abc.def", type: "refresh_token" } })).toEqual({
      value: "abc.def",
      type: "refresh_token",
    });
    expect(appleTokenFromBody({ appleToken: { value: "abc", type: "access_token" } })).toEqual({
      value: "abc",
      type: "access_token",
    });
    for (const body of [
      null,
      "abc",
      {},
      { appleToken: "abc" },
      { appleToken: { value: "abc", type: "id_token" } },
      { appleToken: { value: "", type: "refresh_token" } },
      { appleToken: { value: "a b", type: "refresh_token" } },
      { appleToken: { value: "a".repeat(4097), type: "refresh_token" } },
    ]) {
      expect(appleTokenFromBody(body)).toBeNull();
    }
  });
});
