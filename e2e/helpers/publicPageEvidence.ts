import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, type Page, type Response, type TestInfo } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing public evidence setting: ${name}`);
  return value;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

export type PublicEvidenceFeature = "feedback" | "updates" | "food-menu-discovery";
export type PublicEvidenceFile =
  | `page-${390 | 768 | 1440}.png`
  | `account-${390 | 768 | 1440}.png`;

export interface PublicEvidenceSession {
  readonly phase: "before" | "after";
  capture(file: PublicEvidenceFile, response: Response): Promise<void>;
  finish(): Promise<void>;
}

/** Bind one signed-out public scenario to its separately checked-out source. */
export async function beginPublicEvidence(
  page: Page,
  testInfo: TestInfo,
  feature: PublicEvidenceFeature,
): Promise<PublicEvidenceSession> {
  const phase = requiredEnv("PUBMAX_PUBLIC_EVIDENCE_PHASE");
  if (phase !== "before" && phase !== "after") throw new Error("Unknown evidence phase");
  const sourceRoot = realpathSync(requiredEnv("PUBMAX_PUBLIC_EVIDENCE_ROOT"));
  const expectedSha = requiredEnv("PUBMAX_PUBLIC_EVIDENCE_SHA");
  const publishedHead = requiredEnv("PUBMAX_PUBLIC_EVIDENCE_HEAD");
  const baseSha = requiredEnv("PUBMAX_PUBLIC_EVIDENCE_BASE");
  for (const sha of [expectedSha, publishedHead, baseSha]) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Evidence requires full Git SHAs");
  }
  expect(expectedSha).toBe(phase === "after" ? publishedHead : baseSha);
  expect(git(sourceRoot, "rev-parse", "--show-toplevel")).toBe(sourceRoot);
  const sourceGitSha = git(sourceRoot, "rev-parse", "HEAD");
  expect(sourceGitSha).toBe(expectedSha);
  expect(git(sourceRoot, "status", "--porcelain", "--untracked-files=no")).toBe("");

  const baseURL = new URL(String(testInfo.project.use.baseURL));
  expect(["localhost", "127.0.0.1"]).toContain(baseURL.hostname);
  expect(baseURL.protocol).toBe("http:");
  const versionResponse = await page.request.get(new URL("/api/version", baseURL).href);
  expect(versionResponse.ok()).toBe(true);
  const version: { gitCommitSha?: string } = await versionResponse.json();
  expect(version.gitCommitSha).toBe(expectedSha);

  // The public proof neither signs in nor contacts a remote provider.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL.origin || ["data:", "blob:"].includes(url.protocol)) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const output = resolve(requiredEnv("PUBMAX_PUBLIC_EVIDENCE_OUTPUT"));
  await mkdir(output, { recursive: true });
  const captures: Array<{
    file: string;
    route: string;
    width: number;
    height: number;
    status: number;
    sha256: string;
  }> = [];
  const expectedFiles: PublicEvidenceFile[] = [390, 768, 1440].flatMap((width) =>
    (feature === "food-menu-discovery" ? ["page"] : ["account", "page"])
      .map((name) => `${name}-${width}.png` as PublicEvidenceFile),
  );
  let finished = false;
  return {
    phase,
    async capture(file, response) {
      if (finished) throw new Error("Public evidence session already finished");
      expect(expectedFiles).toContain(file);
      expect(captures.some((capture) => capture.file === file)).toBe(false);
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("Public evidence requires an explicit viewport");
      expect(file.endsWith(`-${viewport.width}.png`)).toBe(true);
      const currentUrl = new URL(page.url());
      expect(currentUrl.origin).toBe(baseURL.origin);
      expect(response.request().isNavigationRequest()).toBe(true);
      expect(response.request().frame()).toBe(page.mainFrame());
      expect(response.url()).toBe(currentUrl.href);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const bytes = await page.screenshot({ path: join(output, file), fullPage: true, animations: "disabled" });
      captures.push({
        file,
        route: `${currentUrl.pathname}${currentUrl.search}`,
        ...viewport,
        status: response.status(),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
    async finish() {
      if (finished) throw new Error("Public evidence session already finished");
      expect(captures.map((capture) => capture.file).sort()).toEqual([...expectedFiles].sort());
      expect(git(sourceRoot, "rev-parse", "HEAD")).toBe(expectedSha);
      expect(git(sourceRoot, "status", "--porcelain", "--untracked-files=no")).toBe("");
      const finalVersionResponse = await page.request.get(new URL("/api/version", baseURL).href);
      expect(finalVersionResponse.ok()).toBe(true);
      const finalVersion: { gitCommitSha?: string } = await finalVersionResponse.json();
      expect(finalVersion.gitCommitSha).toBe(expectedSha);
      const configPath = testInfo.config.configFile;
      if (!configPath) throw new Error("Public evidence requires the repository Playwright config");
      const config = await readFile(configPath);
      await writeFile(join(output, "identity.json"), JSON.stringify({
        feature,
        phase,
        sourceGitSha,
        servedGitCommitSha: version.gitCommitSha,
        finalServedGitCommitSha: finalVersion.gitCommitSha,
        publishedHead,
        immutableBase: baseSha,
        driverGitSha: git(dirname(configPath), "rev-parse", "HEAD"),
        configSha256: createHash("sha256").update(config).digest("hex"),
        nodeVersion: process.version,
        browserVersion: page.context().browser()?.version(),
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        signedOut: true,
        serverMode: "keyless",
        externalRequests: "blocked",
        colorScheme: "light",
        captures,
      }, null, 2) + "\n");
      finished = true;
    },
  };
}

/** Capture only signed-out public pages from the separately checked-out source. */
export async function capturePublicPageEvidence(
  page: Page,
  testInfo: TestInfo,
  feature: "feedback" | "updates",
): Promise<void> {
  const evidence = await beginPublicEvidence(page, testInfo, feature);
  const { phase } = evidence;
  const linkName = feature === "feedback" ? "Send feedback" : "Updates";
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of ["/u/you", `/${feature}`]) {
      const response = await page.goto(route);
      expect(response).not.toBeNull();
      const expectedStatus = phase === "before" && route !== "/u/you" ? 404 : 200;
      expect(response!.status()).toBe(expectedStatus);
      if (route === "/u/you") {
        await expect(page.getByRole("heading", { name: "Claim your @handle." })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Privacy, terms and support", exact: true })).toBeVisible();
        const link = page.getByRole("link", { name: linkName, exact: true });
        if (phase === "after") await expect(link).toBeVisible();
        else await expect(link).toHaveCount(0);
      } else if (phase === "after") {
        await expect(page.getByRole("heading", {
          name: feature === "feedback" ? "Tell us what needs a fix." : "What's changed",
          exact: true,
        })).toBeVisible();
        if (feature === "feedback") {
          const target = new URL((await page.getByRole("link", { name: "Open email draft", exact: true }).getAttribute("href"))!);
          expect(target.protocol).toBe("mailto:");
          expect([...target.searchParams]).toEqual([["subject", "PUBMAXX feedback"]]);
          expect(target.hash).toBe("");
        }
      }
      await evidence.capture(`${route === "/u/you" ? "account" : "page"}-${viewport.width}.png` as PublicEvidenceFile, response!);
    }
  }
  await evidence.finish();
}
