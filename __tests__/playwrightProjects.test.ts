import { afterEach, describe, expect, it, vi } from "vitest";

const FIREFOX_PROJECT = "firefox-desktop-map-chrome-fit";
const FIREFOX_OPT_IN = "PW_FIREFOX_DESKTOP_MAP_CHROME_FIT";

async function loadProjectNames(): Promise<string[]> {
  vi.resetModules();
  const config = (await import("../playwright.config")).default;
  return (config.projects ?? []).map((project) => project.name ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Playwright project registration", () => {
  it("keeps targeted Firefox coverage outside the default Chromium suite", async () => {
    vi.stubEnv(FIREFOX_OPT_IN, "");
    expect(await loadProjectNames()).not.toContain(FIREFOX_PROJECT);

    vi.stubEnv(FIREFOX_OPT_IN, "1");
    expect(await loadProjectNames()).toContain(FIREFOX_PROJECT);
  });

  it("runs tile and WebGL recovery only in the project that blocks service workers", async () => {
    const config = (await import("../playwright.config")).default;
    const chromium = config.projects?.find((project) => project.name === "chromium");
    const gl = config.projects?.find((project) => project.name === "chromium-gl");
    expect(gl?.use?.serviceWorkers).toBe("block");
    for (const file of ["**/map-tile-retry.spec.ts", "**/map-webgl-recovery.spec.ts"]) {
      expect(chromium?.testIgnore).toContain(file);
      expect(gl?.testMatch).toContain(file);
    }
  });

  it("keeps host provider and database credentials out of both keyless browser servers", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-provider-key");
    vi.stubEnv("SUPABASE_URL", "https://production.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    vi.stubEnv("PUBMAX_E2E_LOGIN", "0");
    vi.stubEnv("PW_SKIP_WEBSERVER", "");
    vi.stubEnv("PW_SKIP_KEYLESS_WEBSERVER", "");
    vi.stubEnv("PW_SCREENSHOTS", "");
    vi.stubEnv(FIREFOX_OPT_IN, "");
    const config = (await import("../playwright.config")).default;
    const servers = Array.isArray(config.webServer) ? config.webServer : [];
    const keyless = servers.filter((server) => server.env?.PUBMAX_E2E_KEYLESS === "1");
    expect(keyless).toHaveLength(2);
    for (const server of keyless) {
      expect(server.env?.OPENROUTER_API_KEY).toBe("");
      expect(server.env?.SUPABASE_URL).toBe("");
      expect(server.env?.SUPABASE_SERVICE_ROLE_KEY).toBe("");
    }
  });
});
