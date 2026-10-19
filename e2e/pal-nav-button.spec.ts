import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// The Pub Pal's own door (components/nav/PalNavButton.tsx): raised out of the
// phone dock between Tonight and Plan, and a named button in the desktop bar.
// Shots land in artifacts/pal-nav-button/ (gitignored).

const SHOTS = "artifacts/pal-nav-button";

async function seed(page: Page, { theme, withPal }: { theme: "light" | "dark"; withPal: boolean }): Promise<void> {
  // The door wears a stored Pal only for the account that owns it, so the
  // person with a Pal is signed in as account A.
  if (withPal) {
    await installAuthDoubles(page);
    const now = "2026-10-04T12:00:00.000Z";
    const serverPal = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id, name: "Ripley",
      adultAttestedAt: now, ...DEFAULT_PAL_DRAFT, muted: false, hidden: false,
      proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    };
    await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal: serverPal, adultOnFile: true } }));
    await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  }
  await page.addInitScript(({ theme: chosen, withPal: seeded, ownerId, appearance, personality, voice }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax-theme", chosen);
    if (seeded) {
      window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId, name: "Ripley",
        adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: false,
        proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
      }));
    }
  }, { theme, withPal, ownerId: ACCOUNTS.A.id, ...DEFAULT_PAL_DRAFT });
  if (withPal) await seedSignedIn(page, "A");
}

for (const width of [320, 390]) {
  for (const theme of ["light", "dark"] as const) {
    for (const withPal of [false, true]) {
      test(`the phone dock raises the Pal at ${width}px, ${theme}, ${withPal ? "with a Pal" : "a stranger"}`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 700 });
        await seed(page, { theme, withPal });
        await page.goto("/tonight");

        const dock = page.getByRole("navigation", { name: "Primary" });
        await expect(dock).toBeVisible({ timeout: 60_000 });
        const links = dock.getByRole("link");
        await expect(links).toHaveText(["Map", "Tonight", "Pal", "Plan", "Social", "You"]);
        const door = dock.getByRole("link", { name: withPal ? "Pub Pal, Ripley" : "Pub Pal", exact: true });
        await expect(door).toBeVisible();
        if (withPal) {
          await expect.poll(() => door.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        } else {
          await expect(door.locator("img")).toHaveCount(0);
        }

        // The face rises out of the rail, sits between Tonight and Plan, and
        // the row never pushes the page sideways.
        const rail = (await page.locator(".mobileTabList").boundingBox())!;
        const face = (await door.locator(".palNavFace").boundingBox())!;
        const tonight = (await dock.getByRole("link", { name: "Tonight", exact: true }).boundingBox())!;
        const plan = (await dock.getByRole("link", { name: "Plan", exact: true }).boundingBox())!;
        expect(face.y).toBeLessThan(rail.y);
        expect(face.x).toBeGreaterThan(tonight.x + tonight.width / 2);
        expect(face.x + face.width).toBeLessThan(plan.x + plan.width / 2);
        const doorBox = (await door.boundingBox())!;
        expect(Math.min(doorBox.width, doorBox.height)).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

        await page.waitForTimeout(600);
        await mkdir(SHOTS, { recursive: true });
        await page.screenshot({
          path: `${SHOTS}/dock-${width}-${theme}-${withPal ? "pal" : "stranger"}.png`,
          clip: { x: 0, y: Math.max(0, rail.y - 40), width, height: 700 - Math.max(0, rail.y - 40) },
        });

        await door.click();
        await expect(page).toHaveURL(/\/pal$/);
        await expect(dock.getByRole("link", { name: withPal ? "Pub Pal, Ripley" : "Pub Pal", exact: true })).toHaveAttribute("aria-current", "page");
      });
    }
  }
}

test("the desktop bar names the person's Pal and opens /pal", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await seed(page, { theme: "light", withPal: true });
  await page.goto("/tonight");
  const bar = page.getByRole("navigation", { name: "Site navigation" });
  const door = bar.getByRole("link", { name: "Pub Pal, Ripley", exact: true });
  await expect(door).toBeVisible({ timeout: 60_000 });
  await expect(door).toHaveText("Ripley");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  const box = (await bar.boundingBox())!;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/desktop-1280.png`, clip: { x: 0, y: box.y, width: 1280, height: box.height + 8 } });
  await door.click();
  await expect(page).toHaveURL(/\/pal$/);
});
