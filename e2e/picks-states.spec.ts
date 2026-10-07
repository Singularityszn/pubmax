import { test, expect, type Page } from "@playwright/test";

// F04: the Today and Tonight pick sections have FOUR states, and a reader meets
// the right one. One case per state, with BOTH feeds stubbed at the network
// edge, so nothing here depends on what London actually has on tonight.
//
//   ready                    cards, no talk about the read
//   refreshing               the rows already on screen STAY, dated
//   genuinely_empty          an event-scoped empty answer plus two non-event doors
//   temporarily_unavailable  what happened to us, a retry, the same two doors,
//                            and never the empty-city sentence
//
// Fixtures, never a live provider: both /api/whats-on and /api/out are fulfilled
// from literals below.

// Scope the quiet-city assertion to the listing spine's status paragraph.
const QUIET_NIGHT_SENTENCE = ".tonightStatus";
const QUIET_NIGHT_FRAGMENT = /The city.s having a quiet one tonight/i;
const ALTERNATIVE_LABEL = /No event needed/i;

function futureIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** A row the Tonight spine accepts: venue-matched, sourced, dated, in window. */
function fixtureRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `fixture-quiz-${index}`,
    venueId: "venue-london-0001",
    placeName: "The Fixture Arms",
    lat: 51.5142,
    lng: -0.1204,
    kind: "quiz",
    startsAt: futureIso(2 * 60 * 60_000),
    endsAt: futureIso(5 * 60 * 60_000),
    title: `Fixture pub quiz ${index + 1}`,
    source: { label: "PUBMAXX fixtures", url: "https://example.invalid/quiz" },
    observedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    confidence: "confirmed",
  }));
}

const READY_WHATS_ON = () => ({
  rows: fixtureRows(3),
  asOf: new Date(Date.now() - 60 * 60_000).toISOString(),
  sourceObservedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  sourceFreshnessKind: "provider-observed",
  kindObservedAt: {},
});

const EMPTY_WHATS_ON = () => ({ ...READY_WHATS_ON(), rows: [] });

const READY_OUT = {
  status: "ready",
  events: [],
  openPlans: [],
  attribution: [],
  observedAt: {},
  providers: [],
  listingsStatus: "ready",
  venueMatch: "ready",
};

const DEGRADED_OUT = {
  ...READY_OUT,
  status: "degraded",
  listingsStatus: "degraded",
  reason: "Some listings could not be checked.",
  listingsReason: "Some listings could not be checked.",
};

async function stubFeeds(
  page: Page,
  whatsOn: () => unknown,
  out: unknown = READY_OUT,
) {
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(whatsOn()),
    }),
  );
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(out),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    // A chosen area, so the fallback doors have something to carry.
    window.localStorage.setItem(
      "pubmax:nightPatch:v1",
      JSON.stringify({ kind: "patch", id: "soho" }),
    );
  });
});

