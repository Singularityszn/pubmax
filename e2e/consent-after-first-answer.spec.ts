import { expect, test } from "@playwright/test";

// THE PRODUCT ANSWERS FIRST, AND THE CONSENT CARD ARRIVES AFTER THE ANSWER.
//
// Captain's standing ask over PlanAstra section 3: the analytics consent card
// was the first thing a new reader met on every route at every width, before
// the answer, and on the smallest phones it sat over the fold until it was
// answered. This spec is the rendered proof of the two halves of the fix:
// the card does not mount on first paint, and once it does mount it is DOCKED
// to the chrome rather than floating over the answer.
//
// The two widths are the ones PlanAstra measured the defect at. 320x568 is the
// shortest viewport this repo sweeps, so it is where a bottom-docked card has
// the least room to stay clear of the first thing on the page.
const WIDTHS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
] as const;

// A first paint the card may not appear on, each with the thing PlanAstra
// found it standing over. The anchor is what the overlap check is taken
// against: a card that covers this element is the defect this spec exists for.
const ARRIVALS = [
  { path: "/", anchors: ["main .screenPrimary > a"], what: "the landing action" },
  { path: "/tonight", anchors: [".tonightHypedRow"], what: "the first hyped pub" },
  { path: "/places", anchors: [".placesCityItem", "main a"], what: "the city list" },
  { path: "/social", anchors: [".accountHubFounding", "main a"], what: "the Founding hundred" },
] as const;

test.use({ storageState: { cookies: [], origins: [] } });

// An undecided reader who has been given NOTHING yet: no stored decision, no
// spent prompt budget and, deliberately, no seeded answer moment. The tour and
// onboarding markers are set for the same reason every other consent spec sets
// them, so the surface under test is the route rather than a first-run screen.
async function prepareUnanswered(
  page: import("@playwright/test").Page,
  viewport: { width: number; height: number },
) {
  const beacons: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      /\/api\/events(\?|$)/.test(url)
      || url.includes("/ingest/")
      || url.includes("/_vercel/insights")
      || url.includes("/_vercel/speed-insights")
      || url.includes("posthog.com")
    ) beacons.push(url);
  });
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // THE CLEAR IS ONCE PER TAB, NOT ONCE PER NAVIGATION. An init script runs
    // again on every document, and the second-route answer is recorded in
    // sessionStorage ACROSS a navigation, so clearing it every time would wipe
    // the first route the moment the reader reached the second one and the
    // card would wait for ever. That is the whole moment under test here.
    const PREPARED = "pw:consent-prepared";
    if (window.sessionStorage.getItem(PREPARED) !== null) return;
    window.sessionStorage.setItem(PREPARED, "1");
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
    window.sessionStorage.removeItem("pubmax:consent-answer-moment:v1");
    window.sessionStorage.removeItem("pubmax:consent-first-route:v1");
  });
  return beacons;
}

/**
 * Wait until the first route of the session has really been recorded.
 *
 * `domcontentloaded` returns before React has hydrated, so a spec that
 * navigated straight on would leave the first route unrecorded and the second
 * one would be read as the first. A reader does not leave a page that fast;
 * this is the precondition "the reader was on route one", not the assertion.
 */
async function firstRouteRecorded(page: import("@playwright/test").Page) {
  await expect
    .poll(
      () => page.evaluate(() =>
        window.sessionStorage.getItem("pubmax:consent-first-route:v1")),
      { timeout: 30_000 },
    )
    .not.toBeNull();
}

type Box = { x: number; y: number; width: number; height: number };

function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width
    && b.x < a.x + a.width
    && a.y < b.y + b.height
    && b.y < a.y + a.height
  );
}

/** The first anchor on the page that really rendered, or null when none did. */
async function firstAnchorBox(
  page: import("@playwright/test").Page,
  anchors: readonly string[],
): Promise<Box | null> {
  for (const selector of anchors) {
    const candidate = page.locator(selector).first();
    if (await candidate.count() === 0) continue;
    const box = await candidate.boundingBox();
    if (box && box.width > 0 && box.height > 0) return box;
  }
  return null;
}

