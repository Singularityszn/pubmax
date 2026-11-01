import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { mobileMapShellControl } from "./helpers/mobileMapShell";

// The Pub Pal's own door (components/nav/PalNavButton.tsx). The phone dock is
// five tabs and nothing else (captain, 1 Nov 2026, launch plan decision 13),
// so on a phone the door is an icon button in the top bar, and on the map,
// whose own top bar has no room, it stands on the map edge above Near me. The
// desktop bar keeps the named button. Shots land in artifacts/pal-nav-button/
// (gitignored).

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
      test(`the phone top bar carries the Pal at ${width}px, ${theme}, ${withPal ? "with a Pal" : "a stranger"}`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 700 });
        await seed(page, { theme, withPal });
        await page.goto("/tonight");

        // The dock is the five tabs and nothing else.
        const dock = page.getByRole("navigation", { name: "Primary" });
        await expect(dock).toBeVisible({ timeout: 60_000 });
        await expect(dock.getByRole("link")).toHaveText(["Explore", "Tonight", "Plan", "Social", "You"]);
        await expect(dock.locator('a[href="/pal"]')).toHaveCount(0);

        const bar = page.getByRole("navigation", { name: "Site navigation" });
        const name = withPal ? "Pub Pal, Ripley" : "Pub Pal";
        const door = bar.getByRole("link", { name, exact: true });
        await expect(door).toBeVisible();
        if (withPal) {
          await expect.poll(() => door.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        } else {
          await expect(door.locator("img")).toHaveCount(0);
        }

        // A 44px icon button inside the 52px bar, clear of the wordmark and of
        // every other control, and the bar never pushes the page sideways (a
        // signed-in bar also carries alerts, messages and the account).
        const doorBox = (await door.boundingBox())!;
        expect(Math.min(doorBox.width, doorBox.height)).toBeGreaterThanOrEqual(44);
        const barBox = (await bar.boundingBox())!;
        expect(doorBox.y).toBeGreaterThanOrEqual(barBox.y);
        expect(doorBox.y + doorBox.height).toBeLessThanOrEqual(barBox.y + barBox.height);
        const findings = await page.evaluate(() => {
          const navBar = document.querySelector(".siteNavBar")!;
          const controls = [
            navBar.querySelector(".siteNavBrand"),
            ...navBar.querySelectorAll(".siteNavActions > *"),
          ].filter((element): element is Element => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1 && getComputedStyle(element).display !== "none";
          });
          const rects = controls.map((element) => element.getBoundingClientRect());
          const overlaps: string[] = [];
          for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
              const a = rects[i]!;
              const b = rects[j]!;
              if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom && b.top < a.bottom) {
                overlaps.push(`${controls[i]!.className} / ${controls[j]!.className}`);
              }
            }
          }
          return {
            overlaps,
            barOverflow: navBar.scrollWidth - navBar.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        expect(findings.overlaps).toEqual([]);
        expect(findings.barOverflow).toBeLessThanOrEqual(0);
        expect(findings.pageOverflow).toBeLessThanOrEqual(0);

        await page.waitForTimeout(600);
        await mkdir(SHOTS, { recursive: true });
        await page.screenshot({
          path: `${SHOTS}/topbar-${width}-${theme}-${withPal ? "pal" : "stranger"}.png`,
          clip: { x: 0, y: 0, width, height: Math.ceil(barBox.y + barBox.height + 8) },
        });

        await door.click();
        await expect(page).toHaveURL(/\/pal$/);
        await expect(
          page.getByRole("navigation", { name: "Site navigation" }).getByRole("link", { name, exact: true }),
        ).toHaveAttribute("aria-current", "page");
        // The Pal's page lights no tab.
        await expect(dock.locator("[aria-current='page']")).toHaveCount(0);
      });
    }
  }
}

// The phone map draws its own top bar, measured at five slots, so the Pal's
// door stands on the map edge, one gap above Near me, where the floating
// create button used to stand.
for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }] as const) {
  test(`${viewport.width}x${viewport.height}: the map edge carries the Pal above Near me`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await seed(page, { theme: "light", withPal: false });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    });
    await installDeterministicMapBasemap(page);
    await page.goto("/map");
    const nearMe = await mobileMapShellControl(page, "nearMe");
    const corner = page.locator(".mobileMapUtilityCorner");
    const door = corner.getByRole("link", { name: "Pub Pal", exact: true });
    await expect(door).toBeVisible();
    await expect(nearMe).toBeVisible();
    const doorBox = (await door.boundingBox())!;
    const nearBox = (await nearMe.boundingBox())!;
    expect(Math.min(doorBox.width, doorBox.height)).toBeGreaterThanOrEqual(44);
    expect(doorBox.y + doorBox.height).toBeLessThanOrEqual(nearBox.y);
    // Centred over Near me, inside the viewport.
    expect(Math.abs(doorBox.x + doorBox.width / 2 - (nearBox.x + nearBox.width / 2))).toBeLessThanOrEqual(1);
    expect(doorBox.x + doorBox.width).toBeLessThanOrEqual(viewport.width);
    const owner = await door.evaluate((link) => {
      const rect = link.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit && link.contains(hit) ? "door" : (hit?.className.toString() ?? "nothing");
    });
    expect(owner).toBe("door");
    await page.waitForTimeout(600);
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/map-edge-${viewport.width}x${viewport.height}.png` });
    await door.click();
    await expect(page).toHaveURL(/\/pal$/);
  });
}

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
