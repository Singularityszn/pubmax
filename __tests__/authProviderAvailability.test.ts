import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  guardSocialAuthProvider,
  loadClerkSocialAuthProviders,
  loadSocialAuthProviders,
  readSupabaseSocialAuthProviders,
  SOCIAL_AUTH_PROVIDERS_PATH,
} from "@/lib/authProviderAvailability";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function settingsResponse(external: Record<string, boolean>): Response {
  return new Response(JSON.stringify({ external }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function clerkEnvironmentResponse(
  social: Record<string, Record<string, unknown>>,
): Response {
  return new Response(JSON.stringify({ user_settings: { social } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function clerkPublishableKey(): string {
  return `pk_test_${Buffer.from("rare-trout-29.clerk.accounts.dev$").toString("base64")}`;
}

describe("Clerk social auth provider availability", () => {
  it("prefers the Clerk SDK environment over a direct request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      loadClerkSocialAuthProviders(fetchImpl, {
        userSettings: {
          social: {
            oauth_google: { enabled: true, strategy: "oauth_google" },
          },
        },
      }),
    ).resolves.toEqual({ google: true, apple: false, microsoft: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads enabled social strategies from Clerk's environment", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", clerkPublishableKey());
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      clerkEnvironmentResponse({
        oauth_google: { enabled: true, strategy: "oauth_google" },
        oauth_apple: { enabled: false, strategy: "oauth_apple" },
      }),
    );

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: true,
      apple: false,
      microsoft: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rare-trout-29.clerk.accounts.dev/v1/environment",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("never reports Microsoft from Clerk because Microsoft sign-in is Supabase Azure only", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", clerkPublishableKey());
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      clerkEnvironmentResponse({
        oauth_google: { enabled: true },
        oauth_microsoft: { enabled: true },
      }),
    );

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: true,
      apple: false,
      microsoft: false,
    });
  });

  it("shows Apple automatically when Clerk enables oauth_apple", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", clerkPublishableKey());
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      clerkEnvironmentResponse({
        oauth_google: { enabled: true },
        oauth_apple: { enabled: true },
      }),
    );

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: true,
      apple: true,
      microsoft: false,
    });
  });

  it.each([
    ["an HTTP failure", vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 503 }))],
    ["a network failure", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))],
    [
      "a malformed payload",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ user_settings: { social: null } }), { status: 200 }),
      ),
    ],
  ])("fails closed for %s", async (_label, fetchImpl) => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", clerkPublishableKey());

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toBeNull();
  });

  it("does not request Clerk environment when its publishable key is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function providerResponse(availability: {
  google: boolean;
  apple: boolean;
  microsoft: boolean;
}): Response {
  return new Response(JSON.stringify(availability), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("same-origin social auth provider availability", () => {
  it("reads the same-origin route without a cross-origin key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({ google: true, apple: false, microsoft: false }),
    );

    await expect(loadSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: true,
      apple: false,
      microsoft: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      SOCIAL_AUTH_PROVIDERS_PATH,
      expect.objectContaining({
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toBeUndefined();
    expect(init?.cache).not.toBe("no-store");
  });

  it("asks for an uncached recheck immediately before OAuth", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({ google: false, apple: true, microsoft: false }),
    );

    await expect(
      loadSocialAuthProviders(fetchImpl, { fresh: true }),
    ).resolves.toEqual({
      google: false,
      apple: true,
      microsoft: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${SOCIAL_AUTH_PROVIDERS_PATH}?fresh=1`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it.each([
    ["an HTTP failure", vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 503 }))],
    ["a network failure", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))],
    [
      "a malformed payload",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ external: { google: true } }), { status: 200 }),
      ),
    ],
  ])("fails closed for %s", async (_label, fetchImpl) => {
    await expect(loadSocialAuthProviders(fetchImpl)).resolves.toBeNull();
  });

  it("drains a refused answer so the browser can finish the request", async () => {
    // Chromium keeps a response whose body is never read in flight, so a
    // signed-out page that met a 503 here never reached network idle.
    const refused = new Response(
      JSON.stringify({ error: "Sign-in providers could not be read." }),
      { status: 503 },
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(refused);

    await expect(loadSocialAuthProviders(fetchImpl)).resolves.toBeNull();
    expect(refused.bodyUsed).toBe(true);
  });

  it("gives up on a refusal body that stalls, so the provider read still settles", async () => {
    // withAuthFetchTimeout stops its clock when the headers arrive, so the
    // drain needs its own deadline or a stalled body holds sign-in pending.
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const stalled = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
          },
          cancel,
        }),
        { status: 503 },
      );
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(stalled);

      let settled = false;
      const read = loadSocialAuthProviders(fetchImpl).then((value) => {
        settled = true;
        return value;
      });
      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(read).resolves.toBeNull();
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not request providers when browser auth configuration is incomplete", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(loadSocialAuthProviders(fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Supabase social auth provider settings", () => {
  it("reads live settings with the public key and maps Google and Apple", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      settingsResponse({
        google: true,
        apple: false,
        email: true,
      }),
    );

    await expect(readSupabaseSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: true,
      apple: false,
      microsoft: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/settings",
      expect.objectContaining({
        cache: "no-store",
        headers: { apikey: "publishable-key" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reports Apple from Supabase's Apple provider flag", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      settingsResponse({
        google: false,
        apple: true,
        email: true,
      }),
    );

    await expect(readSupabaseSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: false,
      apple: true,
      microsoft: false,
    });
  });

  it("reports Microsoft from Supabase's Azure provider flag", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      settingsResponse({
        google: false,
        apple: false,
        azure: true,
        email: true,
      }),
    );

    await expect(readSupabaseSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: false,
      apple: false,
      microsoft: true,
    });
  });

  it.each([
    ["an HTTP failure", vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 503 }))],
    ["a network failure", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))],
    [
      "a malformed payload",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ external: null }), { status: 200 }),
      ),
    ],
  ])("fails closed for %s", async (_label, fetchImpl) => {
    await expect(readSupabaseSocialAuthProviders(fetchImpl)).resolves.toBeNull();
  });

  it("does not request settings when browser auth configuration is incomplete", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(readSupabaseSocialAuthProviders(fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("social OAuth provider guard", () => {
  it("does not start Google OAuth when live settings disable it", async () => {
    const start = vi.fn().mockResolvedValue({ error: null });

    await expect(
      guardSocialAuthProvider(
        "google",
        start,
        async () => ({ google: false, apple: false, microsoft: false }),
      ),
    ).resolves.toEqual({
      availability: { google: false, apple: false, microsoft: false },
      result: {
        error: "Google sign-in isn't available right now. Use email instead.",
      },
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("does not start Apple OAuth when provider settings cannot be read", async () => {
    const start = vi.fn().mockResolvedValue({ error: null });

    await expect(
      guardSocialAuthProvider("apple", start, async () => null),
    ).resolves.toEqual({
      availability: null,
      result: {
        error: "Apple sign-in isn't available right now. Use email instead.",
      },
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("does not start Microsoft OAuth when live settings disable it", async () => {
    const start = vi.fn().mockResolvedValue({ error: null });

    await expect(
      guardSocialAuthProvider(
        "microsoft",
        start,
        async () => ({ google: false, apple: false, microsoft: false }),
      ),
    ).resolves.toEqual({
      availability: { google: false, apple: false, microsoft: false },
      result: {
        error: "Microsoft sign-in isn't available right now. Use email instead.",
      },
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("starts OAuth only after fresh settings enable the selected provider", async () => {
    const start = vi.fn().mockResolvedValue({ error: null });

    await expect(
      guardSocialAuthProvider(
        "google",
        start,
        async () => ({ google: true, apple: false, microsoft: false }),
      ),
    ).resolves.toEqual({
      availability: { google: true, apple: false, microsoft: false },
      result: { error: null },
    });
    expect(start).toHaveBeenCalledOnce();
  });
});

describe("GET /api/auth/providers", () => {
  it("holds a successful read at the edge for a few minutes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        settingsResponse({ google: true, apple: false, azure: false }),
      ),
    );
    const { GET } = await import("@/app/api/auth/providers/route");
    const response = await GET(new Request("http://localhost/api/auth/providers"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      google: true,
      apple: false,
      microsoft: false,
    });
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/settings",
      expect.objectContaining({
        cache: "no-store",
        headers: { apikey: "publishable-key" },
      }),
    );
  });

  it("does not cache the recheck made immediately before OAuth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        settingsResponse({ google: false, apple: false, azure: true }),
      ),
    );
    const { GET } = await import("@/app/api/auth/providers/route");
    const response = await GET(
      new Request("http://localhost/api/auth/providers?fresh=1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      google: false,
      apple: false,
      microsoft: true,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed and does not cache a missed read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 503 })),
    );
    const { GET } = await import("@/app/api/auth/providers/route");
    const response = await GET(new Request("http://localhost/api/auth/providers"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "PROVIDER_SETTINGS_UNAVAILABLE",
      retryable: true,
    });
  });
});