for (const viewport of WIDTHS) {
  const size = `${viewport.width}x${viewport.height}`;

  for (const arrival of ARRIVALS) {
    test(`no consent card on the first paint of ${arrival.path} @${size}`, async ({ page }) => {
      test.setTimeout(60_000);
      const beacons = await prepareUnanswered(page, viewport);
      await page.goto(arrival.path, { waitUntil: "domcontentloaded" });

      const prompt = page.getByLabel("Anonymous analytics choice");
      // The card mounts from an effect, so a bare absent-now assertion would
      // pass before the effect had run at all. The route's own answer is
      // awaited first, and the card is then held absent for a real window.
      // `domcontentloaded` returns before the route paints, so the anchor is
      // polled for rather than read once: a single read raced the first paint
      // and failed on a cold /social.
      await expect
        .poll(() => firstAnchorBox(page, arrival.anchors), {
          message: `${arrival.path} rendered ${arrival.what}`,
          timeout: 15_000,
        })
        .not.toBeNull();
      await firstRouteRecorded(page);
      await expect(prompt).toHaveCount(0);
      await page.waitForTimeout(1_500);
      await expect(prompt).toHaveCount(0);

      // The wait costs the session nothing: the one interruptive slot is still
      // unspent, so whichever surface is genuinely next may still take it.
      const budget = await page.evaluate(() =>
        window.sessionStorage.getItem("pubmax:prompt-budget:v1"));
      expect(budget).toBe(null);
      expect(beacons, "analytics fired before an answer or Allow").toEqual([]);
    });
  }

  for (const arrival of ARRIVALS) {
    test(`the consent card arrives after the first answer and clears ${arrival.what} on ${arrival.path} @${size}`, async ({ page }) => {
      test.setTimeout(90_000);
      const beacons = await prepareUnanswered(page, viewport);

      // Reaching a second route qualifies as an answer. The first route is
      // recorded by the product before this document navigation, as it would
      // be after a reader follows a list link or tab.
      await page.goto("/privacy", { waitUntil: "domcontentloaded" });
      const prompt = page.getByLabel("Anonymous analytics choice");
      await expect(prompt).toHaveCount(0);
      await firstRouteRecorded(page);

      await page.goto(arrival.path, { waitUntil: "domcontentloaded" });
      await expect(prompt).toBeVisible({ timeout: 30_000 });

      const promptBox = await prompt.boundingBox();
      expect(promptBox).not.toBeNull();
      await expect
        .poll(() => firstAnchorBox(page, arrival.anchors), {
          message: `${arrival.path} rendered ${arrival.what}`,
          timeout: 15_000,
        })
        .not.toBeNull();
      const listing = await firstAnchorBox(page, arrival.anchors);
      expect(
        boxesOverlap(promptBox as Box, listing as Box),
        `the docked consent card covers ${arrival.what}`,
      ).toBe(false);

      // DOCKED, NOT FLOATING: full bleed to both edges and flush to the bottom
      // chrome, so it reads as part of the chrome rather than a panel hovering
      // over the answer.
      const box = promptBox as Box;
      expect(box.x).toBeLessThanOrEqual(1);
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);

      // The foot is the RESERVED LANE, not the tab bar's own bounding box: that
      // element is a full-bleed padded container holding the pill, so its top
      // edge sits above the lane the body reserves and measuring against it
      // would call a flush card 10px adrift. --tabbar-h is the one number both
      // the bar and the body's clearance read (components/nav/mobileNav.css).
      const lane = await page.evaluate(() => {
        if (document.querySelector(".mobileTabBar, .mobileTabBarClearance") === null) return 0;
        const raw = getComputedStyle(document.documentElement)
          .getPropertyValue("--tabbar-h");
        return Number.parseFloat(raw) || 0;
      });
      expect(
        Math.abs(box.y + box.height - (viewport.height - lane)),
        `card foot ${box.y + box.height} against the reserved lane ${viewport.height - lane}`,
      ).toBeLessThanOrEqual(1);

      // No overlay and no dim: the card is opaque and nothing behind it is
      // greyed, so a blur or a scrim here would be the floating panel again.
      const paint = await prompt.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          backdropFilter: style.backdropFilter,
          boxShadow: style.boxShadow,
          borderRadius: style.borderTopLeftRadius,
        };
      });
      expect(paint.backdropFilter === "none" || paint.backdropFilter === "").toBe(true);
      expect(paint.boxShadow === "none" || paint.boxShadow === "").toBe(true);
      expect(paint.borderRadius).toBe("0px");
      expect(beacons, "analytics fired before Allow").toEqual([]);

      await prompt.getByRole("button", { name: "No thanks", exact: true }).click();
      await expect(prompt).toHaveCount(0);
      await expect.poll(() => page.evaluate(() =>
        window.localStorage.getItem("pubmaxx:analytics-consent:v1")))
        .toBe("denied");
      if (arrival.path === "/tonight") {
        const firstPub = page.locator(".tonightHypedRow").first();
        const mapAction = firstPub.getByRole("link", { name: "Open on map" });
        await expect(mapAction).toBeVisible();
        const actionBox = await mapAction.boundingBox();
        expect(actionBox?.height).toBeGreaterThanOrEqual(44);
        expect(boxesOverlap(actionBox as Box, box)).toBe(false);
        await firstPub.locator("summary").click();
        await expect(firstPub.locator(".tonightHypedWhy")).toBeVisible();
        await expect(firstPub.locator(".tonightHypedSource")).toBeVisible();
        await expect(firstPub.getByRole("link", { name: "Open on map" })).toBeVisible();
        await expect(page.locator(".tonightWeather")).toContainText(/sky|weather|wind/i);

        const morePubs = page.locator(".tonightHypedMore");
        await morePubs.locator(":scope > summary").click();
        await expect(morePubs).toHaveAttribute("open", "");
        const chevronDirection = (summary: import("@playwright/test").Locator) =>
          summary.locator(".tonightHypedMoreChevron").evaluate((arrow) => {
            const transform = getComputedStyle(arrow).transform;
            return transform === "none" ? 1 : Math.round(new DOMMatrixReadOnly(transform).a);
          });
        await expect.poll(() => chevronDirection(morePubs.locator(":scope > summary"))).toBe(-1);
        await expect(page.locator(".tonightHypedDetails")).toHaveCount(1);
        const laterPubs = (await page.locator(".tonightHypedRow").all()).slice(1);
        expect(laterPubs.length).toBeGreaterThan(0);
        for (const pub of laterPubs) {
          await expect(pub.locator(".tonightHypedWhy")).toBeVisible();
          await expect(pub.locator(".tonightHypedSource")).toBeVisible();
          await expect(pub.locator(".tonightHypedChecked")).toBeVisible();
          const sourceBox = await pub.locator(".tonightHypedSource").boundingBox();
          expect(sourceBox?.height).toBeGreaterThanOrEqual(44);
        }
        const firstSummary = firstPub.locator("summary");
        await expect.poll(() => chevronDirection(firstSummary)).toBe(-1);
        await firstSummary.click();
        await expect.poll(() => chevronDirection(firstSummary)).toBe(1);
        await expect(morePubs).toHaveAttribute("open", "");
      }
      await page.goto("/privacy", { waitUntil: "domcontentloaded" });
      await firstRouteRecorded(page);
      await expect(prompt).toHaveCount(0);
      expect(beacons, "analytics fired after No thanks").toEqual([]);
    });
  }

  test(`no analytics request leaves the device before Allow @${size}`, async ({ page }) => {
    test.setTimeout(90_000);
    await prepareUnanswered(page, viewport);

    // Every rail a consented visit uses: the named product events route, the
    // first-party PostHog proxy and Vercel's own insights beacon.
    const beacons: string[] = [];
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (
        /\/api\/events(\?|$)/.test(url)
        || url.includes("/ingest/")
        || url.includes("/_vercel/insights")
        || url.includes("posthog.com")
      ) {
        beacons.push(url);
      }
      await route.fallback();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await firstRouteRecorded(page);
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    expect(beacons, `analytics fired before Allow: ${beacons.join(", ")}`).toEqual([]);

    await prompt.getByRole("button", { name: "Allow" }).click();
    await expect
      .poll(() => page.evaluate(() =>
        window.localStorage.getItem("pubmaxx:analytics-consent:v1")))
      .toBe("granted");
  });
}

