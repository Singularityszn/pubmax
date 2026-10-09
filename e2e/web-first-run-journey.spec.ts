import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  LANDING_FIRST_RUN_HREF,
  LANDING_PRIMARY_HREF,
  LANDING_PRIMARY_NAME,
} from "./helpers/landingHero";

// The first-run journey on the web (lib/onboardingFlow.ts). A browser reaches
// it only from the landing hero's primary, which a first-time visitor's tap
// points at the journey; a returning visitor's tap and every deep link go
// straight to their target, and a typed or shared URL is still turned away at
// the edge (__tests__/onboardingWebDocument.test.ts). The native shell's own
// arrival is covered in e2e/mobile-first-run-onboarding.spec.ts.

const SIZES = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - window.innerWidth,
    document.body.scrollWidth - window.innerWidth,
  ))).toBeLessThanOrEqual(1);
}

async function expectTouchTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function saveShot(page: Page, name: string): Promise<void> {
  if (!process.env.PUBMAX_RESET_SHOTS) return;
  await mkdir("docs/screenshots/onboarding", { recursive: true });
  await writeFile(`docs/screenshots/onboarding/${name}.png`, await page.screenshot({ fullPage: false }));
}

function heroPrimary(page: Page): Locator {
  return page.locator(".lpHero [data-primary-action]").getByRole("link", { name: LANDING_PRIMARY_NAME });
}

/** Arrive the way a first-time visitor does: a fresh browser taps the landing hero's primary. */
async function openJourneyFromTheApp(page: Page): Promise<void> {
  await page.goto("/");
  const primary = heroPrimary(page);
  await expect(primary).toHaveAttribute("href", LANDING_FIRST_RUN_HREF, { timeout: 30_000 });
  await primary.click();
  await expect(page).toHaveURL(/\/onboarding\?start=web$/);
  await expect(page.getByRole("heading", { name: "London is ready." })).toBeVisible({ timeout: 30_000 });
}

