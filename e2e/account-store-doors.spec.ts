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
