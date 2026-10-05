import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [320, 390, 430] as const;
const SHOTS_DIR = "docs/screenshots/out-l1";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

/** Playwright globs match the full URL, so an /api/out pattern also matches /api/outage. */
function isOutListingsRequest(url: URL): boolean {
  return url.pathname === "/api/out";
}

const READY_EMPTY_OUT = {
  status: "ready",
  events: [],
  openPlans: [],
  openPlansStatus: "ready",
  attribution: [],
  observedAt: {},
  providers: [{ name: "ticketmaster", configured: true, rows: 0, status: "ready" }],
  venueMatch: "ready",
} as const;

async function mockReadyEmptyOut(page: Page) {
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(READY_EMPTY_OUT),
    }),
  );
}

// Three ordinary links behind a disclosure, so they are found as links. Scoped
// to the sheet itself: /out prints its own "Start a plan" way out under Open
// plans, and a page-wide role query matches both.
function createRow(page: Page, name: string) {
  return page.locator(".createFabMenu").getByRole("link", { name, exact: true });
}

async function openCreateMenu(page: Page) {
  const create = page.getByTestId("create-fab");
  await expect(create).toBeVisible();
  // A plain click on purpose: the actionability and occlusion checks ARE the
  // proof that the control and its sheet are clear of the tab bar at every
  // phone width. A forced click would pass through whatever covered them.
  await create.click();
  await expect(createRow(page, "Post a moment")).toBeVisible();
}

for (const width of WIDTHS) {
  test.describe(`out tab @${width}`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("shows the Out tab, renders /out, and the create action reaches each row", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      // This test is phone chrome and the create sheet, not the Open plans
      // lane. A live keyless /api/out answers openPlansStatus: degraded, and
      // the product must paint that honesty region rather than an empty market.
      // Hold the lane to a ready-empty body so the chrome assertions do not
      // race the store, the same isolation the listings tests already use.
      await mockReadyEmptyOut(page);
      await page.goto("/out");
      const out = primaryNav(page).getByRole("link", { name: "Out", exact: true });
      await expect(out).toBeVisible();
      await expect(out).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("out-screen")).toBeVisible();
      await expect(page.getByRole("heading", { name: "What’s on tonight." })).toBeVisible();
      // /out is not a crawlable family yet: it duplicates /tonight's baseline
      // rows, so it ships noindex with no canonical of its own. Read it on the
      // server-rendered document a crawler gets, before any chip's client-side
      // navigation can briefly leave the old page's metadata beside the new.
      await expect.poll(() => page.locator('meta[name="robots"]').evaluateAll(
        (tags) => tags.length > 0 && tags.every((tag) =>
          tag.getAttribute("content")?.split(",").some(
            (directive) => directive.trim().toLowerCase() === "noindex",
          ),
        ),
      )).toBe(true);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      // The day chips are LINKS, not radios: each is a destination, so they keep
      // the link role and say where they are with aria-current.
      const when = page.getByRole("navigation", { name: "When" });
      const tonightChip = when.getByRole("link", { name: "Tonight", exact: true });
      await expect(tonightChip).toBeVisible();
      await expect(tonightChip).toHaveAttribute("aria-current", "page");
      await when.getByRole("link", { name: "Tomorrow", exact: true }).click();
      await page.waitForURL(/\/out\?day=tomorrow$/);
      await expect(
        when.getByRole("link", { name: "Tomorrow", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("heading", { level: 1, name: "What’s on tomorrow.", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "What's on tomorrow", exact: true }),
      ).toBeVisible();
      // Space activates a focused chip the way Enter does.
      const weekendChip = when.getByRole("link", { name: "Weekend", exact: true });
      await weekendChip.focus();
      await page.keyboard.press(" ");
      await page.waitForURL(/\/out\?day=weekend$/);
      await expect(
        when.getByRole("link", { name: "Weekend", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      // The heading names the window the chip selected, so the list never sits
      // under another night's name.
      await expect(
        page.getByRole("heading", { name: "What's on the weekend", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: "What’s on the weekend.", exact: true }),
      ).toBeVisible();
      await tonightChip.focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/out$/);
      await expect(tonightChip).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("heading", { level: 1, name: "What’s on tonight.", exact: true }),
      ).toBeVisible();

      // Listings land first; open plans stay a quieter lane below.
      const listings = page.getByRole("region", { name: "What's on tonight" });
      await expect(listings).toBeVisible();
      await expect(
        listings.getByRole("heading", { name: "What's on tonight", exact: true }),
      ).toBeVisible();

      // Open plans stays hidden when no sendable plan lands.
      await expect(page.getByRole("region", { name: "Open plans" })).toHaveCount(0);

      // /out is not a crawlable family yet: it duplicates /tonight's baseline
      // rows, so it ships noindex with no canonical of its own.
      // A soft navigation can leave the outgoing route's robots tag in the head
      // beside the incoming one for a frame, so every robots tag present must
      // say noindex, not only the first.
      const robots = page.locator('meta[name="robots"]');
      await expect(robots.first()).toBeAttached();
      for (const content of await robots.evaluateAll((tags) =>
        tags.map((tag) => tag.getAttribute("content")),
      )) {
        expect(content).toMatch(/noindex/);
      }
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

      await openCreateMenu(page);
      await createRow(page, "Post a moment").click();
      await page.waitForURL(/\/moment\?returnTo=/);

      await page.goto("/out");
      await openCreateMenu(page);
      await createRow(page, "Log a price").click();
      await page.waitForURL(/\/map\?contribute=price/, { timeout: 45_000 });

      await page.goto("/out");
      await openCreateMenu(page);
      await createRow(page, "Start a plan").click();
      await page.waitForURL(/\/plan$/);
      // The action is mounted in the root layout, so a client-side navigation
      // leaves it mounted: a sheet nobody closed stays painted over wherever it
      // sent you.
      await expect(createRow(page, "Start a plan")).toHaveCount(0);
    });
  });
}

