import { expect, test, type Page } from "@playwright/test";

// The city picker at /places: pick a city, set it, and prove the surfaces that
// read the stored city open on it. The proof is the RENDERED app rather than
// the store, because the preference is only useful in so far as Map and Near
// actually follow it.
//
// Product owner, Oct 2026 UX audit: Places is a setting, not a tab. The primary
// row is Map, Tonight, Plan, You; the picker is reached from the map's city
// chip ("Search a UK town") and the footer's "Pick your city", and its list
// names only the cities with listed prices plus one waitlist line.

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
  // Manchester has no listed prices, so it is not a row on the list; its
  // panel still answers at its own address.
  await page.goto("/places?city=manchester");
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

  test("choosing Manchester sends Map and Near to Manchester", async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    await page.goto("/places");

    // Not a tab: the phone row has no Places door, and no door lights here.
    await expect(primaryNav(page).getByRole("link", { name: "Places", exact: true })).toHaveCount(0);
    await expect(primaryNav(page).locator('[aria-current="page"]')).toHaveCount(0);

    // Kicker above the heading, from the shared Screen primitive. Scoped to the
    // page: the desktop nav carries a "Places" link too, hidden at this width.
    const head = page.locator(".screenHead");
    await expect(head.locator(".kicker")).toHaveText("Places");
    await expect(
      page.getByRole("heading", { level: 1, name: "London only, for now.", exact: true }),
    ).toBeVisible();
    // Exactly one painted action on the screen.
    await expect(page.locator("[data-primary-action]")).toHaveCount(1);

    await expect(page.getByRole("link", { name: "Open London", exact: true })).toHaveAttribute("href", "/places?city=london");
    await expect(page.getByText("London is the one city with listed pint prices.", { exact: false })).toBeVisible();
    await expect(page.getByText("Prices coming", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Browse pubs across the UK", exact: true })).toHaveAttribute("href", /\/map/);
    await expect(page.getByText(/Outside London the map shows the pubs, without prices yet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Want your city next? Tell us.", exact: true }))
      .toHaveAttribute("href", "mailto:hello@pubmaxxing.com?subject=City%20request");
    const field = page.getByLabel("Find a town");
    await field.fill("manch");
    await expect(page.getByRole("list", { name: "Places" }).getByRole("link", { name: /Manchester/ }).first()).toBeVisible({ timeout: 20_000 });
    await field.fill("zzzznotatown");
    await expect(page.getByRole("list", { name: "Places" })).toHaveCount(0);
    await expect(page.locator(".placesResults")).toContainText(/No .*zzzznotatown/);
    await field.fill("");
    await expect(page.getByRole("link", { name: "Open London", exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Places" })).toHaveCount(0);

    await page.screenshot({ path: testInfo.outputPath("places-list-390.png"), fullPage: true });

    await chooseManchester(page);
    await page.screenshot({ path: testInfo.outputPath("places-city-390.png"), fullPage: true });

    // Map follows: the phone tab's own href, and the landing Map link.
    await expect(
      primaryNav(page).getByRole("link", { name: "Explore", exact: true }),
    ).toHaveAttribute("href", "/map/manchester");
    await page.goto("/");
    await expect(
      primaryNav(page).getByRole("link", { name: "Explore", exact: true }),
    ).toHaveAttribute("href", "/map/manchester");

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

  test("all five dock tabs fit, each keeps its tap floor, and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.goto("/places");
    const tabs = primaryNav(page).getByRole("link");
    await expect(tabs).toHaveCount(5);
    for (const name of ["Explore", "Tonight", "Plan", "Social", "You"]) {
      await expect(primaryNav(page).getByRole("link", { name, exact: true })).toHaveCount(1);
    }
    // The Pub Pal's door left the dock for the top bar (captain, 1 Nov 2026).
    await expect(
      page.getByRole("navigation", { name: "Site navigation" }).getByRole("link", { name: "Pub Pal", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".authCompactTrigger")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box, "every tab has a box").not.toBeNull();
      expect(box!.height, "tab keeps the 44px tap floor").toBeGreaterThanOrEqual(44);
      expect(box!.width, "tab keeps a thumb-sized column").toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page does not scroll sideways at 320px").toBeLessThanOrEqual(1);
  });
});

test.describe("places tab @1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("desktop nav carries no Places door, and the city panel keeps one primary action", async ({
    page,
  }, testInfo) => {
    await page.goto("/places");
    const siteNav = page.getByRole("navigation", { name: "Site navigation" });
    await expect(siteNav.getByRole("link", { name: "Places", exact: true })).toHaveCount(0);
    await expect(siteNav.locator('.siteNavLinks [aria-current="page"]')).toHaveCount(0);

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
      .getByRole("link", { name: "Explore", exact: true });
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
