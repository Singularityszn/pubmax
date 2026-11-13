import { isNonPublicVenueName } from "@/lib/venueKindFilters";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const INTENT_KEY = "pubmax:planning-intent:v1";
const CARRIED = "Carried over from what you accepted";

async function firstVenue(request: APIRequestContext) {
  const venues = ((await (await request.get("/data/venues_slim.json")).json()) as { rows: Array<{
    id: string;
    name: string;
  }> }).rows.filter((venue) => !isNonPublicVenueName(venue.name));
  const venue = venues[0];
  expect(venue).toBeTruthy();
  return venue!;
}

async function seedAcceptedVenue(
  page: Page,
  venue: { id: string; name: string },
) {
  await page.addInitScript(
    ([accepted, key]) => {
      const now = Date.now();
      window.sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        source: "near",
        cityId: "london",
        acceptedVenueId: accepted.id,
        acceptedArea: { kind: "night-patch", id: "soho" },
        startsAt: null,
        displayEvidence: { kind: "price", observedAt: null },
        acceptedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      }));
    },
    [venue, INTENT_KEY] as const,
  );
}

test("accepted Venue becomes visible Stop 1 on the permanent Plan path", async ({ page, request }) => {
  const venue = await firstVenue(request);
  await seedAcceptedVenue(page, venue);

  await page.goto("/plan");
  await expect(page.getByText(CARRIED)).toBeVisible();
  await expect(page.locator(".planStop__name").first()).toHaveText(venue!.name);
  await expect(page.getByText(venue!.name).first()).toBeVisible();
  // The summary is pre-answered with the venue's NAME, never its id.
  await expect(page.locator("body")).not.toContainText(venue!.id);

  await page.reload();
  await expect(page.locator(".planStop__name").first()).toHaveText(venue!.name);
});

for (const width of [390, 768, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`adding a stop keeps the accepted estimate and pub finder visible at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((choice) => localStorage.setItem("pubmax-theme", choice), theme);
      await seedAcceptedVenue(page, { id: "venue-60y3sa", name: "The Coronet" });
      // Ten recorded £5.75 pints give an independent £5.75 zone median.
      await page.route("**/data/venues_slim.json*", (route) => route.fulfill({ json: {
        bundlePricesChecked: true,
        recordedPintVenueIds: [],
        rows: [
          { id: "venue-60y3sa", name: "The Coronet", zone: 2, cheapestPrice: null },
          ...Array.from({ length: 10 }, (_, index) => ({
            id: `priced-pub-${index}`, name: `Priced pub ${index}`, zone: 2, cheapestPrice: 5.75,
          })),
        ],
      } }));
      await page.route("**/api/pint-drops?*", (route) => route.fulfill({ json: { drops: [] } }));
      await page.route("**/api/price-submit?*", (route) => route.fulfill({ json: { prices: [] } }));
      await page.goto("/plan");
      const accepted = page.locator(".planStop").first();
      await expect(accepted).toContainText("est. £5.75");
      await page.getByRole("button", { name: "Add another stop", exact: true }).click();
      const finder = page.getByLabel("Find a pub for stop 2", { exact: true });
      await expect(finder).toBeVisible();
      await expect(accepted).toBeVisible();
      await expect(accepted).toContainText("The Coronet");
      await expect(accepted).toContainText("est. £5.75");
      await finder.fill("Priced pub 0");
      await finder.press("Enter");
      await expect(page.locator(".planStop__name").nth(1)).toHaveText("Priced pub 0");
      await page.getByRole("button", { name: "Show Remove for stop 2", exact: true }).click();
      await page.getByRole("button", { name: "Remove stop 2", exact: true }).click();
      await expect(page.locator(".planStop")).toHaveCount(1);
      await expect(accepted).toBeVisible();
      await expect(accepted).toContainText("est. £5.75");
    });
  }
}

test("existing Plan work wins without consuming a newer accepted Venue", async ({ page }) => {
  const existing = { id: "venue-xjf3n0", name: "Arnos Arms" };
  const accepted = { id: "venue-122cuu1", name: "The Queen’s Head" };
  const planId = "22222222-2222-4222-8222-222222222222";
  await page.addInitScript(([intentKey, existingVenue, acceptedVenue]) => {
    const now = Date.now();
    const startTime = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(now + 3 * 60 * 60 * 1000)).replace(" ", "T");
    sessionStorage.setItem("pubmaxx:plan-draft:v1", JSON.stringify({
      title: "Saved night",
      creatorName: "",
      startTime,
      conciergeQuery: "",
      stops: [
        { key: 1, venueId: existingVenue.id, venueName: existingVenue.name },
        { key: 2, venueId: "venue-phqazo", venueName: "The Lyric" },
        { key: 3, venueId: "venue-11iolkd", venueName: "The Crown" },
      ],
    }));
    sessionStorage.setItem(intentKey, JSON.stringify({
      version: 1,
      source: "near",
      cityId: "london",
      acceptedVenueId: acceptedVenue.id,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
      acceptedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    }));
  }, [INTENT_KEY, existing, accepted] as const);
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: { plan: { id: planId } },
        created: true,
        grounded: false,
      }),
    });
  });

  await page.goto("/plan");
  await expect(page.locator(".planStop__name").first()).toHaveText(existing.name);
  await expect(page.getByText(
    "Kept existing Plan work instead of replacing it with a newer Venue acceptance.",
  )).toBeVisible();
  await expect(page.locator(".planStop__name").first()).not.toHaveText(accepted.name);
  await page.getByLabel("Your name").fill("Karan");
  await page.getByRole("button", { name: "Lock it in" }).click();

  await expect(page).toHaveURL(new RegExp(`/plan/${planId}`));
  expect(await page.evaluate((key) => sessionStorage.getItem(key), INTENT_KEY)).not.toBeNull();
});

test("successful Plan creation consumes accepted Venue intent", async ({ page, request }) => {
  const venue = await firstVenue(request);
  await seedAcceptedVenue(page, venue);
  const planId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: { plan: { id: planId } },
        created: true,
        grounded: false,
      }),
    });
  });

  await page.goto("/plan");
  await expect(page.locator(".planStop__name").first()).toHaveText(venue.name);
  await page.getByLabel("Your name").fill("Karan");
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();

  await expect(page).toHaveURL(new RegExp(`/plan/${planId}`));
  expect(await page.evaluate((key) => sessionStorage.getItem(key), INTENT_KEY)).toBeNull();
});

test("failed Plan creation retains accepted Venue intent", async ({ page, request }) => {
  const venue = await firstVenue(request);
  await seedAcceptedVenue(page, venue);
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Could not create the Plan." } }),
    });
  });

  await page.goto("/plan");
  await expect(page.locator(".planStop__name").first()).toHaveText(venue.name);
  await page.getByLabel("Your name").fill("Karan");
  await page.getByRole("button", { name: "Lock it in" }).click();

  await expect(page.locator(".planComposer__error")).toContainText("Could not create the Plan.");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), INTENT_KEY)).not.toBeNull();
});
