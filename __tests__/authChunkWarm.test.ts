// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth chunk is asked for before hydration.
 *
 * A dynamic import inside a React effect is not discovered until the tree has
 * hydrated, so the auth chunk was the last script a throttled phone asked for,
 * and every surface that waits for the session waited on it.
 * AuthProvider now warms the chunk at module-execution time.
 *
 * Two properties matter more than the speed: the warm builds no client, and it
 * fetches nothing a deployment without browser auth cannot use.
 */
const URL_ENV = "https://pubmaxx-test.supabase.co";
const KEY_ENV = "sb_publishable_pubmaxx_test";

function mockSupabase() {
  const state = { imports: 0, createClient: vi.fn(() => ({ auth: {} })) };
  vi.doMock("@supabase/supabase-js", () => {
    state.imports += 1;
    return { createClient: state.createClient };
  });
  return state;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("warmAuthClientModule", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("downloads nothing when the deployment has no browser auth", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const supabase = mockSupabase();

    const { warmAuthClientModule } = await import("../lib/authClient");
    warmAuthClientModule();
    await settle();

    expect(supabase.imports).toBe(0);
  });

  it("starts the import without building a client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_ENV);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY_ENV);
    const supabase = mockSupabase();

    const { warmAuthClientModule } = await import("../lib/authClient");
    warmAuthClientModule();
    await settle();

    // createClient starts session persistence and background refresh, so the
    // warm must stop at the download.
    expect(supabase.imports).toBe(1);
    expect(supabase.createClient).not.toHaveBeenCalled();
  });

  it("shares one import with the client load that follows", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_ENV);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY_ENV);
    const supabase = mockSupabase();

    const { warmAuthClientModule, ensureSupabaseBrowser } = await import("../lib/authClient");
    warmAuthClientModule();
    warmAuthClientModule();
    const client = await ensureSupabaseBrowser();

    expect(client).toEqual({ auth: {} });
    expect(supabase.imports).toBe(1);
    expect(supabase.createClient).toHaveBeenCalledTimes(1);
  });

  it("drops a failed warm so the client load imports again", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_ENV);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY_ENV);
    let attempts = 0;
    const createClient = vi.fn(() => ({ auth: {} }));
    vi.doMock("@supabase/supabase-js", () => {
      attempts += 1;
      if (attempts === 1) throw new Error("chunk moved");
      return { createClient };
    });

    const { warmAuthClientModule, ensureSupabaseBrowser } = await import("../lib/authClient");
    warmAuthClientModule();
    await settle();

    await expect(ensureSupabaseBrowser()).resolves.toEqual({ auth: {} });
    expect(attempts).toBe(2);
  });
});

describe("AuthProvider warms the chunk before hydration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("starts the download when the provider module loads, before any render", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_ENV);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY_ENV);
    const supabase = mockSupabase();

    // Loading the module is what the browser does before hydration. Nothing
    // is rendered here, so no effect can have asked for the chunk.
    await import("../components/auth/AuthProvider");
    await settle();

    expect(supabase.imports).toBe(1);
    expect(supabase.createClient).not.toHaveBeenCalled();
  });
});
