import { expect, test, type Locator, type Page } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectStreamedPageSettled } from "./helpers/streamedPage";

async function openOwnProfile(page: Page): Promise<void> {
  await installAuthDoubles(page);
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          id: ACCOUNTS.A.id,
          handle: ACCOUNTS.A.handle,
          displayName: ACCOUNTS.A.name,
          bio: "A local looking for a good pint.",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
        },
        socialLinks: [],
        counts: { followers: 0, following: 0 },
        viewerFollowing: false,
        followsViewer: false,
      }),
    }),
  );
  await seedSignedIn(page, "A");
  await page.goto(`/u/${ACCOUNTS.A.handle}`);
  await expectStreamedPageSettled(page);
  await expect(page.locator(".profileIdentity")).toBeVisible();
}

async function openAccountMenu(page: Page): Promise<Locator> {
  const menu = page.locator(".authAccountMenu");
  await expect(async () => {
    if (!(await menu.isVisible())) {
      await page.getByRole("button", { name: /Account options/ }).click();
    }
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return menu;
}

// Every visible piece of the open menu must be the topmost element at its own
// centre: nothing on the page, and no floating greeting, may paint over it.
async function expectMenuOwnsItsTaps(menu: Locator): Promise<void> {
  const controls = menu.locator(".authAccountCard, a, button");
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    await expect.poll(() => control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit !== null && element.contains(hit);
    })).toBe(true);
  }
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`profile account menu owns its taps at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openOwnProfile(page);
    const menu = await openAccountMenu(page);
    await expectMenuOwnsItsTaps(menu);

    await menu.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: /Account options/ })).toHaveCount(0);
    const signIn = page.getByRole("link", { name: "Sign in", exact: true })
      .or(page.getByRole("button", { name: "Sign in", exact: true }));
    await expect(signIn.first()).toBeVisible();
  });
}

test("the sign-in greeting never covers the open account menu at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A sign-in that just landed: the greeting shows on the page the person reaches.
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "pubmax:arrival-welcome:v1",
      JSON.stringify({ intent: "signin", at: Date.now() }),
    );
  });
  await openOwnProfile(page);
  const greeting = page.locator(".arrivalWelcome");
  await expect(greeting).toBeVisible();

  const menu = await openAccountMenu(page);
  // The greeting takes no pointer events, so elementFromPoint would look straight
  // through it. Make it hit-testable (paint order is unchanged) to see what is on
  // top. One read, not a poll: the greeting retires itself after a few seconds,
  // and a poll would pass by outwaiting it.
  await greeting.evaluate((element) => {
    (element as HTMLElement).style.pointerEvents = "auto";
  });
  await menu.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  const coverage = await menu.evaluate((element) => {
    const greeting = document.querySelector(".arrivalWelcome");
    if (!greeting) throw new Error("The sign-in greeting disappeared before the menu check.");
    const greetingBox = greeting.getBoundingClientRect();
    const menuBox = element.getBoundingClientRect();
    const left = Math.max(greetingBox.left, menuBox.left);
    const right = Math.min(greetingBox.right, menuBox.right);
    const top = Math.max(greetingBox.top, menuBox.top);
    const bottom = Math.min(greetingBox.bottom, menuBox.bottom);
    const overlaps = left < right && top < bottom;
    // The overlap can cover menu padding without covering any control centre.
    const hit = overlaps
      ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
      : null;
    const covered = [...element.querySelectorAll<HTMLElement>(".authAccountCard, a, button")]
      .filter((control) => control.getClientRects().length > 0)
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit === null || !control.contains(hit);
      })
      .map((control) => control.textContent?.trim() ?? control.className);
    return { covered, overlaps, menuOwnsOverlap: hit !== null && element.contains(hit) };
  });
  // The greeting was still on screen, not leaving, when the menu was read.
  await expect(greeting).toBeVisible();
  await expect(greeting).not.toHaveAttribute("data-leaving");
  expect(coverage.covered).toEqual([]);
  expect(coverage.overlaps).toBe(true);
  expect(coverage.menuOwnsOverlap).toBe(true);
});
