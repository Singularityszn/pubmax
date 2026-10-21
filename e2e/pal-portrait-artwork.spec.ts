import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { DEFAULT_PAL_DRAFT, PAL_ONBOARDING_SPECIES } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

async function seedOwnedPortrait(page: Page, species = DEFAULT_PAL_DRAFT.appearance.species) {
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
}

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
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: theme });
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
    test(`${width}px: ${species} loads its original model in the owned companion frame`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await seedOwnedPortrait(page, species);
      await page.goto("/pal");
      await expect(page.getByRole("heading", { name: "Portrait audit", exact: true })).toBeVisible();
      const portrait = page.locator(".palHomePortrait");
      await expect(portrait.locator(".palPortraitCore")).toHaveCSS("opacity", "1");
      const image = portrait.getByRole("img", { name: "Pub Pal", exact: true });
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(image).toHaveAttribute("src", new RegExp(`/pal/circuit-${species}-`));
      const model = portrait.getByRole("img", { name: /Portrait audit in 3D/ });
      await expect(model).toBeVisible();
      await expect(portrait.locator("canvas")).toBeVisible();
      await expect(image).toBeHidden();
      await portrait.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mkdir("artifacts/pubpal-complete-1019", { recursive: true });
      await page.screenshot({ path: `artifacts/pubpal-complete-1019/companion-${species}-${width}.png` });
    });
  }
}


test("motion preference changes retain the original artwork without a replacement canvas", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal");
  const portrait = page.locator(".palPortraitCore");
  const image = portrait.getByRole("img", { name: "Pub Pal", exact: true });
  await expect(image).toBeVisible();
  const rendition = await image.getAttribute("src");
  for (const reducedMotion of ["no-preference", "reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    await expect(portrait).toHaveCSS("opacity", "1");
    await expect(image).toHaveAttribute("src", rendition!);
    await expect(page.locator(".palPortrait canvas")).toHaveCount(0);
  }
});


test("the owned real model restores its original portrait after graphics loss and motion changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await seedOwnedPortrait(page);
  await page.goto("/pal");
  const portrait = page.locator(".palHomePortrait");
  const model = portrait.getByRole("img", { name: /Portrait audit in 3D/ });
  const image = portrait.getByRole("img", { name: "Pub Pal", exact: true });
  await expect(model).toBeVisible();
  await model.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Home");
  await expect(model).toBeFocused();
  await portrait.locator("canvas").evaluate(canvas => {
    const context = (canvas as HTMLCanvasElement).getContext("webgl2");
    const extension = context?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("The real graphics context must support the loss probe");
    extension.loseContext();
  });
  await expect(image).toBeVisible();
  await expect(model).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(portrait.locator("canvas")).toHaveCount(0);
  await expect(image).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(model).toBeVisible();
  await expect(image).toBeHidden();
});
