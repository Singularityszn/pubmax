import { expect, test } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// The three store-required doors on the You tab, at the phone width a reviewer
// holds (390x844).
//
// GAP 1 — an in-app deletion control. Apple 5.1.1(v) and Play's 2024 policy both
//         require it, and `docs/STORE_READINESS.md` already promises both stores
//         it is in the submitted build.
// GAP 3 — privacy, terms and the support contact reachable INSIDE the shell,
//         which starts on /tonight (`SHELL_START_PATH`) and need never open `/`.
// GAP 4 — one sign-in action, and it is a real link. The nav's own Sign in is
//         hidden at 640px (`.siteNavBar .authUser`), so before this the You tab
//         signed out said "Sign in" three times and had nothing to tap.
//
// The proof shots land in docs/proof/account-deletion/.

const PHONE = { width: 390, height: 844 };
const PROOF = "docs/proof/account-deletion";
/** The export door beside the deletion door (contribution battle test L04). */
const DATA_DOORS_PROOF = "docs/proof/account-deletion-real";
const DATA_DOOR_WIDTHS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
] as const;

test.use({ viewport: PHONE });

test.describe("the You tab's store doors", () => {
  test("signed out, it offers one real sign-in door and the legal row", async ({ page }) => {
    await page.goto("/u/you", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/u\/you$/);

    // ONE primary action, and it leaves the page.
    const claim = page.locator(".youIdentityActions a[data-primary-action]");
    await expect(claim).toHaveAttribute("href", "/login?mode=signin&from=%2Fu%2Fyou");
    await expect(claim).toBeVisible();

    // GAP 3: the links the native shell can otherwise never reach.
    const legal = page.locator(".accountLegalRow");
    await expect(legal).toBeAttached({ timeout: 20_000 });
    await expect(legal.locator('a[href="/privacy"]')).toBeAttached();
    await expect(legal.locator('a[href="/terms"]')).toBeAttached();
    await expect(legal.locator('a[href="/account/delete"]')).toBeAttached();
    await expect(legal.locator('a[href^="mailto:"]')).toBeAttached();

    // A signed-out reader is never offered the delete door.
    await expect(page.locator("#delete-account")).toHaveCount(0);

    // A full-page shot paints every `position: fixed` element at the CURRENT
    // scroll offset, so the skip link lands in the middle of the image if the
    // page is scrolled. Shoot from the top; the capture covers the whole
    // document either way.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `${PROOF}/after-you-signed-out-390.png`,
      fullPage: true,
    });
  });

  test("signed in, the deletion control opens a confirm that names both sides", async ({ page }) => {
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");

    await page.goto("/u/you", { waitUntil: "domcontentloaded" });

    const card = page.locator("#delete-account");
    await expect(card).toBeAttached({ timeout: 30_000 });
    await card.scrollIntoViewIfNeeded();

    // A control painted on the server is tappable before React attaches, so the
    // tap is retried rather than the assertion after it being made stricter
    // (AGENTS.md: "A LONE CLICK IS NOT A WAIT FOR HYDRATION").
    const confirm = card.locator(".accountHubDeleteConfirm");
    await expect(async () => {
      await card.getByRole("button", { name: "Delete account" }).click();
      await expect(confirm).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    // Both sides of the deal, before anything is sent.
    await expect(confirm.getByRole("heading", { name: "What leaves" })).toBeVisible();
    await expect(confirm.getByRole("heading", { name: "What stays" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Delete my account" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Keep my account" })).toBeVisible();

    // The CARD, not the page: a signed-in profile is nearly ten thousand pixels
    // tall, so a full-page shot of it renders the confirm too small to read,
    // which is the one thing this proof exists to show. Scroll the LAST control
    // clear first, or the fixed tab bar paints over the way back out.
    await card.getByRole("button", { name: "Keep my account" }).scrollIntoViewIfNeeded();
    // The arrival welcome is ambient chrome that floats over whatever is under
    // it. It is not what this proof is about, so it is dismissed rather than
    // photographed across the copy.
    const welcome = page.locator(".arrivalWelcome .arrivalWelcomeDismiss");
    if (await welcome.count()) await welcome.first().click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await card.screenshot({ path: `${PROOF}/after-delete-confirm-390.png` });
  });
});

