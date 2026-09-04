// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The chunk asked for before hydration, pinned.
 *
 * `/pal` is the one route whose readiness really waits for the session to
 * answer, and it sat on its loading line for most of a second: every other
 * chunk started at about 112 ms and the auth chunk at 1183 ms, because a
 * dynamic import inside a React effect cannot be discovered until the tree has
 * hydrated. Warming it at module-execution time removes the wait.
 *
 * Two properties matter more than the speed, and both are pinned here: the warm
 * builds NO client, and it fetches nothing a deployment cannot use.
 */
describe("warmAuthClientModule", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("only runs in a browser, so a server render imports nothing", async () => {
    // Guarded first, because every case below depends on this file running
    // with a window: without one the warm returns immediately and a test that
    // asserts "did not import" would pass for the wrong reason.
    expect(typeof window).toBe("object");
  });

  it("does nothing at all when the deployment has no auth config", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const supabase = { createClient: vi.fn() };
    vi.doMock("@supabase/supabase-js", () => supabase);

    const { warmAuthClientModule } = await import("../lib/authClient");
    warmAuthClientModule();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A keyless build must download nothing: the config is resolved before the
    // import, exactly as buildBrowserClient does.
    expect(supabase.createClient).not.toHaveBeenCalled();
  });

  it("never builds a client, because that would start session persistence", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pubmaxx-test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_pubmaxx_test");
    const createClient = vi.fn(() => ({ auth: {} }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { warmAuthClientModule } = await import("../lib/authClient");
    warmAuthClientModule();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The whole point: the module is fetched, the client is not constructed.
    // createClient starts persistSession and autoRefreshToken, and moving those
    // earlier would be a behaviour change rather than a download.
    expect(createClient).not.toHaveBeenCalled();
  });

  it("actually starts the import, which is the whole point", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pubmaxx-test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_pubmaxx_test");
    let imports = 0;
    vi.doMock("@supabase/supabase-js", () => {
      imports += 1;
      return { createClient: vi.fn(() => ({ auth: {} })) };
    });

    const { warmAuthClientModule } = await import("../lib/authClient");
    warmAuthClientModule();
    // Let the dynamic import settle. The point is that it was STARTED here,
    // with no client asked for and no effect having run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Before the warm existed this was 0 and the chunk was not asked for until
    // an effect ran, most of a second after hydration.
    expect(imports).toBe(1);
  });

  it("is idempotent, so the effect that follows it costs no second import", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pubmaxx-test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_pubmaxx_test");
    let imports = 0;
    vi.doMock("@supabase/supabase-js", () => {
      imports += 1;
      return { createClient: vi.fn(() => ({ auth: {} })) };
    });

    const { warmAuthClientModule, ensureSupabaseBrowser } = await import("../lib/authClient");
    warmAuthClientModule();
    warmAuthClientModule();
    await ensureSupabaseBrowser();

    expect(imports).toBe(1);
  });

  it("leaves the real load to ensureSupabaseBrowser, which still answers", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pubmaxx-test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_pubmaxx_test");
    const client = { auth: {} };
    const createClient = vi.fn(() => client);
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { warmAuthClientModule, ensureSupabaseBrowser } = await import("../lib/authClient");
    warmAuthClientModule();

    await expect(ensureSupabaseBrowser()).resolves.toBe(client);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

describe("the provider asks for it before hydration", () => {
  it("calls the warm at module scope, not inside an effect", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/auth/AuthProvider.tsx", "utf8");

    // The whole gain is WHERE this call sits. Inside a hook or an effect it is
    // discovered after hydration again, which is the defect it fixes.
    const call = source.indexOf("warmAuthClientModule();");
    expect(call, "AuthProvider must warm the auth chunk").toBeGreaterThan(-1);
    const declaration = Math.max(
      source.indexOf("export function AuthProvider("),
      source.indexOf("export default function AuthProvider("),
    );
    expect(call).toBeLessThan(declaration);
  });
});
