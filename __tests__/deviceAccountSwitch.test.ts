// Making a remembered account the active one.
//
// THE LAW UNDER TEST: the switcher changes WHICH session is active and never how
// identity binds. So the swap is a token exchange plus `setSession`, and the one
// atomic device-identity pass stays where it already lives
// (`AuthProvider.updateSession`). A second binder here would be a second chance
// to name the wrong person.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEVICE_IDENTITY_LOCAL_KEYS } from "@/lib/deviceAccountIdentity";
import {
  readDeviceAccounts,
  rememberDeviceAccount,
} from "@/lib/deviceAccountSessions";
import {
  activateDeviceAccount,
  mintSessionFromRefreshToken,
  parseMintedSession,
  type DeviceAccountSwitchDeps,
} from "@/lib/deviceAccountSwitch";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const STORED_TOKEN = "stored-refresh-token-for-b";
const ROTATED_TOKEN = "rotated-refresh-token-for-b";

const AUTH_CONFIG = {
  url: "https://project.supabase.co",
  key: "publishable-key",
};

function mintedBody(refreshToken = ROTATED_TOKEN) {
  return {
    access_token: "fresh-access-token",
    refresh_token: refreshToken,
    expires_in: 3600,
    token_type: "bearer",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deps(
  overrides: Partial<DeviceAccountSwitchDeps> & {
    storage: DeviceAccountSwitchDeps["storage"];
  },
): DeviceAccountSwitchDeps {
  return {
    fetchImpl: vi.fn(async () => jsonResponse(mintedBody())) as typeof fetch,
    authConfig: AUTH_CONFIG,
    setSession: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("minting a session from a stored refresh token", () => {
  it("asks GoTrue's own token endpoint, with the publishable key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(mintedBody()));
    const outcome = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      authConfig: AUTH_CONFIG,
    });

    expect(outcome).toEqual({ status: "minted", session: mintedBody() });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://project.supabase.co/auth/v1/token?grant_type=refresh_token",
    );
    expect((init.headers as Record<string, string>).apikey).toBe("publishable-key");
    expect(init.body).toBe(JSON.stringify({ refresh_token: STORED_TOKEN }));
  });

  it("separates a refused token from a question we could not ask", async () => {
    const refused = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => jsonResponse({ error: "invalid" }, 400)) as typeof fetch,
      authConfig: AUTH_CONFIG,
    });
    expect(refused).toEqual({ status: "refused" });

    const banned = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => jsonResponse({ code: 403, error_code: "user_banned", msg: "User is banned" }, 403)) as typeof fetch,
      authConfig: AUTH_CONFIG,
    });
    expect(banned).toEqual({ status: "refused", banned: true });

    const server = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => jsonResponse({}, 503)) as typeof fetch,
      authConfig: AUTH_CONFIG,
    });
    expect(server.status).toBe("unavailable");

    const offline = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
      authConfig: AUTH_CONFIG,
    });
    expect(offline.status).toBe("unavailable");

    const keyless = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => jsonResponse(mintedBody())) as typeof fetch,
      authConfig: null,
    });
    expect(keyless.status).toBe("unavailable");
  });

  it("refuses an answer carrying no way to renew", () => {
    expect(parseMintedSession({ access_token: "only-this" })).toBeNull();
    expect(parseMintedSession({ refresh_token: "only-this" })).toBeNull();
    expect(parseMintedSession(null)).toBeNull();
    expect(parseMintedSession(mintedBody())).toEqual(mintedBody());
  });
});

