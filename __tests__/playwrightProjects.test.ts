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
    // The config demands a whole Supabase environment before it will register
    // the signed-in project. These stand-ins are never dialled: the config is
    // read as a value here, not run.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pubmaxx-fence.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_pubmaxx_fence");
    vi.stubEnv("SUPABASE_URL", "https://pubmaxx-fence.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_pubmaxx_fence");
    // A Chromium project that declares its own specs owns them: it exists
    // because those specs need its launch flags, base URL or storage state.
    // Some register only behind an environment flag, so both environments are
    // read and the union is fenced.
    const ignored: string[] = [];
    const dedicated: LoadedProject[] = [];
    for (const login of ["", "1"]) {
      vi.stubEnv("PUBMAX_E2E_LOGIN", login);
      const projects = await loadProjects();
      ignored.push(
        ...globsOf(projects.find((project) => project.name === "chromium")?.testIgnore),
      );
      dedicated.push(
        ...projects.filter(
          (project) =>
            (project.name ?? "").startsWith("chromium-") &&
            globsOf(project.testMatch).length > 0,
        ),
      );
    }

    expect(dedicated.map((project) => project.name)).toContain(
      "chromium-authenticated",
    );
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
