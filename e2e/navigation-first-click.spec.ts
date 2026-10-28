import { expect, test } from "@playwright/test";

import { stubSocialAuthProviders } from "./helpers/authDoubles";
import type { OutResponse } from "@/lib/out/types";

test.use({ serviceWorkers: "block" });

for (const width of [390, 1440]) {
  for (const route of ["/", "/today", "/tonight"]) {
    test(`${width}px: ${route} entry links do not prefetch on sight`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const navigation = ".siteNavBar a[href^='/']";
      const groups = route === "/"
        ? [".lpNav a[href^='/']", "main a[href^='/']", ".lpFooter a[href^='/']"]
        : route === "/today"
          ? [navigation, ".todayInkLink:is([href='/tonight'], [href='/map'], [href='/plan']), a.todayPickLink, a.todayButton, .todayScreen .screenPrimary a, .todayScreen .screenSecondary a"]
          : [navigation, ".tonightFootLink, .tonightDesktopGrid .screenSecondary a, a.tonightRowLink, .tonightRowMapLink, a.tonightRowMoreLink, .outPlansFootLink, .tonightLater a[href^='/']"];
      const entryLinks = groups.join(", ");
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date("2026-10-27T12:00:00Z"));
      await stubSocialAuthProviders(page);
      await page.addInitScript(() => {
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await page.addInitScript((selector) => {
        const Observer = window.IntersectionObserver;
        window.IntersectionObserver = class extends Observer {
          constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
            super((entries, observer) => callback(entries.filter(({ target }) =>
              !(target instanceof HTMLAnchorElement) || target.matches(selector),
            ), observer), options);
          }
        };
      }, entryLinks);
      const out: OutResponse = {
        status: "ready", listingsStatus: "ready", venueMatch: "ready",
        events: [{
          id: "prefetch-test", venueId: "venue-nyowgc", placeName: "Test pub",
          kind: "quiz", title: "Test quiz", startsAt: "2026-10-28T19:00:00Z",
          source: { label: "Test listing", url: "https://example.test/quiz" },
          observedAt: "2026-10-27T12:00:00Z", confidence: "listed",
        }],
        attribution: [], observedAt: {}, providers: [],
        openPlansStatus: "ready",
        openPlans: [{
          crewId: "00000000-0000-4000-8000-000000000001", title: "Test night",
          startTime: "2026-10-27T19:00:00Z", hostHandle: "test-host", memberCount: 2,
          stopVenueId: "venue-nyowgc", stopVenueName: "Test meeting point",
          meetingPoint: { kind: "venue", name: "Test meeting point", lat: 51.51, lng: -0.13 },
        }],
      };
      await page.route("**/api/out?**", (request) => request.fulfill({ json: out }));
      await page.route("**/api/whats-on?**", (request) => request.fulfill({
        json: { rows: [], servedAt: "2026-10-27T12:00:00Z", sourceObservedAt: null },
      }));
      const prefetches: string[] = [];
      page.on("request", (request) => {
        const headers = request.headers();
        if (headers["next-router-prefetch"] || /prefetch/i.test(`${headers.purpose} ${headers["sec-purpose"]}`)) {
          const url = new URL(request.url());
          url.searchParams.delete("_rsc");
          prefetches.push(`${url.pathname.split(".segments/")[0]}${url.search}`);
        }
      });
      await page.goto(route);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("button", { name: /Switch to .* theme/i }).first()).toBeEnabled();

      if (route === "/tonight") {
        await expect(page.getByTestId("listings-skeleton")).toHaveCount(0);
        await expect(page.getByTestId("tonight-open-plans")).toBeVisible();
      }
      const destinations = new Set<string>();
      async function exposeLinks(selector: string): Promise<void> {
        const links = page.locator(selector);
        expect(await links.count(), selector).toBeGreaterThan(0);
        for (const link of await links.all()) {
          if (!await link.isVisible()) continue;
          const href = await link.getAttribute("href");
          expect(href).toBeTruthy();
          destinations.add(href!);
          await link.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
        }
      }
      for (const selector of groups) await exposeLinks(selector);
      if (route === "/tonight") {
        for (const name of ["Tomorrow", "Weekend"]) {
          await page.getByRole("button", { name, exact: true }).click();
          await page.mouse.move(0, 0);
          await expect(page.getByTestId("out-listings-pending")).toHaveCount(0);
          await exposeLinks(".tonightLater a[href^='/']");
        }
      }
      await page.waitForTimeout(1_000);
      const unexpected = prefetches.filter((href) => destinations.has(href));
      await testInfo.attach("entry-prefetch-requests", {
        body: JSON.stringify({ entryLinks, destinations: [...destinations], prefetches, unexpected }, null, 2),
        contentType: "application/json",
      });
      expect(unexpected).toEqual([]);
    });
  }
}

for (const viewport of [
  { width: 390, height: 844, navigation: "Primary" },
  { width: 1440, height: 900, navigation: "Site navigation" },
]) {
  test(`one Plan click shows feedback while the route waits at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date("2026-10-27T12:00:00Z"));
    await stubSocialAuthProviders(page);
    await page.addInitScript(() => {
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.goto("/u/you");

    const nav = page.getByRole("navigation", { name: viewport.navigation, exact: true });
    // The live day href confirms that this navigation hydrated before the single click.
    await expect(nav.locator('a[href="/today"]')).toBeVisible();
    const plan = nav.getByRole("link", { name: "Plan", exact: true });
    await expect(plan).toBeVisible();
    const initialBox = await plan.boundingBox();
    const initialHistoryLength = await page.evaluate(() => history.length);
    let releaseRoute!: () => void;
    const routeHeld = new Promise<void>((resolve) => { releaseRoute = resolve; });
    let sawRoute!: () => void;
    const routeRequested = new Promise<void>((resolve) => { sawRoute = resolve; });
    await page.route((url) => url.pathname === "/plan", async (route) => {
      if (route.request().headers().rsc !== "1") {
        await route.fallback();
        return;
      }
      sawRoute();
      await routeHeld;
      await route.continue();
    });

    try {
      await plan.click();
      await routeRequested;
      const feedback = plan.getByRole("progressbar", { name: "Opening page" });
      await expect(feedback).toBeVisible({ timeout: 1_000 });
      await expect(plan).toHaveAccessibleName("Plan");
      await expect(page).toHaveURL(/\/u\/you$/);
      await expect.poll(() => plan.boundingBox()).toEqual(initialBox);
    } finally {
      releaseRoute();
    }

    await expect(page).toHaveURL(/\/plan$/);
    await expect(nav.getByRole("progressbar", { name: "Opening page" })).toHaveCount(0);
    await expect(plan).toHaveAccessibleName("Plan");
    expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);
  });
}