const PLAYHOUSE_EVENT = {
  id: "events-tm-playhouse",
  placeName: "Soho Theatre",
  kind: "event",
  startsAt: "2026-08-16T19:00:00.000Z",
  title: "A Night at the Playhouse",
  source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
  observedAt: "2026-08-16T09:00:00.000Z",
  confidence: "listed",
  sourceId: "1",
};

test(
  "shows every sourced listing, matched or not, when GET /api/out is ready",
  async ({ page }) => {
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ready",
          events: [
            {
              ...PLAYHOUSE_EVENT,
              venueId: "venue-playhouse",
            },
            {
              ...PLAYHOUSE_EVENT,
              id: "events-tm-unmatched-playhouse",
              title: "Unmatched Playhouse",
              placeName: "The O2",
            },
          ],
          openPlans: [],
          attribution: [],
          observedAt: {},
          providers: [{ name: "ticketmaster", configured: true, rows: 2, status: "ready" }],
          venueMatch: "ready",
        }),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    // BOTH rows are real rows. The pub is a footnote on the row, not a filter.
    await expect(page.getByRole("heading", { name: "A Night at the Playhouse" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unmatched Playhouse" })).toBeVisible();
    await expect(page.locator(".outListingPubPair--absent")).toHaveText(
      "We haven’t linked this place to a pub on our map.",
    );
    await expect(
      page.locator(".outListingPubPair--matched").getByRole("link", { name: "Open on map" }),
    ).toHaveAttribute("href", "/map?sel=venue-playhouse");
    // The match RAN, so no page-level notice has anything left to say.
    await expect(page.getByTestId("out-venue-match-notice")).toHaveCount(0);
    const listings = page.getByRole("region", { name: "What's on tonight" });
    await expect(listings).toBeVisible();
    await expect(page.getByRole("region", { name: "Open plans" })).toHaveCount(0);
  },
);

// The supply truth on a phone: rows exist and none is at a listed pub. Every
// one of them is a row the reader can open, each saying for itself that we
// hold no pub for it. The page says something different only when the match
// could not RUN, or when the providers returned nothing at all.
test.describe("out supply honesty @390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const ARENAS = ["Jazz Cafe", "Up The Creek", "Soul Mama", "The Comedy Store"];

  function unmatchedPayload(venueMatch: "ready" | "unavailable" | undefined) {
    return {
      status: "ready",
      listingsStatus: "ready",
      events: ARENAS.map((placeName, index) => ({
        ...PLAYHOUSE_EVENT,
        id: `events-tm-arena-${index}`,
        sourceId: `arena-${index}`,
        title: `Show ${index + 1}`,
        placeName,
      })),
      openPlans: [],
      attribution: [{ label: "Ticketmaster", logoRequired: false, url: "https://www.ticketmaster.co.uk/" }],
      observedAt: {},
      providers: [{ name: "ticketmaster", configured: true, rows: 4, status: "ready" }],
      ...(venueMatch ? { venueMatch } : {}),
    };
  }

  test("prints every row, keeps the map as the primary, and credits the provider", async ({
    page,
  }) => {
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(unmatchedPayload("ready")),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    // Four sourced listings, four rows. This is the walk-B4 shape.
    await expect(page.getByTestId("out-listing-row")).toHaveCount(4);
    for (const index of [1, 2, 3, 4]) {
      await expect(page.getByRole("heading", { name: `Show ${index}` })).toBeVisible();
    }
    await expect(page.locator(".outListingPubPair--absent")).toHaveCount(4);
    // The primary is a product action. A listing title never wears the fill.
    const primary = page.locator("[data-primary-action] a");
    await expect(primary).toHaveText("Open the map");
    await expect(primary).toHaveAttribute("href", "/map");
    const credit = page.getByTestId("out-listing-credit");
    await expect(credit.getByRole("link", { name: "Ticketmaster", exact: true })).toHaveAttribute(
      "href",
      "https://www.ticketmaster.co.uk/",
    );
    // No apology stands in place of the listings it counts.
    await expect(page.getByTestId("out-venue-match-notice")).toHaveCount(0);
    await expect(page.getByText("No listings for this day yet.")).toHaveCount(0);
    await expect(page.getByText(/^Some /)).toHaveCount(0);
    await expect(page.getByText(/don't list yet/)).toHaveCount(0);
    // The notice fits the phone: nothing pushes the page wider than the viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  // The live shape on 13 Sep 2026 (site audit D4): 25 listings, every one
  // Ticketmaster, the match ran and placed none of them at a pub we list. The
  // page led with the first title ("Burlesque") as its filled primary.
  test("leads a night with no confirmed pub matches with the honest line, then the rest", async ({
    page,
  }) => {
    const events = Array.from({ length: 25 }, (_, index) => ({
      ...PLAYHOUSE_EVENT,
      id: `events-tm-live-${index}`,
      sourceId: `live-${index}`,
      title: index === 0 ? "Burlesque" : `Live listing ${index + 1}`,
      placeName: `Arena ${index + 1}`,
    }));
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...unmatchedPayload("ready"),
          events,
          providers: [
            { name: "ticketmaster", configured: true, rows: 25, status: "ready" },
            { name: "skiddle", configured: false, rows: 0, status: "not-configured" },
          ],
          unmatchedCount: 25,
        }),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("out-listing-row")).toHaveCount(25);

    const primary = page.locator("[data-primary-action] a");
    await expect(primary).toHaveCount(1);
    await expect(primary).toHaveText("Open the map");
    await expect(page.locator("[data-primary-action]")).not.toContainText("Burlesque");

    const lead = page.getByTestId("out-honest-empty");
    await expect(lead).toContainText("We couldn’t match any of tonight’s 25 listings to a pub on our map.");
    await expect(lead.getByRole("link", { name: "Tonight’s pubs", exact: true })).toHaveAttribute(
      "href",
      "/tonight",
    );

    // Heading order: the section, then the honest line, then the block of
    // listings under its own heading.
    const headings = await page
      .locator("#main :is(h1, h2, h3)")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
    const sectionAt = headings.indexOf("What's on tonight");
    const blockAt = headings.indexOf("Places we couldn’t match");
    expect(headings[0]).toBe("What’s on tonight.");
    expect(sectionAt).toBeGreaterThan(0);
    expect(blockAt).toBeGreaterThan(sectionAt);
    const leadBox = await lead.boundingBox();
    const blockBox = await page.locator("#out-unmatched-heading").boundingBox();
    const firstRowBox = await page.getByTestId("out-listing-row").first().boundingBox();
    expect(leadBox!.y).toBeLessThan(blockBox!.y);
    expect(blockBox!.y).toBeLessThan(firstRowBox!.y);
  });

  test("keeps an unmatched mapped pub's listing and source link without claiming absence", async ({
    page,
  }) => {
    const event = {
      ...PLAYHOUSE_EVENT,
      id: "events-tm-1avwitg",
      title: "Mumble",
      placeName: "New Cross Inn",
      kind: "music",
      startsAt: "2026-09-29T16:00:00.000Z",
      observedAt: "2026-09-29T08:04:56.142Z",
      sourceId: "LvZ18QE6wsOZl6I7OLTDV",
      lat: 51.475524,
      lng: -0.03838,
      source: {
        label: "Ticketmaster",
        url: "https://www.universe.com/events/mumble-tickets-SYX6QN?ref=ticketmaster",
      },
    };
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...unmatchedPayload("ready"),
          events: [event],
          unmatchedCount: 1,
          unmatchedPlaces: [event.placeName],
          unmatchedPlaceCount: 1,
        }),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    const row = page.getByTestId("out-listing-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("New Cross Inn");
    await expect(row.locator(".outListingPubPair--absent")).toHaveText(
      "We haven’t linked this place to a pub on our map.",
    );
    await expect(row.locator("a.outCard")).toHaveAttribute("href", event.source.url);
    await expect(page.getByTestId("out-honest-empty")).toContainText(
      "We couldn’t match tonight’s listing to a pub on our map.",
    );
  });

  test("says the check could not run rather than calling the places unlisted", async ({ page }) => {
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(unmatchedPayload("unavailable")),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    const notice = page.getByTestId("out-venue-match-notice");
    await expect(notice).toContainText(
      "We couldn't check which of tonight's 4 listings are at a pub we list.",
    );
    await expect(notice).not.toContainText("don't list yet");
    // The rows are still rows. The finding is about the LOOKUP, not about them.
    await expect(page.getByTestId("out-listing-row")).toHaveCount(4);
    await expect(page.locator(".outListingPubPair--absent").first()).toHaveText(
      "We haven’t linked this place to a pub on our map.",
    );
  });

  test("keeps the honest empty state when the providers return nothing", async ({ page }) => {
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
          providers: [{ name: "ticketmaster", configured: true, rows: 0, status: "ready" }],
          venueMatch: "ready",
        }),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText("No listings for this day yet.")).toBeVisible();
    await expect(page.getByTestId("out-venue-match-notice")).toHaveCount(0);
    // With no listings, the map is still the primary.
    await expect(page.locator("[data-primary-action] a")).toHaveText("Open the map");
  });
});

