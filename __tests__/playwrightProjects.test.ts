import { afterEach, describe, expect, it, vi } from "vitest";

const FIREFOX_PROJECT = "firefox-desktop-map-chrome-fit";
const FIREFOX_OPT_IN = "PW_FIREFOX_DESKTOP_MAP_CHROME_FIT";

type LoadedProject = {
  name?: string;
  testMatch?: unknown;
  testIgnore?: unknown;
};

async function loadProjects(): Promise<LoadedProject[]> {
  vi.resetModules();
  const config = (await import("../playwright.config")).default;
  return (config.projects ?? []) as LoadedProject[];
}

async function loadProjectNames(): Promise<string[]> {
  return (await loadProjects()).map((project) => project.name ?? "");
}

function globsOf(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter((entry): entry is string => typeof entry === "string");
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

  it("never lets a dedicated project's spec run in the default Chromium project", async () => {
    vi.stubEnv("PUBMAX_E2E_LOGIN", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pubmaxx-fence.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_pubmaxx_fence");
    const projects = await loadProjects();
    const ignored = globsOf(
      projects.find((project) => project.name === "chromium")?.testIgnore,
    );
    // A Chromium project that declares its own specs owns them: it exists
    // because those specs need its launch flags, base URL or storage state.
    const dedicated = projects.filter(
      (project) =>
        (project.name ?? "").startsWith("chromium-") &&
        globsOf(project.testMatch).length > 0,
    );

    expect(dedicated.length).toBeGreaterThan(0);
    for (const project of dedicated) {
      for (const glob of globsOf(project.testMatch)) {
        expect(
          ignored,
          `${project.name} owns ${glob}, so the default chromium project must ignore it`,
        ).toContain(glob);
      }
    }
  });
});
