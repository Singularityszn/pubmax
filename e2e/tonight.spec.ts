import { test, expect, type Page } from "@playwright/test";

// First-class /tonight screen E2E. WebGL-agnostic. Fed by the PRIMARY What's-On
// spine (/api/whats-on) — same source as the map Tonight lane. Tolerant of a
// quiet upstream: always assert mount + heading; only exercise filter → map
// deep-link when rows actually returned.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

function futureListingStart(now = Date.now()) {
  return new Date(now + 2 * 60 * 60_000).toISOString();
}

async function mockReadyEmptyOut(page: Page) {
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [],
      }),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
});

test("the /tonight screen mounts with an honest header and provenance", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/tonight");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("tonight-screen")).toBeVisible();
  // Without a shared location the screen speaks for the whole city, and says
  // so: "near you" is the heading it earns only once it has a locality basis
  // (tonightHeading in lib/tonight.ts).
  await expect(
    page.getByRole("heading", { name: /what.?s on across London tonight/i }),
  ).toBeVisible();

  // The screen resolves to exactly one of: list, empty, error status. Wait for
  // the loading skeleton to clear into one of those terminal states. The lane
  // note is not one of them: it rides BESIDE whichever state landed, saying
  // which lane came up short, so it is excluded rather than counted.
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(
    page.locator(".tonightStatus:not(.tonightStatusNote), .tonightList"),
  ).toHaveCount(1, { timeout: 10_000 });

  expect(errors).toEqual([]);
});

test("unknown source freshness never displays request time as checked", async ({ page }) => {
  // Tonight waits on both lanes. A live Out body would own the provenance
  // line, and a July startsAt is past tonight so the What's-On quiz never
  // lands. This test is the undated What's-On stamp, not the Out merge.
  await mockReadyEmptyOut(page);
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        servedAt: "2026-07-15T21:59:59.000Z",
        sourceObservedAt: null,
        sourceFreshnessKind: "unknown",
        localityBasis: "london-default",
        asOf: null,
        rows: [
          {
            id: "quiz-unknown-freshness",
            venueId: "venue-xjf3n0",
            placeName: "The Test Arms",
            kind: "quiz",
            startsAt: futureListingStart(),
            title: "Quiz night",
            source: { label: "Pub listing", url: "https://example.com/quiz" },
            observedAt: "2026-07-15T21:59:59.000Z",
            confidence: "listed",
          },
        ],
      }),
    }),
  );

  await page.goto("/tonight");
  // The source cannot be dated, so the What's-On line carries no dated segment
  // and the plain sentence prints under that lane alone. Anchored on the line,
  // not on its wording.
  await expect(page.locator('[data-tonight-provenance="whats-on"]')).toHaveAttribute("data-tonight-dated", "no");
  await expect(page.locator('[data-tonight-provenance="undated-whats-on"]')).toBeVisible();
  await expect(page.getByText(/Checked 15 Jul/i)).toHaveCount(0);
});

test("filtering by kind narrows the list and rows tap into a venue", async ({
  page,
}) => {
  await page.goto("/tonight");
  await expect(page.getByTestId("tonight-screen")).toBeVisible();

  const list = page.getByTestId("tonight-list");
  // Tolerate a quiet dataset: if no list rendered (empty/error/thin), there is
  // nothing to filter — the mount test already covered the honest fallback.
  if ((await list.count()) === 0) {
    test.info().annotations.push({
      type: "note",
      description: "Upstream returned no tonight rows — filter flow skipped.",
    });
    return;
  }

  const rows = page.getByTestId("tonight-row");
  const totalRows = await rows.count();
  expect(totalRows).toBeGreaterThan(0);

  // If a kind filter chip is present (needs >1 distinct kind), clicking it must
  // not grow the visible set.
  const chips = page.locator(".tonightChip[aria-pressed='false']");
  if ((await chips.count()) > 0) {
    await chips.first().click();
    await expect(rows).not.toHaveCount(0); // an active chip always has ≥1 row
    expect(await rows.count()).toBeLessThanOrEqual(totalRows);
    // Reset to All.
    await page.locator(".tonightChip", { hasText: /^All/ }).click();
    await expect(rows).toHaveCount(totalRows);
  }

  // The first row that links into the map is a real navigation target.
  const mapLink = page.locator(".tonightRowLink[href^='/map']").first();
  if ((await mapLink.count()) > 0) {
    const href = await mapLink.getAttribute("href");
    expect(href).toMatch(/^\/map\?sel=/);
  }
});

