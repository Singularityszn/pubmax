import { afterEach, describe, expect, it, vi } from "vitest";

const FIREFOX_PROJECT = "firefox-desktop-map-chrome-fit";
const FIREFOX_OPT_IN = "PW_FIREFOX_DESKTOP_MAP_CHROME_FIT";
// A Chromium project that owns its specs because they need its own browser
// flags, base URL or storage state. The cross-browser opt-in projects are
// deliberately shared with the default project, so they stay off this list.
const DEDICATED_CHROMIUM_PROJECTS = [
  "chromium-cwv",
  "chromium-gl",
  "chromium-sw-gl",
  "chromium-no-gl",
  "chromium-keyless",
  "chromium-real-auth",
  "chromium-authenticated",
];
// Every dedicated project but the one that needs a seeded login to register.
const ALWAYS_REGISTERED_DEDICATED = DEDICATED_CHROMIUM_PROJECTS.filter(
  (name) => name !== "chromium-authenticated",
);

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
    const dedicated = projects.filter((project) =>
      DEDICATED_CHROMIUM_PROJECTS.includes(project.name ?? ""),
    );

    expect(dedicated.map((project) => project.name)).toEqual(
      expect.arrayContaining(ALWAYS_REGISTERED_DEDICATED),
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

  it("leaves CI at Playwright's default worker count and caps the local rig at two", async () => {
    vi.stubEnv("CI", "true");
    vi.resetModules();
    const onCi = (await import("../playwright.config")).default;
    expect(onCi.workers).toBeUndefined();
    expect(onCi.retries).toBe(1);
    expect(onCi.timeout).toBe(30_000);
    expect(onCi.expect).toMatchObject({ timeout: 10_000 });

    vi.stubEnv("CI", "");
    vi.resetModules();
    const local = (await import("../playwright.config")).default;
    expect(local.workers).toBe(2);
    expect(local.retries).toBe(0);
    expect(local.timeout).toBe(30_000);
  });
});
