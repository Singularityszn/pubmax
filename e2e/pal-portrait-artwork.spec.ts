import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { DEFAULT_PAL_DRAFT, PAL_ONBOARDING_SPECIES } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
  test(`${width}px ${theme}: the companion keeps its original artwork`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.addInitScript(value => localStorage.setItem("pubmax-theme", value), theme);
    await page.goto("/pal");
    await expect(page.getByRole("button", { name: "Meet your Pub Pal", exact: true })).toBeVisible();
    const portrait = page.locator(".palPortraitCore");
    await expect(portrait).toHaveCSS("opacity", "1");
    await expect(page.locator(".palPortrait canvas")).toHaveCount(0);
    await page.locator(".palMeetingPortrait").scrollIntoViewIfNeeded();
    await mkdir("artifacts/pubpal-complete-1019", { recursive: true });
    await page.screenshot({ path: testInfo.outputPath(`companion-${theme}-${width}.png`) });
    await expect(page.getByRole("img", { name: "Pub Pal", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  }
}

test("reduced motion keeps the still portrait and loads no model canvas", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal");
  await expect(page.getByRole("button", { name: "Meet your Pub Pal", exact: true })).toBeVisible();
  await expect(page.locator(".palPortraitCore")).toHaveCSS("opacity", "1");
  await expect(page.locator(".palPortrait canvas")).toHaveCount(0);
});

for (const width of [390, 1440]) {
  for (const species of PAL_ONBOARDING_SPECIES) {
    test(`${width}px: ${species} keeps its original artwork in the owned companion frame`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const timestamp = "2026-10-04T12:00:00.000Z";
      await installAuthDoubles(page);
      await seedSignedIn(page, "A");
      await page.route("**/api/pub-pal", (route) => route.fulfill({ json: {
        adultOnFile: true,
        pal: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
          name: "Portrait audit", adultAttestedAt: timestamp,
          appearance: { ...DEFAULT_PAL_DRAFT.appearance, species },
          personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
          muted: false, hidden: false, proposalPreferences: { memories: true, routes: true },
          masteryPoints: 0, createdAt: timestamp, updatedAt: timestamp,
        },
      } }));
      await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
      await page.route("**/api/pub-pal/voice-token", (route) => route.fulfill({ json: { available: false } }));
      await page.goto("/pal");
      await expect(page.getByRole("heading", { name: "Portrait audit", exact: true })).toBeVisible();
      const portrait = page.locator(".palHomePortrait");
      await expect(portrait.locator(".palPortraitCore")).toHaveCSS("opacity", "1");
      const image = portrait.getByRole("img", { name: "Pub Pal", exact: true });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(image).toHaveAttribute("src", new RegExp(`/pal/circuit-${species}-`));
      await expect(portrait.locator("canvas")).toHaveCount(0);
      await portrait.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mkdir("artifacts/pubpal-complete-1019", { recursive: true });
      await page.screenshot({ path: `artifacts/pubpal-complete-1019/companion-${species}-${width}.png` });
    });
  }
}


test("motion preference changes retain the decoded original and switch between mesh and still artwork", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal");
  const portrait = page.locator(".palPortraitCore");
  const image = portrait.locator('img[alt="Pub Pal"]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const rendition = await image.getAttribute("src");
  for (const reducedMotion of ["no-preference", "reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    await expect(portrait).toHaveCSS("opacity", "1");
    await expect(image).toHaveAttribute("src", rendition!);
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const model = page.locator(".palMeetingPortrait [data-pal-model-host]");
    if (reducedMotion === "no-preference") {
      await expect(model).toHaveAttribute("data-model-state", "ready");
      await expect(page.locator(".palPortrait canvas")).toBeVisible();
    } else {
      await expect(image).toBeVisible();
      await expect(page.locator(".palPortrait canvas")).toHaveCount(0);
    }
  }
});
