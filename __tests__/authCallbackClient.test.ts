import { describe, expect, it, vi } from "vitest";

import {
  clearLegacyPkceVerifiers,
  establishAuthCallbackSession,
  fetchAuthCallbackUser,
  prepareAuthCallbackSession,
} from "@/lib/authCallbackClient";
import { scrubAuthCallback } from "@/lib/authRedirect";

const mintMatchingSession = async (refreshToken: string) => ({
  status: "minted" as const,
  session: { access_token: "synthetic-access", refresh_token: refreshToken },
});

describe("explicit implicit-flow callback completion", () => {
  it("scrubs a forged-looking unowned map callback before offering cross-browser sign-in", async () => {
    const replaceUrl = vi.fn();
    const captured = await scrubAuthCallback(
      "https://pubmaxxing.com/map#access_token=synthetic-access&refresh_token=synthetic-refresh",
      replaceUrl,
      { persistentStorage: null, tabStorage: null, lockManager: null },
    );
    expect(replaceUrl).toHaveBeenCalledWith("/map");
    expect(captured?.localAttemptOwned).toBe(false);
    expect(captured?.attempt.tokens).toEqual({
      accessToken: "synthetic-access",
      refreshToken: "synthetic-refresh",
    });
    const setSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "account-a", email: "person@example.com" } },
      error: null,
    });
    const pending = await prepareAuthCallbackSession(
      { setSession },
      captured!.attempt.tokens!,
      captured!.localAttemptOwned,
      mintMatchingSession,
      getUser,
    );
    expect(pending.status).toBe("confirmation-required");
    expect(setSession).not.toHaveBeenCalled();
  });

  it("holds an unowned callback until its verified account is confirmed", async () => {
    const setSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: "account-a" } } },
      error: null,
    });
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "account-a", email: "person@example.com" } },
      error: null,
    });
    const auth = { setSession };
    const tokens = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" };

    const pending = await prepareAuthCallbackSession(auth, tokens, false, mintMatchingSession, getUser);
    expect(getUser).toHaveBeenCalledWith("synthetic-access");
    expect(pending).toMatchObject({
      status: "confirmation-required",
      identity: { userId: "account-a", label: "person@example.com" },
    });
    expect(setSession).not.toHaveBeenCalled();
    if (pending.status !== "confirmation-required") throw new Error("Expected confirmation");
    await pending.confirm();
    expect(setSession).toHaveBeenCalledOnce();
  });

  it("rejects an unowned callback whose refresh token mints another account", async () => {
    const setSession = vi.fn();
    const getUser = vi.fn(async (accessToken: string) => ({
      data: {
        user: accessToken === "access-a"
          ? { id: "account-a", email: "a@example.com" }
          : { id: "account-b", email: "b@example.com" },
      },
      error: null,
    }));
    const mintSession = vi.fn().mockResolvedValue({
      status: "minted",
      session: { access_token: "access-b", refresh_token: "rotated-refresh-b" },
    });

    const prepared = await prepareAuthCallbackSession(
      { setSession },
      { accessToken: "access-a", refreshToken: "refresh-b" },
      false,
      mintSession,
      getUser,
    );

    expect(prepared.status).toBe("verification-failed");
    expect(setSession).not.toHaveBeenCalled();
  });

  it("installs the verified rotated pair even when original access expires", async () => {
    const setSession = vi.fn().mockImplementation(async (pair) => ({
      data: { session: { user: { id: "account-a" }, ...pair } },
      error: null,
    }));
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "account-a", email: "a@example.com" } },
      error: null,
    });
    const mintSession = vi.fn().mockResolvedValue({
      status: "minted",
      session: { access_token: "fresh-access-a", refresh_token: "fresh-refresh-a" },
    });
    const prepared = await prepareAuthCallbackSession(
      { setSession },
      { accessToken: "expiring-access-a", refreshToken: "old-refresh-a" },
      false,
      mintSession,
      getUser,
    );
    expect(prepared.status).toBe("confirmation-required");
    if (prepared.status !== "confirmation-required") throw new Error("Expected confirmation");
    expect(setSession).not.toHaveBeenCalled();
    await prepared.confirm();
    expect(getUser).toHaveBeenCalledWith("expiring-access-a");
    expect(getUser).toHaveBeenCalledWith("fresh-access-a");
    expect(setSession).toHaveBeenCalledWith({
      access_token: "fresh-access-a",
      refresh_token: "fresh-refresh-a",
    });
  });

  it("offers a cross-browser link whose original access expired when refresh proves identity", async () => {
    const setSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const expiredAccess = `header.${btoa(JSON.stringify({ sub: "account-a", exp: 1 }))}.signature`;
    const getUser = vi.fn(async (accessToken: string) => accessToken === expiredAccess
      ? { data: { user: null }, error: { status: 403, code: "bad_jwt", message: "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired" } }
      : { data: { user: { id: "account-a", email: "a@example.com" } }, error: null });
    const mintSession = vi.fn().mockResolvedValue({
      status: "minted",
      session: { access_token: "fresh-access-a", refresh_token: "fresh-refresh-a" },
    });

    const prepared = await prepareAuthCallbackSession(
      { setSession },
      { accessToken: expiredAccess, refreshToken: "old-refresh-a" },
      false,
      mintSession,
      getUser,
    );

    expect(prepared).toMatchObject({
      status: "confirmation-required",
      identity: { userId: "account-a", label: "a@example.com" },
    });
    expect(setSession).not.toHaveBeenCalled();
  });

  it("never installs an unverified callback or one the reader cancels", async () => {
    const setSession = vi.fn();
    const tokens = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" };
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    const rejected = await prepareAuthCallbackSession(
      { setSession }, tokens, false, mintMatchingSession, getUser,
    );
    expect(rejected.status).toBe("verification-failed");
    expect(setSession).not.toHaveBeenCalled();

    getUser.mockResolvedValue({
      data: { user: { id: "account-a", email: "person@example.com" } }, error: null,
    });
    const pending = await prepareAuthCallbackSession(
      { setSession }, tokens, false, mintMatchingSession, getUser,
    );
    expect(pending.status).toBe("confirmation-required");
    expect(setSession).not.toHaveBeenCalled();
  });

  it("keeps a locally owned callback immediate", async () => {
    const session = { user: { id: "account-a" } };
    const setSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const getUser = vi.fn();
    const result = await prepareAuthCallbackSession(
      { setSession },
      { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
      true,
      mintMatchingSession,
      getUser,
    );
    expect(result).toEqual({
      status: "established",
      result: { session, failed: false, banned: false },
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("returns the established session", async () => {
    const session = { access_token: "access" };
    const setSession = vi.fn().mockResolvedValue({
      data: { session },
      error: null,
    });

    await expect(
      establishAuthCallbackSession(
        { setSession },
        { accessToken: "access", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session, failed: false, banned: false });
    expect(setSession).toHaveBeenCalledOnce();
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh",
    });
  });

  it("surfaces auth bans without a generic failure", async () => {
    const setSession = vi.fn().mockResolvedValue({
      data: { session: null },
      error: { code: "user_banned" },
    });
    await expect(
      establishAuthCallbackSession(
        { setSession },
        { accessToken: "access", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session: null, failed: false, banned: true });
  });

  it("normalizes provider and network failures", async () => {
    const providerFailure = vi.fn().mockResolvedValue({
      data: { session: null },
      error: { code: "bad_jwt" },
    });
    const networkFailure = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      establishAuthCallbackSession(
        { setSession: providerFailure },
        { accessToken: "expired", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session: null, failed: true, banned: false });
    await expect(
      establishAuthCallbackSession(
        { setSession: networkFailure },
        { accessToken: "access", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session: null, failed: true, banned: false });
  });
});

describe("callback identity verification failures", () => {
  const expiryMessage = "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired";
  const expiredAccess = `header.${btoa(JSON.stringify({ sub: "account-a", exp: 1 }))}.signature`;

  it.each([
    { status: 503, code: "bad_jwt", message: expiryMessage },
    { status: 403, code: "bad_jwt", message: "invalid signature" },
    { status: 403, code: "bad_jwt", message: `${expiryMessage}, token is not valid yet` },
    { status: 403, code: "unknown", message: expiryMessage },
    new Error("offline"),
  ])("rejects failures that do not establish expiry: %j", async (error) => {
    const setSession = vi.fn();
    const mintSession = vi.fn(mintMatchingSession);
    const result = await prepareAuthCallbackSession(
      { setSession }, { accessToken: expiredAccess, refreshToken: "refresh" }, false,
      mintSession, async () => ({ data: { user: null }, error }),
    );
    expect(result.status).toBe("verification-failed");
    expect(mintSession).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("rejects a thrown lookup before redeeming refresh", async () => {
    const mintSession = vi.fn(mintMatchingSession);
    const result = await prepareAuthCallbackSession(
      { setSession: vi.fn() }, { accessToken: expiredAccess, refreshToken: "refresh" }, false,
      mintSession, async () => { throw new Error("offline"); },
    );
    expect(result.status).toBe("verification-failed");
    expect(mintSession).not.toHaveBeenCalled();
  });

  it.each([
    "malformed",
    `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`,
    `header.${btoa(JSON.stringify({ sub: "account-a", exp: "1" }))}.signature`,
    `header.${btoa(JSON.stringify({ sub: "account-a", exp: 9_999_999_999 }))}.signature`,
  ])("rejects expiry without usable matching claims: %s", async (accessToken) => {
    const mintSession = vi.fn(mintMatchingSession);
    const result = await prepareAuthCallbackSession(
      { setSession: vi.fn() }, { accessToken, refreshToken: "refresh" }, false,
      mintSession, async () => ({ data: { user: null }, error: {
        status: 403, code: "bad_jwt", message: expiryMessage,
      } }),
    );
    expect(result.status).toBe("verification-failed");
    expect(mintSession).not.toHaveBeenCalled();
  });

  it("does not accept an expired refreshed token", async () => {
    const result = await prepareAuthCallbackSession(
      { setSession: vi.fn() }, { accessToken: expiredAccess, refreshToken: "refresh" }, false,
      mintMatchingSession, async () => ({ data: { user: null }, error: {
        status: 403, code: "bad_jwt", message: expiryMessage,
      } }),
    );
    expect(result.status).toBe("verification-failed");
  });

  it("reads identity with the supplied bearer and no cookies", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "account-a", email: "a@example.com",
    })));
    await expect(fetchAuthCallbackUser("access-a", {
      authConfig: { url: "https://provider.example", key: "public-key" }, fetchImpl,
    })).resolves.toEqual({ data: { user: { id: "account-a", email: "a@example.com" } }, error: null });
    expect(fetchImpl).toHaveBeenCalledWith("https://provider.example/auth/v1/user", expect.objectContaining({
      credentials: "omit", cache: "no-store", redirect: "error",
      headers: { apikey: "public-key", authorization: "Bearer access-a" },
    }));
  });
});

describe("legacy PKCE verifier cleanup", () => {
  function keyedStorage(initial: string[]) {
    const keys = [...initial];
    return {
      keys,
      storage: {
        get length() {
          return keys.length;
        },
        key: (index: number) => keys[index] ?? null,
        removeItem: (key: string) => {
          const at = keys.indexOf(key);
          if (at >= 0) keys.splice(at, 1);
        },
      },
    };
  }

  it("removes only supabase code-verifier keys and keeps live state", () => {
    const { keys, storage } = keyedStorage([
      "sb-iankaj-auth-token-code-verifier",
      "sb-iankaj-auth-token",
      "sb-other-auth-token-code-verifier",
      "pubmax_handle",
      "unrelated-auth-token-code-verifier",
    ]);

    clearLegacyPkceVerifiers(storage);

    expect(keys).toEqual([
      "sb-iankaj-auth-token",
      "pubmax_handle",
      "unrelated-auth-token-code-verifier",
    ]);
  });

  it("tolerates missing or blocked storage", () => {
    expect(() => clearLegacyPkceVerifiers(null)).not.toThrow();
    expect(() =>
      clearLegacyPkceVerifiers({
        get length(): number {
          throw new Error("blocked");
        },
        key: () => null,
        removeItem: () => {},
      }),
    ).not.toThrow();
  });
});
