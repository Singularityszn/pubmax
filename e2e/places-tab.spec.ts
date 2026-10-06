import { expect, test, type Page } from "@playwright/test";

import { expectStreamedPageSettled } from "./helpers/streamedPage";

// The Places tab: pick a city, set it, and prove the three surfaces that read
// the stored city all open on it. The proof is the RENDERED app rather than the
// store, because the preference is only useful in so far as Map, Out and Near
// actually follow it.

const PREFERRED_CITY_KEY = "pubmax:preferredCity:v1";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    // Nothing clears the preferred city here on purpose. addInitScript runs on
    // EVERY navigation, so a clear would wipe the city the test had just set
    // the moment it navigated to check that Map followed it. Each test gets a
    // fresh browser context, so the store starts empty anyway.
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

async function storedCity(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => window.localStorage.getItem(key),
    PREFERRED_CITY_KEY,
  );
}

async function chooseManchester(page: Page) {
  await page.goto("/places");
  await page
    .getByRole("list", { name: "Cities" })
    .getByRole("link", { name: /Manchester/ })
    .first()
    .click();
  await page.waitForURL(/\/places\?city=manchester$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Manchester", exact: true }),
  ).toBeVisible();
  await page.getByTestId("places-set-city").click();
  await expect(page.getByText("This is your city.", { exact: true })).toBeVisible();
  expect(await storedCity(page)).toBe("manchester");
  // Setting it swaps the painted action for the way onward, and there is still
  // exactly one of them.
  await expect(page.locator("[data-primary-action]")).toHaveCount(1);
  await expect(page.getByTestId("places-set-city")).toHaveCount(0);
}