test("location is opt-in, removable, and only used for local walk times", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__tonightLocationRequests", {
      value: 0,
      writable: true,
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          const testWindow = window as Window & { __tonightLocationRequests: number };
          testWindow.__tonightLocationRequests += 1;
          success({
            coords: {
              latitude: 51.5074,
              longitude: -0.1278,
              accuracy: 20,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  await mockReadyEmptyOut(page);
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-15T18:00:00.000Z",
        rows: [
          {
            id: "quiz-1",
            venueId: "venue-xjf3n0",
            placeName: "The Test Arms",
            kind: "quiz",
            startsAt: futureListingStart(),
            title: "Quiz night",
            source: { label: "Pub listing", url: "https://example.com/quiz" },
            observedAt: "2026-07-14T18:00:00.000Z",
            confidence: "listed",
            lat: 51.51,
            lng: -0.13,
          },
        ],
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(page.getByTestId("tonight-list")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as Window & { __tonightLocationRequests: number })
        .__tonightLocationRequests,
    ),
  ).toBe(0);
  await expect(page.getByTestId("tonight-row")).not.toContainText("min walk");

  // The location card is a collapsed quiet row until tapped — open it first.
  await page
    .getByRole("button", { name: "Walk times and last train" })
    .click();
  await page
    .getByRole("button", { name: "Share location for walk times" })
    .click();
  expect(
    await page.evaluate(() =>
      (window as Window & { __tonightLocationRequests: number })
        .__tonightLocationRequests,
    ),
  ).toBe(1);
  await expect(page.getByTestId("tonight-row")).toContainText("min walk");

  await page.getByRole("button", { name: "Remove location" }).click();
  await expect(page.getByTestId("tonight-row")).not.toContainText("min walk");
});

test("a failed listings request can be retried", async ({ page }) => {
  let requests = 0;
  // Tonight waits on both lanes, so the Out lane is held to a ready-empty
  // answer here: this test is about the What's-On retry, and a live Out body
  // would decide the screen's state instead.
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [],
      }),
    }),
  );
  await page.route("**/api/whats-on?**", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rows: [], error: "Store unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [], asOf: "2026-07-15T18:00:00.000Z" }),
    });
  });

  await page.goto("/tonight");
  await page.getByRole("button", { name: "Retry listings" }).click();
  // The retry succeeded and returned no rows, so both lanes answered with
  // nothing: an empty night, not an error, and said in the empty state's own
  // sentence rather than left as a silent room.
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute(
    "data-listings-status",
    "empty",
  );
  await expect(page.getByText(/having a quiet one tonight/i)).toBeVisible();
  await expect(page.locator('[data-tonight-provenance="whats-on"]')).toHaveText(
    /^Quiet night · /,
  );
  expect(requests).toBe(2);
});

test("mobile keeps Now as a root tab over live today and tonight", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/discover");

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("link", { name: "Now", exact: true })).toBeVisible();
  await primaryNav.getByRole("link", { name: "Now", exact: true }).click();
  await expect(page).toHaveURL(/\/(today|tonight)$/);
  await page
    .getByRole("navigation", { name: "Now" })
    .getByRole("link", { name: "Tonight", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByTestId("tonight-screen")).toBeVisible();
});

// Tonight applies the spine's past-date guard to the Out lane, so this fixture
// is dated off the run instead of off a calendar date: a listing pinned to a
// day in the past is one the page is right to drop.
function playhouseEvent(now = Date.now()) {
  return {
    id: "events-tm-playhouse",
    placeName: "Soho Theatre",
    kind: "event",
    startsAt: new Date(now + 2 * 60 * 60_000).toISOString(),
    title: "A Night at the Playhouse",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    // Never the future: an observation is a thing that has happened.
    observedAt: new Date(now - 60_000).toISOString(),
    confidence: "listed",
    sourceId: "1",
  };
}