describe("activating a remembered account", () => {
  let local: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    local = fakeStorage();
    rememberDeviceAccount(local, { userId: "b", refreshToken: STORED_TOKEN }, 2_000);
  });

  it("installs the minted session and lets the auth event do the rest", async () => {
    const setSession = vi.fn(async () => ({ ok: true }));
    const outcome = await activateDeviceAccount("b", deps({ storage: local, setSession }));

    expect(outcome).toEqual({ status: "switched", userId: "b" });
    expect(setSession).toHaveBeenCalledWith(mintedBody());
  });

  it("writes the rotated token before installing it", async () => {
    // GoTrue spends a refresh token on use. A crash between the exchange and the
    // install would otherwise leave this device holding a token that can never
    // work again, so the row is updated first: a minted-but-uninstalled token is
    // still good for the next attempt.
    let tokenAtInstall: string | null = null;
    await activateDeviceAccount(
      "b",
      deps({
        storage: local,
        setSession: async () => {
          tokenAtInstall = readDeviceAccounts(local)[0]?.refreshToken ?? null;
          return { ok: true };
        },
      }),
    );

    expect(tokenAtInstall).toBe(ROTATED_TOKEN);
    expect(local.values.get("pubmax_device_sessions_v1")).not.toContain(STORED_TOKEN);
  });

  it("retires a refused token and asks its owner to sign in", async () => {
    const outcome = await activateDeviceAccount(
      "b",
      deps({
        storage: local,
        fetchImpl: (async () => jsonResponse({ error: "invalid" }, 400)) as typeof fetch,
      }),
    );

    expect(outcome).toEqual({ status: "needs_sign_in", userId: "b" });
    const [row] = readDeviceAccounts(local);
    expect(row?.userId).toBe("b");
    expect(row?.refreshToken).toBeNull();
  });

  it("says when the refused account is banned, so the switcher can show the ban notice", async () => {
    const outcome = await activateDeviceAccount(
      "b",
      deps({
        storage: local,
        fetchImpl: (async () => jsonResponse({ code: 403, error_code: "user_banned", msg: "User is banned" }, 403)) as typeof fetch,
      }),
    );

    expect(outcome).toEqual({ status: "needs_sign_in", userId: "b", banned: true });
    expect(readDeviceAccounts(local)[0]?.refreshToken).toBeNull();
  });

  it("keeps a token it could not ask about, and installs nothing", async () => {
    const setSession = vi.fn(async () => ({ ok: true }));
    const outcome = await activateDeviceAccount(
      "b",
      deps({
        storage: local,
        setSession,
        fetchImpl: (async () => jsonResponse({}, 503)) as typeof fetch,
      }),
    );

    // A network fault is not evidence a credential died, and the live session is
    // untouched either way: only a successful mint ever reaches `setSession`.
    expect(outcome).toEqual({ status: "unavailable" });
    expect(setSession).not.toHaveBeenCalled();
    expect(readDeviceAccounts(local)[0]?.refreshToken).toBe(STORED_TOKEN);
  });

  it("answers needs-sign-in for an account this device does not hold", async () => {
    expect(await activateDeviceAccount("nobody", deps({ storage: local }))).toEqual({
      status: "needs_sign_in",
      userId: "nobody",
    });

    rememberDeviceAccount(local, { userId: "c", refreshToken: null }, 3_000);
    expect(await activateDeviceAccount("c", deps({ storage: local }))).toEqual({
      status: "needs_sign_in",
      userId: "c",
    });
  });

  it("reports a refused install rather than claiming a switch", async () => {
    const outcome = await activateDeviceAccount(
      "b",
      deps({ storage: local, setSession: async () => ({ ok: false }) }),
    );

    expect(outcome).toEqual({ status: "unavailable" });
  });
});

describe("the switch never binds identity itself", () => {
  let local: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    local = fakeStorage();
    rememberDeviceAccount(local, { userId: "b", refreshToken: STORED_TOKEN }, 2_000);
  });

  it("writes only its own lane row and stamps no owner", async () => {
    const before = [...local.values.keys()];
    await activateDeviceAccount("b", deps({ storage: local }));

    // The one device-identity pass belongs to `AuthProvider.updateSession`,
    // which a switch reaches through the SIGNED_IN that `setSession` fires.
    expect([...local.values.keys()]).toEqual(before);
    for (const key of DEVICE_IDENTITY_LOCAL_KEYS) expect(local.values.has(key)).toBe(false);
  });

  it("asks only the token endpoint, never the durable resume cookie route", async () => {
    // The cookie mirrors the ACTIVE account only, and it follows a switch the
    // way it follows every sign-in: AuthProvider re-persists on SIGNED_IN.
    const fetchImpl = vi.fn(async () => jsonResponse(mintedBody()));
    const globalFetch = vi.spyOn(globalThis, "fetch");
    try {
      await activateDeviceAccount(
        "b",
        deps({ storage: local, fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect(fetchImpl.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual([
        "https://project.supabase.co/auth/v1/token?grant_type=refresh_token",
      ]);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalFetch.mockRestore();
    }
  });
});