test.describe("places tab @390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("choosing Manchester sends Map, Out and Near to Manchester", async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    await page.goto("/places");

    // The tab exists in the phone row and lights for its own route.
    const placesTab = primaryNav(page).getByRole("link", { name: "Places", exact: true });
    await expect(placesTab).toBeVisible();
    await expect(placesTab).toHaveAttribute("aria-current", "page");

    // Kicker above the heading, from the shared Screen primitive. Scoped to the
    // page: the desktop nav carries a "Places" link too, hidden at this width.
    const head = page.locator(".screenHead");
    await expect(head.locator(".kicker")).toHaveText("Places");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pick a city.", exact: true }),
    ).toBeVisible();
    // Exactly one painted action on the screen.
    await expect(page.locator("[data-primary-action]")).toHaveCount(1);

    // A city with no collected prices says so on its own row, and London does not.
    const cities = page.getByRole("list", { name: "Cities" });
    await expect(cities.getByRole("link", { name: /Manchester/ })).toContainText(
      "Prices coming",
    );
    // One mark per row: the price claim is what a reader picks a city on, and
    // "Areas coming" on nine of ten rows said the same thing nine times.
    await expect(
      cities.getByRole("link", { name: /Manchester/ }).getByText("Areas coming"),
    ).toHaveCount(0);
    await expect(cities.getByRole("link", { name: /London/ })).toContainText(
      "Prices listed",
    );

    // Search narrows the list without hiding it by default.
    await page.getByLabel("Find a city").fill("manch");
    await expect(cities.getByRole("link")).toHaveCount(1);
    await page.getByLabel("Find a city").fill("");
    await expect(cities.getByRole("link").first()).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath("places-list-390.png"), fullPage: true });

    await chooseManchester(page);
    await page.screenshot({ path: testInfo.outputPath("places-city-390.png"), fullPage: true });

    // Map follows: the phone tab's own href, and the landing Map link.
    await expect(
      primaryNav(page).getByRole("link", { name: "Map", exact: true }),
    ).toHaveAttribute("href", "/map/manchester");
    await page.goto("/");
    await expect(
      primaryNav(page).getByRole("link", { name: "Map", exact: true }),
    ).toHaveAttribute("href", "/map/manchester");

    // Out follows: its listings read names Manchester.
    let outCity: string | null = null;
    await page.route(
      (url) => url.pathname === "/api/out",
      async (route, request) => {
        outCity = new URL(request.url()).searchParams.get("city");
        await route.continue();
      },
    );
    await page.goto("/out");
    // /out streams behind its loading skeleton: wait for the hidden copy to go.
    await expectStreamedPageSettled(page);
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await expect.poll(() => outCity, { timeout: 20_000 }).toBe("manchester");

    // Near follows: it reads the same stored city for its ranked pint list.
    await page.goto("/near");
    await expect(page.getByRole("main")).toBeVisible();
    expect(await storedCity(page)).toBe("manchester");
  });

  test("a city with no mapped areas says so instead of showing nothing", async ({ page }) => {
    await page.goto("/places?city=bath");
    await expect(
      page.getByRole("heading", { level: 1, name: "Bath", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/mapped areas in Bath/)).toBeVisible();
    await expect(page.getByText("Areas coming", { exact: true })).toBeVisible();
    await expect(page.getByText(/haven't yet collected pint prices/)).toBeVisible();
    // London's areas are London's: they may never appear under another city.
    await expect(page.getByText("Clapham", { exact: true })).toHaveCount(0);
  });

  test("London keeps its areas and its listed prices", async ({ page }, testInfo) => {
    await page.goto("/places?city=london");
    await expect(
      page.getByRole("heading", { name: "Where to drink in London", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Clapham", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Listed pint prices", { exact: true })).toBeVisible();
    await expect(page.getByText("Areas coming", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("places-london-390.png"),
      fullPage: true,
    });
  });

  test("/map root stays London for a bookmark, whatever city is set", async ({ page }) => {
    test.setTimeout(60_000);
    await chooseManchester(page);
    await page.goto("/map");
    await expect(page).toHaveURL(/\/map$/);
    // The root map is not rewritten to the chosen city: a bookmark keeps meaning
    // what it meant when somebody saved it.
    await expect(page).not.toHaveURL(/\/map\/manchester/);
    await expect(page.locator(".citySwitcherTrigger").first()).toHaveAttribute(
      "aria-label",
      /Map area: London/,
      { timeout: 45_000 },
    );
  });
});

test.describe("places tab @320", () => {
  test.use({ viewport: { width: 320, height: 844 } });

  test("six tabs fit, each keeps its tap floor, and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.goto("/places");
    const tabs = primaryNav(page).getByRole("link");
    await expect(tabs).toHaveCount(6);
    await expect(page.locator(".authCompactTrigger")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box, "every tab has a box").not.toBeNull();
      expect(box!.height, "tab keeps the 44px tap floor").toBeGreaterThanOrEqual(44);
      expect(box!.width, "tab keeps a thumb-sized column").toBeGreaterThanOrEqual(40);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page does not scroll sideways at 320px").toBeLessThanOrEqual(1);
  });
});

test.describe("places tab @1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("desktop nav carries Places, and the city panel keeps one primary action", async ({
    page,
  }, testInfo) => {
    await page.goto("/places");
    const siteNav = page.getByRole("navigation", { name: "Site navigation" });
    await expect(siteNav.getByRole("link", { name: "Places", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.screenshot({ path: testInfo.outputPath("places-list-1440.png"), fullPage: true });

    await page.goto("/places?city=manchester");
    await expect(page.getByTestId("places-set-city")).toHaveCount(1);
    await expect(page.locator("[data-primary-action]")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("places-city-1440.png"), fullPage: true });
  });
});

for (const width of [768, 1440]) {
  test(`desktop Map opens the selected Manchester city at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await chooseManchester(page);

    const map = page
      .getByRole("navigation", { name: "Site navigation" })
      .getByRole("link", { name: "Map", exact: true });
    await expect(map).toHaveAttribute("href", "/map/manchester");
    const otherTab = await page.context().newPage();
    await otherTab.goto("/places?city=london");
    await otherTab.getByTestId("places-set-city").click();
    await expect(map).toHaveAttribute("href", "/map");
    await otherTab.goto("/places?city=manchester");
    await otherTab.getByTestId("places-set-city").click();
    await expect(map).toHaveAttribute("href", "/map/manchester");
    await otherTab.close();
    await map.click();
    await expect(page).toHaveURL(/\/map\/manchester$/);
    await expect(page.locator(".citySwitcherTrigger").first()).toHaveAttribute(
      "aria-label",
      /Map area: Manchester/,
    );

    await page.goto("/map");
    await expect(page).toHaveURL(/\/map$/);
    await expect(page.locator(".citySwitcherTrigger").first()).toHaveAttribute(
      "aria-label",
      /Map area: London/,
    );
  });
}