/**
 * The Ticketmaster supply as production really serves it, measured 5 Sep 2026:
 * `GET /api/whats-on?window=tonight` answered 37 rows, all Ticketmaster
 * `kind: "event"`, and `GET /api/out?city=london` answered 52, of which 15
 * were Ticketmaster `kind: "music"` with one on the white-label partner host
 * universe.com. Every row here carries a venueId, so the pub-surface filter
 * admits them and `tonightPrimaryRows` is the only thing that can refuse them.
 */
function ticketmasterOnlyRows(now = Date.now()) {
  const startsAt = new Date(now + 2 * 60 * 60_000).toISOString();
  const observedAt = new Date(now - 60_000).toISOString();
  const base = { startsAt, observedAt, confidence: "listed" as const };
  return [
    {
      ...base,
      id: "events-tm-playhouse",
      venueId: "venue-soho-theatre",
      placeName: "Soho Theatre",
      kind: "event",
      title: "A Night at the Playhouse",
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    },
    {
      // kind "music" on a partner host: neither the kind rule nor the host
      // rule refuses this row, only its source label does.
      ...base,
      id: "events-tm-bpoom3",
      venueId: "venue-outernet",
      placeName: "Outernet Live",
      kind: "music",
      title: "Day Fever - London",
      source: {
        label: "Ticketmaster",
        url: "https://www.universe.com/events/day-fever-london-tickets-J3Q985?ref=ticketmaster",
      },
    },
    {
      ...base,
      id: "events-tm-sport-1",
      venueId: "venue-the-o2",
      placeName: "The O2",
      kind: "sport",
      title: "Boxing at the arena",
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/2" },
    },
  ];
}

test("leads with the quiet-night sentence when the whole feed is Ticketmaster", async ({
  page,
}) => {
  const rows = ticketmasterOnlyRows();
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows,
        asOf: "2026-09-05T12:00:00.000Z",
        sourceObservedAt: "2026-09-05T12:00:00.000Z",
        sourceFreshnessKind: "dataset-generated",
      }),
    }),
  );
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        listingsStatus: "ready",
        events: rows,
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [
          { name: "ticketmaster", configured: true, rows: rows.length, status: "ready" },
        ],
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });

  // Both lanes answered, and both carried nothing a pub surface may lead with.
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute(
    "data-listings-status",
    "empty",
  );
  await expect(page.getByText(/having a quiet one tonight/i)).toBeVisible();
  await expect(page.locator('[data-tonight-provenance="whats-on"]')).toHaveText(
    /^Quiet night · /,
  );

  // No Ticketmaster title reaches the first screen, whatever kind it arrived as.
  for (const title of [
    "A Night at the Playhouse",
    "Day Fever - London",
    "Boxing at the arena",
  ]) {
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  }
});

test("does not promote Out theatre rows when What's-On answered empty", async ({ page }) => {
  const event = playhouseEvent();
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        asOf: "2026-08-16T12:00:00.000Z",
        sourceObservedAt: "2026-08-16T12:00:00.000Z",
        sourceFreshnessKind: "dataset-generated",
      }),
    }),
  );
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [event],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 1, status: "ready" }],
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: "A Night at the Playhouse" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute("data-listings-status", "empty");
  await expect(page.getByText(/having a quiet one tonight/i)).toBeVisible();
});