function sendableOpenPlan(id: string, title: string) {
  return {
    crewId: id,
    title,
    startTime: "2026-08-16T19:00:00.000Z",
    stopVenueId: "venue-test",
    stopVenueName: "The Test Arms",
    hostHandle: "karan",
    memberCount: 2,
    meetingPoint: {
      kind: "venue",
      name: "The Test Arms",
      lat: 51.5,
      lng: -0.1,
    },
  };
}

const PUBLIC_CREW_ID = "50000000-0000-4000-8000-000000000001";

test("shows Open plans when one sendable plan exists", async ({ page }) => {
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [],
        openPlans: [sendableOpenPlan(PUBLIC_CREW_ID, "Camden crawl")],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 0, status: "ready" }],
      }),
    }),
  );

  await page.goto("/out");
  const plans = page.getByRole("region", { name: "Open plans" });
  await expect(plans).toBeVisible();
  await expect(plans.getByRole("heading", { name: "Camden crawl" })).toBeVisible();
  await expect(plans.getByRole("link", { name: "Start a plan", exact: true })).toHaveAttribute(
    "href",
    "/plan",
  );

  await page.route(`**/api/social/crews/${PUBLIC_CREW_ID}/public`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "public",
        crewId: PUBLIC_CREW_ID,
        title: "Camden crawl",
        hostHandle: "karan",
        startsAt: "2026-08-16T19:00:00.000Z",
        meetingPoint: {
          kind: "venue",
          name: "The Test Arms",
          lat: 51.5,
          lng: -0.1,
        },
      }),
    }),
  );
  await plans.getByRole("link", { name: /Camden crawl/ }).click();
  await expect(page.getByRole("heading", { name: "Camden crawl", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meet at", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask to join", exact: true })).toBeVisible();
});