for (const size of SIZES) {
  test(`the web journey asks why, answers from a patch and lands on the plan at ${size.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openJourneyFromTheApp(page);
    await expectNoHorizontalOverflow(page);
    await saveShot(page, `web-1-london-${size.name}`);

    await page.getByRole("button", { name: "Use London" }).click();
    await expect(page.getByRole("heading", { name: "What's a fair pint to you?" })).toBeVisible();
    await expect(page.getByText("We use this to count the pubs near you that come in under it.")).toBeVisible();
    await expect(page.getByText("Only you see your answer. It stays on this device.")).toBeVisible();
    const next = page.getByRole("button", { name: "Continue" });
    await expect(next).toBeDisabled();
    await saveShot(page, `web-2-budget-${size.name}`);
    const six = page.getByRole("button", { name: "£6 or less" });
    await expectTouchTarget(six);
    await six.click();
    await expect(six).toHaveAttribute("aria-pressed", "true");
    await expect(next).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pubmax:onboarding:budget:v1"))).toBe("six");
    await saveShot(page, `web-3-budget-chosen-${size.name}`);
    await next.click();

    // The location ask has its own screen and its own reason, and nothing has
    // asked the browser yet.
    await expect(page.getByRole("heading", { name: "Find the cheapest pint near you." })).toBeVisible();
    await expect(page.getByText("We only use it to rank pubs nearby. Your location is never stored.")).toBeVisible();
    await expectTouchTarget(page.getByRole("button", { name: "Use my location" }));
    await saveShot(page, `web-4-location-${size.name}`);

    await page.getByRole("button", { name: "Pick a London patch instead" }).click();
    await saveShot(page, `web-5-patches-${size.name}`);
    await page.getByRole("button", { name: "Soho" }).click();

    const confirm = page.getByRole("button", { name: "That looks right" });
    await expect(confirm).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^£\d+\.\d{2} at .+\.$/);
    await expect(page.getByText(/Cheapest listed around Soho|Nearest priced pubs around Soho/)).toBeVisible();
    await expect(page.getByText(/pubs? within a \d+ minute walk comes? in at £6 or less\./)).toBeVisible();
    await expect(page.getByText(/Pub list refreshed/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await saveShot(page, `web-6-result-${size.name}`);

    await confirm.click();
    await expect(page.getByRole("heading", { name: "Pick your Pub Pal." })).toBeVisible();
    const progress = page.getByRole("progressbar", { name: "Onboarding progress" });
    await expect(progress).toHaveAttribute("aria-valuenow", "5");
    await expect(progress).toHaveAttribute("aria-valuemax", "5");
    await saveShot(page, `web-7-companion-${size.name}`);

    await page.getByRole("button", { name: "Plan my night" }).click();
    await expect(page).toHaveURL(/\/map\?plan=1$/);
  });
}

test.describe("with location allowed", () => {
  test.use({ geolocation: { latitude: 51.5136, longitude: -0.1365 }, permissions: ["geolocation"] });

  test("answers from where the reader stands", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openJourneyFromTheApp(page);
    await page.getByRole("button", { name: "Use London" }).click();
    await page.getByRole("button", { name: "No limit" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Use my location" }).click();

    await expect(page.getByRole("button", { name: "That looks right" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Cheapest listed near you|Nearest priced pubs near you/)).toBeVisible();
    // No limit, so no count is made.
    await expect(page.getByText(/come in at/)).toHaveCount(0);
  });
});

test.describe("with location refused", () => {
  test("says so in plain words and offers the patches", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (_ok: unknown, fail: (e: { code: number; PERMISSION_DENIED: number }) => void) =>
            fail({ code: 1, PERMISSION_DENIED: 1 }),
        },
      });
    });
    await openJourneyFromTheApp(page);
    await page.getByRole("button", { name: "Use London" }).click();
    await page.getByRole("button", { name: "£7 or less" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Use my location" }).click();

    await expect(page.getByText("No location, no problem. Pick where you're drinking.")).toBeVisible();
    await expect(page.getByRole("group", { name: /pick where you.re drinking/i })).toBeVisible();
  });
});

test("on a short phone each step opens at the top with the progress bar and Skip in view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openJourneyFromTheApp(page);
  const useLondon = page.getByRole("button", { name: "Use London" });
  const stage = page.locator(".firstRunStage");
  await expect(useLondon).toBeInViewport({ ratio: 1 });
  await page.locator(".firstRunAreaList article").last().scrollIntoViewIfNeeded();
  await expect.poll(() => stage.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(useLondon).toBeInViewport({ ratio: 1 });
  await useLondon.click();

  await expect(page.getByRole("heading", { name: "What's a fair pint to you?" })).toBeVisible();
  await expect.poll(() => stage.evaluate((node) => node.scrollTop)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("progressbar", { name: "Onboarding progress" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Skip" })).toBeInViewport({ ratio: 1 });
});

test("a typed visit is still turned away, and the start mark alone does not let a stranger in", async ({ page }) => {
  await page.goto("/onboarding?start=web");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "London is ready." })).toHaveCount(0);
});

test("a web visit without the start mark returns home and writes nothing", async ({ page }) => {
  await page.goto("/about");
  // A same-origin document navigation, which is what the edge lets through.
  await page.evaluate(() => window.location.assign(new URL("/onboarding", window.location.href).href));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "London is ready." })).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("pubmax:onboarding:budget:v1"))).toBeNull();
});

test("Skip records the mark and lands where the hero was going, which a returning visitor then takes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: () => {} },
    });
  });
  await openJourneyFromTheApp(page);
  await page.getByRole("button", { name: "Skip" }).click();

  await expect(page).toHaveURL(/\/near\?locate=1(?:&patch=[^&]+)?$/);
  expect(await page.evaluate(() => window.localStorage.getItem("pubmax-tour-v2-done"))).toBe("1");

  // Back on the landing, the mark sends the same tap straight to /near. The
  // hydrated door is pinned in __tests__/landingPrimaryDoor.test.tsx.
  await page.goto("/");
  await expect(heroPrimary(page)).toHaveAttribute("href", LANDING_PRIMARY_HREF);
  await heroPrimary(page).click();
  await expect(page).toHaveURL(/\/near\?locate=1(?:&patch=[^&]+)?$/);
  await expect(page.getByRole("heading", { name: "London is ready." })).toHaveCount(0);
});

test("a first-time visitor's deep link goes straight to its target", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: () => {} },
    });
  });
  await page.goto("/near?patch=soho&locate=1");
  await expect(page).toHaveURL(/\/near\?patch=soho&locate=1/);
  await expect(page.locator(".nmnCard").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "London is ready." })).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("pubmax-tour-v2-done"))).toBeNull();
});