test("a degraded Out lane still names itself beside the cards it did return", async ({
  page,
}) => {
  const event = playhouseEvent();
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [
          {
            id: "quiz-primary",
            venueId: "venue-primary",
            placeName: "The Test Arms",
            kind: "quiz",
            startsAt: event.startsAt,
            title: "Quiz night",
            source: { label: "Pub listing", url: "https://example.com/quiz" },
            observedAt: event.observedAt,
            confidence: "listed",
          },
        ],
        asOf: "2026-08-16T12:00:00.000Z",
        sourceObservedAt: "2026-08-16T12:00:00.000Z",
        sourceFreshnessKind: "dataset-generated",
      }),
    }),
  );
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "degraded",
        events: [event],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "skiddle", configured: true, rows: 0, status: "degraded" }],
        reason: "Some listings could not be checked.",
      }),
    }),
  );

  await page.goto("/tonight");
  // Ticketmaster theatre stays off the primary pub list (tonightPrimaryRows).
  // The What's-On quiz is the card; the Out lane still names the short read.
  await expect(page.getByRole("heading", { name: "Quiz night" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: "A Night at the Playhouse" }),
  ).toHaveCount(0);
  // Cards show, so the error block never renders. Without this note the short
  // list reads as a quiet city rather than a lane we could not check.
  await expect(page.locator('[data-tonight-listings-note="partial"]')).toHaveText(
    "Some listings could not be checked.",
  );
});

test("a hung Out read settles instead of pinning the loading skeleton", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        asOf: "2026-08-16T12:00:00.000Z",
        sourceObservedAt: "2026-08-16T12:00:00.000Z",
        sourceFreshnessKind: "dataset-generated",
      }),
    }),
  );
  // Never answered, never refused: the shape a CDN or edge hang takes. Tonight
  // waits on both lanes, so an Out read with no ceiling of its own would hold
  // the skeleton for the rest of the session over a night What's-On already
  // described.
  await page.route("**/api/out?**", () => {});

  // "load" would wait on the request that is deliberately never answered.
  await page.goto("/tonight", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 30_000 });
  const screen = page.getByTestId("tonight-screen");
  await expect(screen).not.toHaveAttribute("data-listings-status", "idle");
  await expect(page.getByRole("button", { name: "Retry listings" })).toBeVisible();
});

// The Tonight lede contract (issue #1429). An earlier build led the first
// screen with a JD Wetherspoon Curry Club deal. What a reader meets first is a
// pub, or the honest quiet-night sentence, and never a `deal-jdw-` row, a JD
// Wetherspoon source host, or a Ticketmaster kind:event row.
function jdwCurryClub(now = Date.now()) {
  return {
    id: "deal-jdw-curry-club",
    venueId: "venue-jdw",
    placeName: "The Moon Under Water",
    kind: "deal",
    startsAt: new Date(now + 60 * 60_000).toISOString(),
    title: "Curry Club",
    source: {
      label: "J D Wetherspoon deals",
      url: "https://www.jdwetherspoon.com/food-and-drink",
    },
    observedAt: new Date(now - 60_000).toISOString(),
    confidence: "listed",
  };
}

function independentQuiz(now = Date.now()) {
  return {
    id: "quiz-independent-lede",
    venueId: "venue-primary",
    placeName: "The Test Arms",
    // Two hours out, so the JDW deal is the EARLIER row: only the primary rule
    // can put the pub first.
    startsAt: new Date(now + 2 * 60 * 60_000).toISOString(),
    kind: "quiz",
    title: "Quiz night",
    source: { label: "Pub listing", url: "https://example.com/quiz" },
    observedAt: new Date(now - 60_000).toISOString(),
    confidence: "listed",
  };
}

async function mockTonightSpine(page: Page, rows: unknown[]) {
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows,
        asOf: "2026-08-16T12:00:00.000Z",
        sourceObservedAt: "2026-08-16T12:00:00.000Z",
        sourceFreshnessKind: "dataset-generated",
      }),
    }),
  );
}

test("the first screen leads with the pub, not a JDW deal or a Ticketmaster event", async ({
  page,
}) => {
  const now = Date.now();
  await mockTonightSpine(page, [jdwCurryClub(now), independentQuiz(now)]);
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [playhouseEvent(now)],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 1, status: "ready" }],
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute(
    "data-listings-status",
    "ready",
  );

  // The head sentence claims the pub's category and neither excluded lane.
  const lede = page.locator(".screenLede");
  await expect(lede).toHaveText(/pub quizzes/i);
  await expect(lede).not.toHaveText(/deals/i);
  await expect(lede).not.toHaveText(/events/i);

  // The first card is the pub. Both excluded rows are off the list entirely.
  const cards = page.getByTestId("tonight-list").locator("li .tonightRowTitle");
  await expect(cards.first()).toHaveText("Quiz night");
  await expect(page.getByTestId("tonight-list")).not.toContainText("Curry Club");
  await expect(page.getByTestId("tonight-list")).not.toContainText(
    "A Night at the Playhouse",
  );
});

