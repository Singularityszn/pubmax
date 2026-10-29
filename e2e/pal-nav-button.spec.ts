import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// The Pub Pal's own door (components/nav/PalNavButton.tsx) sits between Tonight
// and Plan, inside narrow phone cells and raised above wider phone rails.
// Shots land in artifacts/pal-nav-button/ (gitignored).

const SHOTS = "artifacts/pal-nav-button";

async function seed(
  page: Page,
  { theme, withPal, name = "Ripley" }: { theme: "light" | "dark"; withPal: boolean; name?: string },
): Promise<void> {
  // The door wears a stored Pal only for the account that owns it, so the
  // person with a Pal is signed in as account A.
  if (withPal) {
    await installAuthDoubles(page);
    const now = "2026-10-04T12:00:00.000Z";
    const serverPal = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
      adultAttestedAt: now, ...DEFAULT_PAL_DRAFT, name, muted: false, hidden: false,
      proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    };
    await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal: serverPal, adultOnFile: true } }));
    await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  }
  await page.addInitScript(({ theme: chosen, withPal: seeded, ownerId, name: palName, appearance, personality, voice }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax-theme", chosen);
    if (seeded) {
      window.localStorage.setItem("pubmax_account_owner", ownerId);
      window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId, name: palName,
        adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: false,
        proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
      }));
    }
  }, { theme, withPal, ownerId: ACCOUNTS.A.id, ...DEFAULT_PAL_DRAFT, name });
  if (withPal) await seedSignedIn(page, "A");
}

for (const width of [320, 390]) {
  for (const theme of ["light", "dark"] as const) {
    for (const withPal of [false, true]) {
      test(`the phone dock ${width === 320 ? "contains" : "raises"} the Pal at ${width}px, ${theme}, ${withPal ? "with a Pal" : "a stranger"}`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 700 });
        await seed(page, { theme, withPal });
        await page.goto("/tonight");

        const dock = page.getByRole("navigation", { name: "Primary" });
        await expect(dock).toBeVisible({ timeout: 60_000 });
        const links = dock.getByRole("link");
        await expect(links).toHaveText(["Map", "Tonight", "Pal", "Plan", "Spoons", "Social", "You"]);
        const door = dock.getByRole("link", { name: withPal ? "Pub Pal, Ripley" : "Pub Pal", exact: true });
        await expect(door).toBeVisible();
        if (withPal) {
          await expect.poll(() => door.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        } else {
          await expect(door.locator("img")).toHaveCount(0);
        }

        // The face stays inside its narrow cell or rises above a wider rail.
        // Both layouts keep Pal between Tonight and Plan without horizontal overflow.
        const rail = (await page.locator(".mobileTabList").boundingBox())!;
        const face = (await door.locator(".palNavFace").boundingBox())!;
        const tonight = (await dock.getByRole("link", { name: "Tonight", exact: true }).boundingBox())!;
        const plan = (await dock.getByRole("link", { name: "Plan", exact: true }).boundingBox())!;
        const doorBox = (await door.boundingBox())!;
        if (width === 320) {
          expect(face.y).toBeGreaterThanOrEqual(doorBox.y);
          expect(face.y + face.height).toBeLessThanOrEqual(doorBox.y + doorBox.height);
          expect(face.x).toBeGreaterThanOrEqual(doorBox.x);
          expect(face.x + face.width).toBeLessThanOrEqual(doorBox.x + doorBox.width);
        } else {
          expect(face.y).toBeLessThan(rail.y);
        }
        expect(face.x).toBeGreaterThan(tonight.x + tonight.width / 2);
        expect(face.x + face.width).toBeLessThan(plan.x + plan.width / 2);
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

test("on a short phone the face sits inside the rail, clear of the page above it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, { theme: "light", withPal: true });
  await page.goto("/tonight");
  const dock = page.getByRole("navigation", { name: "Primary" });
  const door = dock.getByRole("link", { name: "Pub Pal, Ripley", exact: true });
  await expect(door).toBeVisible({ timeout: 60_000 });
  await expect(dock.getByRole("link")).toHaveText(["Map", "Tonight", "Pal", "Plan", "Spoons", "Social", "You"]);
  const rail = (await page.locator(".mobileTabList").boundingBox())!;
  const face = (await door.locator(".palNavFace").boundingBox())!;
  expect(face.y).toBeGreaterThanOrEqual(rail.y);
  expect(face.y + face.height).toBeLessThanOrEqual(rail.y + rail.height);
  const doorBox = (await door.boundingBox())!;
  expect(Math.min(doorBox.width, doorBox.height)).toBeGreaterThanOrEqual(44);
  await page.waitForTimeout(600);
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/dock-320x568.png`, clip: { x: 0, y: rail.y - 40, width: 320, height: 568 - (rail.y - 40) } });
});

// The tablet bar was measured with no room to spare, and a signed-in bar also
// carries alerts, messages and the account. The door is a face-only disc there,
// so every destination stays pressable and the bar never scrolls sideways.
for (const width of [641, 700, 768, 900] as const) {
  test(`${width}px: the Pal's door fits the signed-in tablet bar`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    // A name at the 32-character limit of the Pal form (lib/pubPal.ts).
    const name = "Bartholomew Fitzgerald the Third";
    await seed(page, { theme: "light", withPal: true, name });
    await page.goto("/tonight");
    const bar = page.getByRole("navigation", { name: "Site navigation" });
    const door = bar.getByRole("link", { name: `Pub Pal, ${name}`, exact: true });
    await expect(door).toBeVisible({ timeout: 60_000 });
    const box = (await door.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeLessThanOrEqual(46);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const findings = await page.evaluate(() => {
      const covered: string[] = [];
      const pressable = [...document.querySelectorAll(".siteNavLinks .siteNavLink"), document.querySelector("a.siteNavPal")];
      for (const link of pressable) {
        if (!link) continue;
        const rect = link.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit || !link.contains(hit)) covered.push(link.textContent?.trim() ?? "?");
      }
      const primaryRight = Math.max(...Array.from(document.querySelectorAll(".siteNavLinks .siteNavLink"), (link) => link.getBoundingClientRect().right));
      const actionsLeft = document.querySelector(".siteNavActions")!.getBoundingClientRect().left;
      return { covered, primaryRight, actionsLeft, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(findings.covered).toEqual([]);
    expect(findings.primaryRight).toBeLessThanOrEqual(findings.actionsLeft);
    expect(findings.overflow).toBeLessThanOrEqual(0);
    await mkdir(SHOTS, { recursive: true });
    const barBox = (await bar.boundingBox())!;
    await page.screenshot({ path: `${SHOTS}/tablet-${width}.png`, clip: { x: 0, y: barBox.y, width, height: barBox.height + 8 } });
  });
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