test.describe("Tonight picks states", () => {
  test("ready shows cards and says nothing about its own read", async ({ page }) => {
    await stubFeeds(page, READY_WHATS_ON);
    await page.goto("/tonight");

    const screen = page.getByTestId("tonight-screen");
    await expect(screen).toHaveAttribute("data-picks-state", "ready", {
      timeout: 20_000,
    });
    await expect(page.getByText(/Fixture pub quiz/i).first()).toBeVisible();
    await expect(page.getByTestId("picks-alternatives")).toHaveCount(0);
    await expect(
      page.locator(QUIET_NIGHT_SENTENCE).filter({ hasText: QUIET_NIGHT_FRAGMENT }),
    ).toHaveCount(0);
  });

  test("genuinely empty offers two non-event doors carrying the area", async ({
    page,
  }) => {
    await stubFeeds(page, EMPTY_WHATS_ON);
    await page.goto("/tonight");

    const screen = page.getByTestId("tonight-screen");
    await expect(screen).toHaveAttribute("data-picks-state", "genuinely_empty", {
      timeout: 20_000,
    });
    await expect(
      page.locator(QUIET_NIGHT_SENTENCE).filter({ hasText: "No confirmed events listed tonight." }),
    ).toBeVisible();
    await expect(page.getByTestId("tonight-hyped-row").first()).toBeVisible();
    await expect(
      page.locator(QUIET_NIGHT_SENTENCE).filter({ hasText: QUIET_NIGHT_FRAGMENT }),
    ).toHaveCount(0);

    const alternatives = page.getByTestId("picks-alternatives");
    await expect(alternatives).toBeVisible();
    await expect(alternatives.getByText(ALTERNATIVE_LABEL)).toBeVisible();
    // The chosen area rides both doors rather than being dropped at the exit.
    await expect(alternatives.locator('[data-picks-way="pubs-near"]')).toHaveAttribute(
      "href",
      "/near?patch=soho",
    );
    await expect(alternatives.locator('[data-picks-way="plan"]')).toHaveAttribute(
      "href",
      "/plan",
    );
  });

  test("an occasion in the address survives the plan door", async ({ page }) => {
    await stubFeeds(page, EMPTY_WHATS_ON);
    await page.goto("/tonight?occasion=coffee");

    const alternatives = page.getByTestId("picks-alternatives");
    await expect(alternatives).toBeVisible({ timeout: 20_000 });
    await expect(alternatives.locator('[data-picks-way="plan"]')).toHaveAttribute(
      "href",
      "/plan?occasion=coffee",
    );
  });

  test("temporarily unavailable retries and never claims a quiet city", async ({
    page,
  }) => {
    await stubFeeds(page, () => ({ error: "upstream unavailable" }), DEGRADED_OUT);
    await page.goto("/tonight");

    const screen = page.getByTestId("tonight-screen");
    await expect(screen).toHaveAttribute(
      "data-picks-state",
      "temporarily_unavailable",
      { timeout: 20_000 },
    );
    // The reader is told what happened to US, offered the same two doors, and
    // never told the city is quiet on a read that never answered.
    await expect(page.getByRole("button", { name: /Retry listings/i })).toBeVisible();
    await expect(page.getByTestId("picks-alternatives")).toBeVisible();
    await expect(
      page.locator(QUIET_NIGHT_SENTENCE).filter({ hasText: QUIET_NIGHT_FRAGMENT }),
    ).toHaveCount(0);
  });

  test("refreshing keeps the last good picks rather than emptying the list", async ({
    page,
  }) => {
    // The spine FAILS and the Out lane carries the rows. That pairing is the
    // only one that puts real cards and this page's own retry control on screen
    // together: `tonightNoteOffersRetry` offers the button for the SPINE alone,
    // and a spine that reported has no rows of its own.
    await stubFeeds(page, () => ({ error: "upstream unavailable" }), {
      ...READY_OUT,
      events: fixtureRows(3),
    });
    await page.goto("/tonight");

    const screen = page.getByTestId("tonight-screen");
    await expect(screen).toHaveAttribute("data-picks-state", "ready", {
      timeout: 20_000,
    });
    await expect(page.getByText(/Fixture pub quiz/i).first()).toBeVisible();

    // Hold the NEXT spine read open, so the re-read stays in flight and the
    // state is observable rather than a race. Before this change the retry put
    // the spine back to `idle`, an idle spine held the Out lane's rows back too,
    // and the whole list collapsed to a skeleton on every press.
    await page.route("**/api/whats-on**", () => new Promise(() => {}));

    // One click, not a retried tap: this control is painted by a client
    // component, so its presence already means React is attached, and the press
    // REPLACES it with the re-read line, which is exactly what a retried tap
    // would then hang waiting for.
    const retry = page.getByRole("button", { name: /Retry listings/i }).first();
    await expect(retry).toBeVisible({ timeout: 15_000 });
    await retry.click();

    await expect(screen).toHaveAttribute("data-picks-state", "refreshing", {
      timeout: 10_000,
    });
    // The rows stayed put, and the re-read is named rather than mimed.
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0);
    await expect(page.getByText(/Fixture pub quiz/i).first()).toBeVisible();
    await expect(
      page.locator('[data-tonight-listings-note="refreshing"]'),
    ).toBeVisible();

    // The section never claims a quiet city while it is holding real rows.
    await expect(
      page.locator(QUIET_NIGHT_SENTENCE).filter({ hasText: QUIET_NIGHT_FRAGMENT }),
    ).toHaveCount(0);
    expect(["ready", "refreshing"]).toContain(
      await screen.getAttribute("data-picks-state"),
    );
  });
});

test.describe("Today picks states", () => {
  test("the picks card names its state and never dead-ends", async ({ page }) => {
    await page.goto("/today");

    // Read the visible card when a layout retains a hidden representation.
    const card = page.getByTestId("today-picks").first();
    await expect(card).toBeVisible();
    const state = await card.getAttribute("data-picks-state");
    expect([
      "ready",
      "refreshing",
      "genuinely_empty",
      "temporarily_unavailable",
    ]).toContain(state);

    const pubSuggestions = card.getByRole("region", { name: "Pubs people are talking about" });
    if (await pubSuggestions.count()) {
      await expect(pubSuggestions).toBeVisible();
      await expect(pubSuggestions.getByRole("link", { name: "Open on map" }).first())
        .toHaveAttribute("href", /^\/map\?sel=.+/);
      await expect(card.locator(".todayCardEmpty")).not.toHaveText(QUIET_NIGHT_FRAGMENT);
      await expect(card.getByRole("link", { name: "See everything on tonight" }))
        .toHaveAttribute("href", "/tonight");
      return;
    }

    if (state === "ready") {
      await expect(card.getByTestId("picks-alternatives")).toHaveCount(0);
      return;
    }

    // Both honest absences owe the reader the same two non-event doors, and
    // the map exit the friction fence already pins stays beside them.
    const alternatives = card.getByTestId("picks-alternatives");
    await expect(alternatives).toBeVisible();
    await expect(alternatives.getByText(ALTERNATIVE_LABEL)).toBeVisible();
    await expect(alternatives.locator('[data-picks-way="pubs-near"]')).toHaveAttribute(
      "href",
      "/near?patch=soho",
    );
    await expect(
      card.getByRole("link", { name: /the map knows the cheap pints/i }),
    ).toBeVisible();
  });
});