test("a night of only excluded rows reads as the honest quiet night", async ({ page }) => {
  const now = Date.now();
  await mockTonightSpine(page, [jdwCurryClub(now)]);
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [playhouseEvent(now)],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 1, status: "ready" }],
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute(
    "data-listings-status",
    "empty",
  );
  await expect(page.getByText(/having a quiet one tonight/i)).toBeVisible();
  // Scoped to the first-screen spine on purpose. The secondary Deals lane
  // below it still carries the JDW row, and taking it off the page would drop
  // a real deal; what the contract forbids is leading with one.
  await expect(page.locator(".tonightPrimary")).not.toContainText("Curry Club");
  await expect(page.locator(".tonightPrimary")).not.toContainText(
    "A Night at the Playhouse",
  );
  await expect(page.getByTestId("tonight-list")).toHaveCount(0);
});

// Site audit D8, 13 Sep 2026: desktop /tonight was one 784px column beside a
// 360px rail holding one 81px weather card and then 3,800px of nothing. From
// 1100px the rail carries the quiet-night blocks a reader turns to after the
// lede, and a phone keeps the one column in DOM order.
async function openQuietNight(page: Page) {
  await mockTonightSpine(page, []);
  await mockReadyEmptyOut(page);
  await page.goto("/tonight");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute(
    "data-listings-status",
    "empty",
  );
}

test("desktop Tonight seats the quiet-night blocks in the rail beside the lede", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openQuietNight(page);

  const rail = page.locator("aside.tonightContext");
  await expect(rail.getByTestId("tonight-cheap-pints")).toBeVisible();
  await expect(rail.locator(".tonightVibes")).toBeVisible();
  // The soft plans ride a quiet hour of the London clock, so they are only
  // on some runs; when they are, they are in the rail.
  if ((await page.getByTestId("tonight-soft-plans").count()) > 0) {
    await expect(rail.getByTestId("tonight-soft-plans")).toBeVisible();
  }

  const head = await page.locator(".screenHead").boundingBox();
  const lede = await page.getByTestId("tonight-lede").boundingBox();
  const railBox = await rail.boundingBox();
  expect(head && lede && railBox).toBeTruthy();
  if (!head || !lede || !railBox) return;
  // Beside the lede, not under it, and level with the head.
  expect(railBox.x).toBeGreaterThanOrEqual(lede.x + lede.width);
  expect(railBox.y).toBeLessThan(head.y + head.height);
  // The rail never pushes the lede down: the two columns share no row height.
  // Only the weather line may stand between the head and the lede.
  expect(lede.y - (head.y + head.height)).toBeLessThan(160);
});

test("phone Tonight keeps the lede, the cheap pints and the vibe chips in one column", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openQuietNight(page);

  const lede = await page.getByTestId("tonight-lede").boundingBox();
  const cheap = await page.getByTestId("tonight-cheap-pints").boundingBox();
  const vibes = await page.locator(".tonightVibes").boundingBox();
  expect(lede && cheap && vibes).toBeTruthy();
  if (!lede || !cheap || !vibes) return;
  expect(cheap.y).toBeGreaterThan(lede.y + lede.height - 1);
  expect(vibes.y).toBeGreaterThan(cheap.y + cheap.height - 1);
  expect(Math.abs(cheap.x - lede.x)).toBeLessThan(1);
  expect(Math.abs(vibes.x - lede.x)).toBeLessThan(1);
});

function independentDeal(now = Date.now()) {
  return {
    id: "deal-independent-happy-hour",
    venueId: "venue-primary",
    placeName: "The Test Arms",
    kind: "deal",
    startsAt: new Date(now + 60 * 60_000).toISOString(),
    title: "Happy hour",
    source: { label: "Pub listing", url: "https://example.com/happy-hour" },
    observedAt: new Date(now - 60_000).toISOString(),
    confidence: "listed",
  };
}

