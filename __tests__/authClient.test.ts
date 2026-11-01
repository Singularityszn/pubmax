import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

async function loadAuthClient() {
  return import("@/lib/authClient");
}

beforeEach(() => {
  vi.resetModules();
  createClient.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("browser auth client", () => {
  it("does not construct a Supabase client during server rendering", async () => {
    const { getSupabaseBrowser, createNativeAuthClient } = await loadAuthClient();

    expect(getSupabaseBrowser()).toBeNull();
    expect(await createNativeAuthClient("a".repeat(32))).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("degrades to unavailable in the browser when either public setting is missing", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const { getSupabaseBrowser, isAuthConfigured } = await loadAuthClient();

    expect(isAuthConfigured()).toBe(false);
    expect(getSupabaseBrowser()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("degrades to unavailable when the public Supabase URL is malformed", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-valid-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const { ensureSupabaseBrowser, isAuthConfigured } = await loadAuthClient();

    expect(isAuthConfigured()).toBe(false);
    await expect(ensureSupabaseBrowser()).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects URL-parsable shorthand before constructing the browser client", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https:example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const { ensureSupabaseBrowser, isAuthConfigured } = await loadAuthClient();

    expect(isAuthConfigured()).toBe(false);
    await expect(ensureSupabaseBrowser()).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["current secret key", "sb_secret_server-only"],
    ["legacy service-role key", "e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature"],
    ["unknown key class", "opaque-production-key"],
  ])("never exposes a %s through browser auth", async (_label, key) => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    const { ensureSupabaseBrowser, isAuthConfigured } = await loadAuthClient();

    expect(isAuthConfigured()).toBe(false);
    await expect(ensureSupabaseBrowser()).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("retries construction after malformed public configuration is repaired", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-valid-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const client = { auth: { getSession: vi.fn() } };
    createClient.mockReturnValue(client);
    const { ensureSupabaseBrowser } = await loadAuthClient();

    await expect(ensureSupabaseBrowser()).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");

    await expect(ensureSupabaseBrowser()).resolves.toBe(client);
    expect(createClient).toHaveBeenCalledOnce();
  });

  it("constructs and reuses one implicit-flow client when browser auth is configured", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const client = { auth: { getSession: vi.fn() } };
    createClient.mockReturnValue(client);
    const { ensureSupabaseBrowser, getSupabaseBrowser, isAuthConfigured } = await loadAuthClient();

    expect(isAuthConfigured()).toBe(true);
    // The sync accessor is null until the lazily-imported client resolves.
    expect(getSupabaseBrowser()).toBeNull();
    // Awaiting loads the supabase-js chunk once and memoizes the single client.
    await expect(ensureSupabaseBrowser()).resolves.toBe(client);
    await expect(ensureSupabaseBrowser()).resolves.toBe(client);
    // Now the sync accessor mirrors the warmed client.
    expect(getSupabaseBrowser()).toBe(client);
    expect(createClient).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "publishable-key",
      {
        global: {
          fetch: expect.any(Function),
        },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Implicit flow: the session tokens ride the callback URL fragment,
          // so an email link opened in a DIFFERENT browser can still complete.
          // AuthProvider detects and scrubs the fragment explicitly.
          detectSessionInUrl: false,
          flowType: "implicit",
        },
      },
    );
  });
});

describe("getAccessToken", () => {
  it.each([
    ["account-a", "account-b"],
    ["account-b", "account-a"],
  ])("withholds %s's SDK token while %s owns the provider", async (sdkOwner, providerOwner) => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const getSession = vi.fn()
      .mockResolvedValueOnce({ data: { session: { access_token: "wrong-owner-token", user: { id: sdkOwner } } } })
      .mockResolvedValueOnce({ data: { session: { access_token: "current-owner-token", user: { id: providerOwner } } } });
    createClient.mockReturnValue({ auth: { getSession } });
    const { setProviderIdentity, readProviderAccountRevision } = await import("@/lib/authProviderRevision");
    setProviderIdentity("supabase", providerOwner);
    const revision = readProviderAccountRevision();
    const { getAccessToken } = await loadAuthClient();

    await expect(getAccessToken()).resolves.toBeNull();
    await expect(getAccessToken()).resolves.toBe("current-owner-token");
    expect(readProviderAccountRevision()).toBe(revision);
  });

  it("returns null when browser auth is unavailable", async () => {
    const { getAccessToken } = await loadAuthClient();

    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("does not use a Clerk identity to accept an unowned Supabase session", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({
      data: { session: { access_token: "old-supabase-token", user: { id: "account-a" } } },
    }) } });
    const { setProviderIdentity } = await import("@/lib/authProviderRevision");
    setProviderIdentity("clerk", "account-a");
    const { getAccessToken } = await loadAuthClient();

    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("keeps a matching Supabase session independent of the Clerk identity", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({
      data: { session: { access_token: "current-supabase-token", user: { id: "account-a" } } },
    }) } });
    const { setProviderIdentity } = await import("@/lib/authProviderRevision");
    setProviderIdentity("supabase", "account-a");
    setProviderIdentity("clerk", "different-clerk-account");
    const { getAccessToken } = await loadAuthClient();

    await expect(getAccessToken()).resolves.toBe("current-supabase-token");
  });

  it("withholds a session read that crosses sign-out and return to the same account", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    let finish!: (value: unknown) => void;
    const getSession = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    createClient.mockReturnValue({ auth: { getSession } });
    const { setProviderIdentity } = await import("@/lib/authProviderRevision");
    setProviderIdentity("supabase", "account-a");
    const { ensureSupabaseBrowser, getAccessToken } = await loadAuthClient();
    await ensureSupabaseBrowser();
    const token = getAccessToken();
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledOnce());
    setProviderIdentity("supabase", null);
    setProviderIdentity("supabase", "account-a");
    finish({ data: { session: { access_token: "previous-generation-token", user: { id: "account-a" } } } });

    await expect(token).resolves.toBeNull();
  });

  it("returns the current access token and treats a signed-out session as anonymous", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: { access_token: "jwt-token", user: { id: "account-a" } } } })
      .mockResolvedValueOnce({ data: { session: null } });
    createClient.mockReturnValue({ auth: { getSession } });
    const { setProviderIdentity } = await import("@/lib/authProviderRevision");
    setProviderIdentity("supabase", "account-a");
    const { getAccessToken } = await loadAuthClient();

    await expect(getAccessToken()).resolves.toBe("jwt-token");
    await expect(getAccessToken()).resolves.toBeNull();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("fails soft when reading the browser session throws", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    createClient.mockReturnValue({
      auth: { getSession: vi.fn().mockRejectedValue(new Error("storage blocked")) },
    });
    const { getAccessToken } = await loadAuthClient();

    await expect(getAccessToken()).resolves.toBeNull();
  });
});
