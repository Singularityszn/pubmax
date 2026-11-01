import { expect, test } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectStreamedPageSettled } from "./helpers/streamedPage";

test("homepage styles do not lower Create onto Tonight after client navigation", async ({ page }) => {
  const account = ACCOUNTS.A;
  const planId = "11111111-1111-4111-8111-111111111111";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");

  // The active pointer and default collapsed pill follow night-mode-chrome.spec.ts.
  // Do not seed the ending-ready handoff, which would open the full sheet.
  await page.addInitScript(({ ownerId, planId }) => {
    localStorage.setItem("pubmax_account_owner", ownerId);
    localStorage.setItem("pubmax_active_plan", JSON.stringify({
      version: 1, id: planId, startTime: new Date().toISOString(), stopIndex: 0, role: "host",
    }));
    localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.removeItem(`pubmaxx:night-mode-ending-ready:${planId}`);
  }, { ownerId: account.id, planId });

  // Same profile projection as profile-account-menu.spec.ts, with one follower.
  await page.route((url) => url.pathname === `/api/profiles/${account.handle}`, (route) =>
    route.fulfill({ json: {
      profile: {
        id: account.id, handle: account.handle, displayName: account.name,
        bio: "A local looking for a good pint.",
        createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z",
      },
      projection: "full", socialLinks: [], counts: { followers: 1, following: 0 },
      viewerFollowing: false, followsViewer: false,
    } }),
  );
  await page.route((url) => url.pathname === `/api/profiles/${account.handle}/followers`, (route) =>
    route.fulfill({ json: { followers: [{ handle: ACCOUNTS.B.handle, displayName: ACCOUNTS.B.name }] } }),
  );
  await page.route((url) => url.pathname === `/api/profiles/${account.handle}/lot`, (route) =>
    route.fulfill({ json: { lot: [] } }),
  );
  await page.route(`**/api/plans/${planId}/session`, (route) =>
    route.fulfill({ json: { active: true, role: "host", collaborationAuthorized: true } }),
  );

  await page.goto("/");
  await expect(page.locator(".lpHero")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-social-friends-launch", "1");
  const you = page.getByRole("navigation", { name: "Primary", exact: true })
    .getByRole("link", { name: "You", exact: true });
  await expect(you).toHaveAttribute("href", `/u/${account.handle}`);

  // Keep the actual loaded landing stylesheet by reference. A reload destroys
  // this handle, and a removed stylesheet fails the final membership check.
  const landingSheet = await page.evaluateHandle(() => [...document.styleSheets].find((sheet) => {
    try { return [...sheet.cssRules].some((rule) => rule.cssText.includes(".lpHero")); }
    catch { return false; }
  }) ?? null);
  expect(await landingSheet.evaluate((sheet) => sheet !== null)).toBe(true);
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.resourceType() === "document"
      && request.frame() === page.mainFrame()) documentRequests += 1;
  });

  // Retry a dropped hydration tap, as required by e2e/AGENTS.md.
  await expect(async () => {
    if (new URL(page.url()).pathname === "/") await you.click();
    await expect(page.locator(".profileIdentity")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/u/${account.handle}$`));
  await expectStreamedPageSettled(page);
  const followers = page.getByRole("list", { name: "Profile statistics", exact: true })
    .getByRole("link", { name: /^Followers:/ });
  await expect(followers).toHaveAttribute("href", `/u/${account.handle}/people/followers`);
  await followers.click();
  await expect(page).toHaveURL(new RegExp(`/u/${account.handle}/people/followers$`));
  await expectStreamedPageSettled(page);
  await expect(page.getByRole("heading", { name: "Followers", exact: true })).toBeVisible();
  await expect(page.locator(".lpHero")).toHaveCount(0);
  expect(documentRequests, "Both route changes must use client navigation").toBe(0);
  expect(await landingSheet.evaluate((sheet) => sheet !== null && [...document.styleSheets].includes(sheet)),
    "The homepage stylesheet must remain attached after client navigation").toBe(true);

  // The Tonight pill owns its own tap after leaving the homepage. The floating
  // Create that once stood over it left with the five-tab dock (1 Nov 2026).
  const tonight = page.getByRole("button", { name: "Show tonight's plan", exact: true });
  await expect(tonight).toBeVisible();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const ownsTap = await tonight.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && button.contains(hit);
  });
  expect(ownsTap, "nothing covers the Tonight pill after leaving the homepage").toBe(true);
  await landingSheet.dispose();
});
