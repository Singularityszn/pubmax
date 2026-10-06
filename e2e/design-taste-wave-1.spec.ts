import { expect, test, type Locator, type Page } from "@playwright/test";

import { priceBand, priceBandAreaForVenue } from "../lib/priceBand";

import { expectStreamedPageSettled } from "./helpers/streamedPage";

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem("pubmax-theme", nextTheme);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, theme);
}

async function expectSentenceCase(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveCSS("text-transform", "none");
}

function futureListingStart(): string {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
}

function isOutListingsRequest(url: URL): boolean {
  return url.pathname === "/api/out";
}

async function mockTonightMusic(page: Page): Promise<void> {
  const startsAt = futureListingStart();
  const observedAt = new Date(Date.now() - 60_000).toISOString();
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [
          {
            id: "music-1",
            venueId: "venue-xjf3n0",
            placeName: "The Blue Note",
            kind: "music",
            startsAt,
            title: "Live Jazz",
            source: { label: "Listings", url: "https://example.com/jazz" },
            observedAt,
            confidence: "listed",
          },
        ],
        servedAt: observedAt,
        sourceObservedAt: observedAt,
        sourceFreshnessKind: "provider-observed",
        localityBasis: "london-default",
        asOf: observedAt,
      }),
    }),
  );
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        listingsStatus: "ready",
        events: [],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [],
        venueMatch: "ready",
      }),
    }),
  );
}

test.describe("desktop taste wave 1", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`landing hero keeps its promise above the fold in ${theme} mode`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");

      const hero = page.locator("#hero-title");
      await expect(hero).toBeVisible();
      const metrics = await hero.evaluate((element) => {
        const styles = getComputedStyle(element);
        const fontSize = Number.parseFloat(styles.fontSize);
        const lineHeight = Number.parseFloat(styles.lineHeight);
        const height = element.getBoundingClientRect().height;
        return {
          fontSize,
          lineCount: Math.round(height / lineHeight),
        };
      });

      expect(metrics.fontSize).toBeGreaterThanOrEqual(56);
      expect(metrics.fontSize).toBeLessThanOrEqual(64);
      expect(metrics.lineCount).toBeLessThanOrEqual(2);
    });

    test(`semantic hues and sentence-case eyebrows hold in ${theme} mode`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockTonightMusic(page);
      await page.goto("/today");

      await expectSentenceCase(page.locator(".todayCardEyebrow").first());
      // A price wears its band and no other colour (#1499, lib/priceBand.ts):
      // the figure's band is worked out here from its own pounds and its pub,
      // and the ink it paints must be that band's token, read off a probe.
      const price = page.locator(".todayPintPrice").first();
      await expect(price).toBeVisible();
      const figure = await price.evaluate((element) => ({
        text: element.textContent ?? "",
        href: element.closest("a")?.getAttribute("href") ?? "",
      }));
      const pounds = Number(/£(\d+(?:\.\d+)?)/.exec(figure.text)?.[1]);
      const venueId = new URL(figure.href, "http://localhost").searchParams.get("sel");
      const band = priceBand(pounds, priceBandAreaForVenue(venueId));
      expect(band, `no band for ${JSON.stringify(figure)}`).not.toBeNull();
      for (const other of ["cheap", "average", "expensive"] as const) {
        const bandClass = new RegExp(`\\bpriceBand-${other}\\b`);
        if (other === band) await expect(price).toHaveClass(bandClass);
        else await expect(price).not.toHaveClass(bandClass);
      }
      const bandInk = await page.evaluate((className) => {
        const probe = document.createElement("span");
        probe.className = className;
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }, `priceBand-${band}`);
      await expect(price).toHaveCSS("color", bandInk);

      await page.goto("/tonight");
      const musicKind = page.locator('.tonightRowKind[data-kind="music"]').first();
      await expectSentenceCase(musicKind);
      const musicStyle = await musicKind.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--ink-soft)";
        document.body.append(probe);
        const result = {
          colour: getComputedStyle(element).color,
          expected: getComputedStyle(probe).color,
        };
        probe.remove();
        return result;
      });
      expect(musicStyle.colour).toBe(musicStyle.expected);

      await page.goto("/pint-index");
      await expectSentenceCase(page.locator(".kicker").first());
    });

    test(`Stories and Discover keep coral for actions in ${theme} mode`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });

      // /feed and /discover 308 to Social. Signed-out Stories owns one
      // primary (the Sign in door, in the Screen head). The boundary under
      // it prints its line alone: no second link to the same page. Coral fill
      // is the composer, not a retired feed empty.
      await page.goto("/social");
      await expect(page).toHaveURL(/\/social\/?$/);
      // /social streams behind its loading skeleton, and until the stream
      // settles the hidden segment holds a second copy of the Screen head.
      await expectStreamedPageSettled(page);
      const storiesPrimary = page.locator("[data-primary-action]");
      await expect(storiesPrimary).toHaveCount(1);
      await expect(storiesPrimary.getByRole("link", { name: "Sign in" })).toBeVisible();
      await expect(page.getByRole("status").getByText("Sign in to use Social.")).toBeVisible();
      await expect(page.getByRole("status").getByRole("link", { name: "Sign in" })).toHaveCount(0);
      const boundaryStyle = await storiesPrimary.evaluate(
        (element) => getComputedStyle(element).borderStyle,
      );
      expect(boundaryStyle).not.toContain("dashed");

      await page.goto("/social?tab=discover");
      await expectStreamedPageSettled(page);
      await expect(page.getByRole("heading", { name: "Historic London" })).toBeVisible();
      const actions = page.locator(".socialDiscoverBody .editorialLink").filter({ visible: true });
      const actionStyles = await actions.evaluateAll((links) =>
        links.map((link) => ({
          backgroundImage: getComputedStyle(link).backgroundImage,
          label: link.textContent?.trim() ?? "",
        })),
      );
      expect(actionStyles.length).toBeGreaterThanOrEqual(7);
      expect(actionStyles.every(({ backgroundImage }) => backgroundImage === "none")).toBe(true);
      expect(new Set(actionStyles.map(({ label }) => label)).size).toBe(7);
      await expectSentenceCase(page.locator(".nightAreaCoverage__eyebrow").first());
      await expectSentenceCase(page.locator(".nightAreaCoverage__sectionLabel").first());
    });
  }
});