function independentGig(now = Date.now()) {
  return {
    id: "music-independent-gig",
    venueId: "venue-primary",
    placeName: "The Test Arms",
    kind: "music",
    startsAt: new Date(now + 3 * 60 * 60_000).toISOString(),
    title: "Live band",
    source: { label: "Pub listing", url: "https://example.com/gig" },
    observedAt: new Date(now - 60_000).toISOString(),
    confidence: "listed",
  };
}

async function openBusyNight(page: Page) {
  const now = Date.now();
  await mockTonightSpine(page, [independentQuiz(now), independentDeal(now), independentGig(now)]);
  await mockReadyEmptyOut(page);
  await page.goto("/tonight");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute(
    "data-listings-status",
    "ready",
  );
}

// D8 is a desktop change. A phone still reads the full Deals and Music lanes
// right after the vibe chips, before the soft plans and the area news.
test("phone Tonight reads the Deals and Music lanes before the soft plans and the area news", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBusyNight(page);

  const lanes = page.locator(".tonightSecondaryLanes--mobile");
  await expect(lanes.locator("#deals-tonight-title")).toBeVisible();
  await expect(lanes.locator("#music-tonight-title")).toBeVisible();

  // One read, so every box shares a scroll offset. The area news wrapper is
  // read from the DOM because it has no height when no area is remembered, and
  // it still holds its place in the column.
  const boxes = await page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const { top, bottom, height } = el.getBoundingClientRect();
      return { top, bottom, height };
    };
    return {
      vibes: rect(".tonightVibes"),
      lanes: rect(".tonightSecondaryLanes--mobile"),
      softPlans: rect('[data-testid="tonight-soft-plans"]'),
      areaNews: rect(".tonightRail"),
    };
  });
  expect(boxes.vibes).not.toBeNull();
  expect(boxes.lanes).not.toBeNull();
  expect(boxes.areaNews).not.toBeNull();
  if (!boxes.vibes || !boxes.lanes || !boxes.areaNews) return;
  expect(boxes.lanes.height).toBeGreaterThan(0);
  expect(boxes.lanes.top).toBeGreaterThanOrEqual(boxes.vibes.bottom - 1);
  expect(boxes.lanes.bottom).toBeLessThanOrEqual(boxes.areaNews.top + 1);
  if (boxes.softPlans) {
    expect(boxes.lanes.bottom).toBeLessThanOrEqual(boxes.softPlans.top + 1);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".tonightOnTonightSummary")).toBeVisible();
  await expect(lanes).toBeHidden();
});

// Site audit D17: the Spoons import put four Wetherspoon pubs at £1.99 on top
// of the list. One row per chain, and the chain is named on its row.
test("the cheapest listed pints carry one row per chain and name it", async ({ page }) => {
  await openQuietNight(page);

  const rows = page.getByTestId("tonight-cheap-pints").locator("li");
  await expect(rows).toHaveCount(4);
  const chains = await rows
    .locator("[data-chain]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-chain")));
  expect(chains.length).toBeGreaterThan(0);
  expect(new Set(chains).size).toBe(chains.length);
  await expect(
    rows.locator('[data-chain="wetherspoon"]'),
  ).toHaveText("Wetherspoon");
});

// The walk-times toggle painted at radius 0 (site audit D7, carried by this
// lane). It is a row control, so it takes the one button system's geometry.
test("the walk-times toggle wears the button system", async ({ page }) => {
  await openQuietNight(page);

  const toggle = page.locator(".tonightLocationToggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveClass(/\buiButton\b/);
  const geometry = await toggle.evaluate((el) => {
    const style = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    return {
      radius: style.borderTopLeftRadius,
      controlRadius: root.getPropertyValue("--control-radius").trim(),
      height: el.getBoundingClientRect().height,
    };
  });
  expect(geometry.radius).not.toBe("0px");
  expect(geometry.radius).toBe(geometry.controlRadius);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
});