// The venue used to be a GROUP HEADING, because the desktop list grouped by
// resolved pub. It groups by the night now, so a listed pub is named on the row
// itself: once in the meta line, once in the pub pair beside it, and once more
// in the link that opens its pin. The heading that went is the venue's; the
// night's own heading is the section title when one night is on screen.
test("pairs a pub beside a gig, named on the row and linked to its pin", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [
          {
            ...PLAYHOUSE_EVENT,
            venueId: "venue-soho-theatre",
          },
        ],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 1, status: "ready" }],
      }),
    }),
  );

  await page.goto("/out");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });

  const row = page.getByTestId("out-listing-row");
  await expect(row).toHaveCount(1);
  await expect(
    row.getByRole("heading", { name: "A Night at the Playhouse", exact: true }),
  ).toBeVisible();
  // The venue is on the row's own meta line, where the gig, the place and the
  // time read as one claim.
  await expect(row.locator(".outCardPlace")).toHaveText("Soho Theatre");

  // And beside it, badged as ours, with the way to its pin.
  const pair = row.locator(".outListingPubPair--matched");
  await expect(pair.locator(".outListingPubPairName")).toHaveText("Soho Theatre");
  await expect(pair.locator(".outListingPubPairLabel")).toHaveText("On PUBMAXX");
  await expect(page.getByText("We haven’t linked this place to a pub on our map.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open on map", exact: true })).toHaveAttribute(
    "href",
    /\/map\?sel=venue-soho-theatre/,
  );
});