test.describe("the account's own data doors", () => {
  test("Download your data sits beside Delete account and hands the browser a file", async ({ page }) => {
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");

    // The keyless e2e server verifies no bearer, so the route is answered in
    // the page, in the shape the route test pins. What is rehearsed here is
    // the door: the signed request, and the file the browser is handed.
    const requests: string[] = [];
    await page.route("**/api/account/export", async (route) => {
      requests.push(route.request().headers().authorization ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-disposition": 'attachment; filename="pubmaxx-karan-2026-09-05.json"' },
        body: JSON.stringify({
          version: 1,
          exportedAt: "2026-09-05T18:00:00.000Z",
          account: { userId: "00000000-0000-4000-8000-0000000000a1", handle: "karan", displayName: null },
          memories: { status: "complete", truncated: false, items: [] },
          prices: { status: "complete", truncated: false, items: [] },
          pintDrops: { status: "complete", truncated: false, items: [] },
          messages: { status: "complete", truncated: false, items: [] },
        }),
      });
    });

    await page.goto("/u/you", { waitUntil: "domcontentloaded" });

    const doors = page.locator(".accountHubDataDoors");
    await expect(doors).toBeAttached({ timeout: 30_000 });
    const exportCard = doors.locator("#export-account");
    const deleteCard = doors.locator("#delete-account");
    await expect(exportCard).toBeVisible();
    await expect(deleteCard).toBeVisible();
    // Beside, in DOM order: the copy before the goodbye.
    await expect(doors.locator("> div").nth(0)).toHaveAttribute("id", "export-account");
    await expect(doors.locator("> div").nth(1)).toHaveAttribute("id", "delete-account");

    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
    await expect(async () => {
      await exportCard.getByRole("button", { name: "Download JSON" }).click();
      await expect(exportCard.getByRole("status")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("pubmaxx-karan-2026-09-05.json");
    await expect(exportCard.getByRole("status")).toHaveText("Your file is ready.");
    // The request carried the caller's own bearer and nothing else named an account.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((value) => value.startsWith("Bearer "))).toBe(true);
  });

  for (const size of DATA_DOOR_WIDTHS) {
    test(`the pair at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await installAuthDoubles(page);
      await seedSignedIn(page, "A");
      await page.goto("/u/you", { waitUntil: "domcontentloaded" });

      const doors = page.locator(".accountHubDataDoors");
      await expect(doors).toBeAttached({ timeout: 30_000 });
      await expect(doors.locator("#export-account")).toBeVisible();
      await expect(doors.locator("#delete-account")).toBeVisible();
      // Two panels side by side above 760px, stacked on a phone.
      const [exportBox, deleteBox] = await Promise.all([
        doors.locator("#export-account").boundingBox(),
        doors.locator("#delete-account").boundingBox(),
      ]);
      expect(exportBox && deleteBox).toBeTruthy();
      if (size.width > 760) {
        expect(Math.round(exportBox!.y)).toBe(Math.round(deleteBox!.y));
        expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(deleteBox!.x + 1);
      } else {
        expect(exportBox!.y + exportBox!.height).toBeLessThanOrEqual(deleteBox!.y + 1);
        expect(Math.round(exportBox!.x)).toBe(Math.round(deleteBox!.x));
      }

      const settings = page.locator(".accountHubSettings");
      await doors.locator("#delete-account").scrollIntoViewIfNeeded();
      // The arrival welcome is ambient chrome; dismiss it when it is there to
      // be dismissed, and never wait on it, because at 1440 it can have left
      // on its own before the click lands.
      const welcome = page.locator(".arrivalWelcome .arrivalWelcomeDismiss");
      if (await welcome.count()) await welcome.first().click({ timeout: 2_000 }).catch(() => undefined);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await settings.screenshot({ path: `${DATA_DOORS_PROOF}/after-data-doors-${size.name}.png` });
    });
  }
});
