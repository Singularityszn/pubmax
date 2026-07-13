import { test, expect, type Page } from "@playwright/test";

// /u/you first-run passport (user stories 29/30) + notifications bell/activity
// (story 34). Fresh-context (no localStorage `pubmax_handle`), so /u/you never
// redirects and always renders the anonymous first-run Pint Passport. Also
// re-asserts the PRD's two regression guards on the SAME fresh page: no raw
// "venue-…" id and no "@@" doubled handle ever leak as visible text.
//
// Style matches the other new specs: watchPageErrors, web-first assertions, no
// waitForTimeout, .count()-guarded branches for populated-vs-empty states.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const RAW_VENUE_ID = /venue-[a-z0-9]+/;

test.describe("/u/you — first-run passport (fresh context, no localStorage)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("renders the anonymous first-run passport with start-your-passport copy + CTAs", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/u/you");
    expect(response?.status()).toBe(200);

    // No device handle in localStorage → /u/you never redirects (guarded in
    // app/u/[handle]/page.tsx's isYouRoute effect); it stays on this route and
    // renders the first-run passport.
    await expect(page).toHaveURL(/\/u\/you$/);

    const passport = page.locator(".pintPassport");
    await expect(passport).toBeVisible();

    // First-run copy (isOwn && isEmpty branch of PintPassport.tsx).
    await expect(passport.locator(".passportFirstRunLead")).toContainText(
      "Your passport is blank",
    );
    await expect(passport.locator(".passportFirstRunCopy")).toContainText(
      "Start collecting your nights",
    );

    // Both first-run CTAs: "Open the map" and "Log a pint".
    const actions = passport.locator(".passportFirstRunActions");
    await expect(actions.getByRole("link", { name: "Open the map" })).toHaveAttribute(
      "href",
      "/map",
    );
    await expect(actions.getByRole("link", { name: "Log a pint" })).toHaveAttribute(
      "href",
      "/map?log=1",
    );

    // The stat grid still renders (all-zero first-run page), never a broken gap.
    await expect(passport.locator(".passportGrid")).toBeVisible();

    // No "Claim this handle" button — "you" is a sentinel, not a real handle to
    // adopt (app/u/[handle]/page.tsx: isYouRoute ? null : ...).
    await expect(page.getByRole("button", { name: /claim this handle/i })).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("mobile first-run passport CTAs stay thumb-sized and within the viewport", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const response = await page.goto("/u/you");
    expect(response?.status()).toBe(200);

    const passport = page.locator(".pintPassport");
    await expect(passport).toBeVisible();

    const actions = passport.locator(".passportFirstRunActions");
    await expect(actions).toBeVisible();

    const result = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll<HTMLElement>(".passportFirstRunActions a"),
      ).map((link) => {
        const rect = link.getBoundingClientRect();
        return {
          height: rect.height,
          width: rect.width,
          left: rect.left,
          right: rect.right,
        };
      });

      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        links,
      };
    });

    expect(result.overflow).toBeLessThanOrEqual(1);
    expect(result.links).toHaveLength(2);
    for (const link of result.links) {
      expect(link.height).toBeGreaterThanOrEqual(44);
      expect(link.width).toBeGreaterThan(44);
      expect(link.left).toBeGreaterThanOrEqual(0);
      expect(link.right).toBeLessThanOrEqual(390);
    }

    expect(errors).toEqual([]);
  });

  test("regression guards: no raw 'venue-' id and no '@@' doubled handle anywhere in the page text", async ({
    page,
  }) => {
    await page.goto("/u/you");
    await expect(page.locator(".pintPassport")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(RAW_VENUE_ID);
    expect(bodyText).not.toContain("@@");
  });
});

// ---------------------------------------------------------------------------
// Notifications bell (nav) + /activity (story 34).
test.describe("notifications — bell + activity feed", () => {
  test("the notification bell renders in the site nav", async ({ page }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/feed", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    const bell = page.locator(".siteNavBell").first();
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute("href", "/activity");

    expect(errors).toEqual([]);
  });

  test("/activity renders the EmptyState when signed out (no device handle)", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/activity");
    expect(response?.status()).toBe(200);

    await expect(page.locator("h1")).toContainText("Activity");

    // No `pubmax_handle` in a fresh context: the page renders the "claim a
    // handle" EmptyState rather than a populated list or a loading spinner
    // stuck forever.
    const empty = page.locator(".emptyState");
    await expect(empty).toBeVisible();
    await expect(empty.locator(".emptyStateTitle")).toContainText(/sign in or claim a handle/i);
    await expect(empty.locator(".emptyStateBody")).toContainText(/drop a pint to set a handle/i);
    await expect(empty.locator(".emptyStateAction :is(a, button)")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("/activity with a claimed handle shows an empty state or populated list without hydration errors", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    // Seed a device handle so the page attempts the authenticated load path,
    // then guard both outcomes (no notifications yet vs some exist) with
    // .count() — an empty inbox for a brand-new demo handle is the expected,
    // valid state, never a failure.
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax_handle", "e2e-passport-check");
    });

    const response = await page.goto("/activity");
    expect(response?.status()).toBe(200);

    const emptyNothingYet = page.locator(".emptyState");
    const list = page.locator(".activityList");
    await expect
      .poll(async () => (await emptyNothingYet.count()) + (await list.count()))
      .toBeGreaterThan(0);

    if ((await list.count()) > 0) {
      await expect(list.locator(".activityItem").first()).toBeVisible();
    } else {
      await expect(emptyNothingYet.first()).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
});
