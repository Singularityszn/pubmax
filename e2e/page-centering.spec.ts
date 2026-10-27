import { expect, test, type Locator, type Page } from "@playwright/test";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectLayoutSettled } from "./helpers/layoutSettled";
import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";
import { expectStreamedPageSettled } from "./helpers/streamedPage";

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function restingBox(locator: Locator) {
  await expectLayoutSettled(locator);
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function expectCentred(locator: Locator, viewportWidth: number, expectedWidth: number) {
  const box = await restingBox(locator);
  expect(Math.abs(box.x - (viewportWidth - box.x - box.width)), "equal space on both sides").toBeLessThanOrEqual(2);
  expect(box.width, "the readable content width").toBeCloseTo(expectedWidth, 0);
  return box;
}

async function seedReturningPal(page: Page) {
  const timestamp = "2026-10-27T12:00:00.000Z";
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: {
    adultOnFile: true,
    pal: {
      ...DEFAULT_PAL_DRAFT,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ownerId: ACCOUNTS.A.id,
      name: "Ripley",
      adultAttestedAt: timestamp,
      muted: false,
      hidden: false,
      proposalPreferences: { memories: true, routes: true },
      masteryPoints: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  } }));
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pub-pal/voice-token", (route) => route.fulfill({ json: { available: false } }));
}

for (const { width, planWidth, pageWidth } of [
  { width: 390, planWidth: 346, pageWidth: 346 },
  { width: 768, planWidth: 640, pageWidth: 704 },
  { width: 1309, planWidth: 640, pageWidth: 1176 },
  { width: 1440, planWidth: 640, pageWidth: 1176 },
  { width: 1920, planWidth: 640, pageWidth: 1176 },
]) {
  test(`Plan keeps its import, field and guide in one centred column at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/plan");
    await expectStreamedPageSettled(page);
    const field = describeFirstQuery(page);
    await expect(field).toBeEditable();
    await page.evaluate(() => document.fonts.ready);

    const intro = await expectCentred(page.getByRole("region", { name: "Plan a pub crawl", exact: true }), width, planWidth);
    const heading = await restingBox(page.getByRole("heading", { name: "Plan a pub crawl", exact: true }));
    const input = await restingBox(field);
    const submit = await restingBox(describeFirstSubmit(page));
    const importButton = await restingBox(page.getByRole("button", { name: "Import a pub list", exact: true }));
    for (const box of [heading, input, submit, importButton]) {
      expect(box.x, "each part starts at the same reading edge").toBeCloseTo(intro.x, 0);
    }
    expect(input.width).toBeCloseTo(planWidth, 0);
    expect(input.y).toBeGreaterThanOrEqual(heading.y + heading.height);
    expect(submit.y).toBeGreaterThanOrEqual(input.y + input.height);

    const guide = page.getByRole("button", { name: "Step by step", exact: true });
    await expect(guide).not.toHaveAttribute("aria-disabled", "true");
    await guide.click();
    await expectCentred(page.locator(".planIntake"), width, planWidth);
  });

  for (const returning of [false, true]) {
    test(`Pub Pal keeps the ${returning ? "returning" : "meeting"} content centred at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      if (returning) await seedReturningPal(page);
      await page.goto("/pal");
      await expectStreamedPageSettled(page);
      await expect(page.getByRole("heading", { name: returning ? "Ripley" : "Plan your night with Pub Pal", exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectCentred(page.locator(returning ? ".palHomeHero" : ".palMeetingStage"), width, pageWidth);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }

  for (const { path, selector } of [
    { path: "/", selector: ".lpHero" },
    { path: "/today", selector: ".todayScreen" },
    { path: "/tonight", selector: ".tonightPage" },
    { path: "/social", selector: ".socialPage" },
    { path: "/messages", selector: ".messagesMain" },
    { path: "/u/you", selector: ".profileMain" },
  ]) {
    test(`${path} keeps its main content balanced without horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(path);
      await expectStreamedPageSettled(page);
      await page.evaluate(() => document.fonts.ready);
      const box = await restingBox(page.locator(selector));
      expect(Math.abs(box.x - (width - box.x - box.width)), "equal space on both sides").toBeLessThanOrEqual(2);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }
}