test("consent refreshes after a Places city selection and pointer return from Map", async ({ page }) => {
  test.setTimeout(90_000);
  const beacons = await prepareUnanswered(page, { width: 768, height: 1024 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/places", { waitUntil: "domcontentloaded" });
  await firstRouteRecorded(page);
  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toHaveCount(0);

  await page.getByRole("list", { name: "Cities", exact: true })
    .getByRole("link", { name: /London/ }).click();
  await expect(page.getByRole("heading", { name: "London", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Set as my city", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("This is your city.");
  await page.getByRole("link", { name: "Open the map", exact: true }).click();
  await expect(page).toHaveURL(/\/map(?:\?|$)/);
  await expect(page.locator(".mapArrivalCard:visible, .citySuggestBanner:visible").first())
    .toBeVisible({ timeout: 30_000 });
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    window.sessionStorage.getItem("pubmax:prompt-budget:v1"))).toBeNull();

  await page.getByRole("navigation", { name: "Site navigation", exact: true })
    .getByRole("link", { name: "Places", exact: true }).click();
  await expect(page).toHaveURL(/\/places$/);
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() =>
    window.sessionStorage.getItem("pubmax:prompt-budget:v1"))).toBe("analytics-consent");
  expect(beacons, "analytics fired before Allow on the pointer journey").toEqual([]);
  await prompt.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(prompt).toHaveCount(0);
  await page.getByRole("navigation", { name: "Site navigation", exact: true })
    .getByRole("link", { name: "Map", exact: true }).click();
  await expect(page).toHaveURL(/\/map(?:\?|$)/);
  await page.getByRole("navigation", { name: "Site navigation", exact: true })
    .getByRole("link", { name: "Places", exact: true }).click();
  await expect(page).toHaveURL(/\/places$/);
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("pubmaxx:analytics-consent:v1"))).toBe("denied");
  expect(beacons, "analytics fired after No thanks on the pointer journey").toEqual([]);
});
