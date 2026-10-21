import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { DEFAULT_PAL_DRAFT, PAL_ONBOARDING_SPECIES } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { uiUxChromiumProjectUse } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

test.use(uiUxChromiumProjectUse(process.env.UI_UX_BROWSER_CHANNEL));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
  test(`${width}px ${theme}: the companion displays its original design in 3D`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: theme });
    await page.addInitScript(value => localStorage.setItem("pubmax-theme", value), theme);
    await page.goto("/pal");
    await expect(page.getByRole("button", { name: "Meet your Pub Pal", exact: true })).toBeVisible();
    const portrait = page.locator(".palPortraitCore");
    await expect(portrait).toHaveCSS("opacity", "1");
    await page.locator(".palMeetingPortrait").scrollIntoViewIfNeeded();
    await expect(page.getByRole("img", { name: /Unclaimed Pub Pal in 3D/ })).toBeVisible();
    await expect(page.locator(".palPortrait canvas")).toBeVisible();
    await mkdir("artifacts/pubpal-complete-1019", { recursive: true });
    await page.screenshot({ path: testInfo.outputPath(`companion-${theme}-${width}.png`) });
    await expect(page.locator(".palPortraitMascot img")).toHaveAttribute("src", /circuit-robin/);
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
    test(`${width}px: ${species} loads its own original model in the owned companion frame`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
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
      const image = portrait.locator(".palPortraitMascot img");
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(image).toHaveAttribute("src", new RegExp(`/pal/circuit-${species}-`));
      await portrait.scrollIntoViewIfNeeded();
      await expect(portrait.getByRole("img", { name: /Portrait audit in 3D/ })).toBeVisible();
      await expect(portrait.locator("canvas")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mkdir("artifacts/pubpal-complete-1019", { recursive: true });
      await page.screenshot({ path: `artifacts/pubpal-complete-1019/companion-${species}-${width}.png` });
      await page.goto("/pal/chat");
      const chatCompanion = page.locator(".palChatCompanion");
      await expect(chatCompanion.getByRole("img", { name: /Portrait audit in 3D/ })).toBeVisible();
      await expect(chatCompanion.locator("canvas")).toBeVisible();
    });
  }
}


test("motion preference changes replace the model with the still original artwork", async ({ page }) => {
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
    if (reducedMotion === "reduce") {
      await expect(page.locator(".palPortrait canvas")).toHaveCount(0);
      await expect(image).toBeVisible();
    } else {
      await expect(page.getByRole("img", { name: /Unclaimed Pub Pal in 3D/ })).toBeVisible();
      await expect(page.locator(".palPortrait canvas")).toBeVisible();
    }
  }
});

test("typed chat follows mute and deletion from another Pal tab", async ({ page, context }) => {
  const timestamp = "2026-10-04T12:00:00.000Z";
  const original = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
    name: "Portrait audit", adultAttestedAt: timestamp,
    appearance: DEFAULT_PAL_DRAFT.appearance,
    personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
    muted: false, hidden: false, proposalPreferences: { memories: true, routes: true },
    masteryPoints: 0, createdAt: timestamp, updatedAt: timestamp,
  };
  let pal: typeof original | null = original;
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await context.route("**/api/pub-pal", async route => {
    if (route.request().method() === "PATCH") pal = { ...pal!, ...route.request().postDataJSON() };
    if (route.request().method() === "DELETE") pal = null;
    await route.fulfill({ json: { pal, adultOnFile: true } });
  });
  await context.route("**/api/pub-pal/memories", route => route.fulfill({ json: { memories: [] } }));
  await context.route("**/api/pub-pal/voice-token", route => route.fulfill({ json: { available: false } }));
  await page.goto("/pal/chat");
  const companion = page.locator(".palChatCompanion");
  await expect(companion.getByRole("img", { name: /Portrait audit in 3D/ })).toBeVisible();
  const home = await context.newPage();
  try {
    await installAuthDoubles(home);
    await home.goto("/pal");
    const mute = home.getByRole("button", { name: /Voice allowed.*Tap to mute everywhere/ });
    await expect(mute).toBeVisible();
    await mute.click();
    await expect(home.getByRole("button", { name: /Muted.*Tap to allow voice/ })).toHaveAttribute("aria-pressed", "true");
    await page.bringToFront();
    await expect(companion.locator(".palPortrait")).toHaveAttribute("data-pal-state", "sleeping");
    await home.bringToFront();
    home.once("dialog", dialog => dialog.accept());
    await home.getByRole("button", { name: /^Delete Portrait audit/ }).click();
    await expect(home.getByRole("button", { name: "Meet your Pub Pal", exact: true })).toBeVisible();
    await page.bringToFront();
    await expect(companion.getByRole("img", { name: /Pub Pal in 3D/ })).toBeVisible();
    await expect(companion.getByRole("img", { name: /Portrait audit in 3D/ })).toHaveCount(0);
  } finally { await home.close(); }
});