test("starts each desktop listing group at the top of its grid row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [
          {
            ...PLAYHOUSE_EVENT,
            id: "events-tm-marylebone",
            title: "Marylebone one-off",
            placeName: "The Arts at Marble Arch",
            venueId: "venue-marylebone",
          },
          ...Array.from({ length: 5 }, (_, index) => ({
            ...PLAYHOUSE_EVENT,
            id: `events-tm-soho-${index}`,
            sourceId: `soho-${index}`,
            title: `Soho event ${index + 1}`,
            venueId: "venue-soho-theatre",
          })),
        ],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 6, status: "ready" }],
      }),
    }),
  );

  await page.goto("/out");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });

  const maryleboneTop = await page
    .getByRole("heading", { name: "Marylebone one-off", exact: true })
    .boundingBox();
  const sohoTop = await page
    .getByRole("heading", { name: "Soho event 1", exact: true })
    .boundingBox();

  expect(maryleboneTop).not.toBeNull();
  expect(sohoTop).not.toBeNull();
  expect(Math.abs(maryleboneTop!.y - sohoTop!.y)).toBeLessThan(24);
});

// A narrower centred surface set the honest line, the block heading and every
// row 28px in from "What's on tonight" at 1440 (13 Sep 2026).
test("sets the desktop listing surface on the section title's own edge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        listingsStatus: "ready",
        events: Array.from({ length: 25 }, (_, index) => ({
          ...PLAYHOUSE_EVENT,
          id: `events-tm-edge-${index}`,
          sourceId: `edge-${index}`,
          title: `Edge listing ${index + 1}`,
          placeName: `Arena ${index + 1}`,
        })),
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 25, status: "ready" }],
        unmatchedCount: 25,
        venueMatch: "ready",
      }),
    }),
  );

  await page.goto("/out");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("out-listing-row")).toHaveCount(25);

  const sectionBox = await page.locator("#out-listings-heading").boundingBox();
  const leadBox = await page.getByTestId("out-honest-empty").boundingBox();
  const blockBox = await page.locator("#out-unmatched-heading").boundingBox();
  const firstRowBox = await page.getByTestId("out-listing-row").first().boundingBox();
  expect(sectionBox).not.toBeNull();
  expect(leadBox).not.toBeNull();
  expect(blockBox).not.toBeNull();
  expect(firstRowBox).not.toBeNull();
  for (const box of [leadBox!, blockBox!, firstRowBox!]) {
    expect(Math.abs(box.x - sectionBox!.x)).toBeLessThanOrEqual(1);
  }
});

test.describe("out tab screenshots @390", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.setTimeout(60_000);

  test("commits light and dark 390 frames", async ({ page }) => {
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/out");
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await page.screenshot({ path: `${SHOTS_DIR}/out-390-light.png`, fullPage: false });

    const theme = page.getByRole("button", { name: /switch to dark theme/i });
    if (await theme.isVisible()) {
      await theme.click();
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await page.screenshot({ path: `${SHOTS_DIR}/out-390-dark.png`, fullPage: false });
  });
});
