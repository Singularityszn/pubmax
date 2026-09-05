import { test, expect, type Page } from "@playwright/test";

// F04: the Today and Tonight pick sections have FOUR states, and a reader meets
// the right one. One case per state, with BOTH feeds stubbed at the network
// edge, so nothing here depends on what London actually has on tonight.
//
//   ready                    cards, no talk about the read
//   refreshing               the rows already on screen STAY, dated
//   genuinely_empty          the quiet-night sentence plus two non-event doors
//   temporarily_unavailable  what happened to us, a retry, the same two doors,
//                            and never the empty-city sentence
//
// Fixtures, never a live provider: both /api/whats-on and /api/out are fulfilled
// from literals below.

const QUIET_NIGHT_FRAGMENT = /quiet one tonight/i;
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
    await expect(page.getByText(QUIET_NIGHT_FRAGMENT)).toHaveCount(0);
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
    await expect(page.getByText(QUIET_NIGHT_FRAGMENT)).toBeVisible();

    const alternatives = page.getByTestId("picks-alternatives");
    await expect(alternatives).toBeVisible();
    await expect(alternatives.getByText(ALTERNATIVE_LABEL)).toBeVisible();
    // The chosen area rides both doors rather than being dropped at the exit.
    await expect(alternatives.locator('[data-picks-way="quiet-pints"]')).toHaveAttribute(
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
    await expect(page.getByText(QUIET_NIGHT_FRAGMENT)).toHaveCount(0);
  });

  test("refreshing keeps the last good picks with their checked-at time", async ({
    page,
  }) => {
    // Rows from the spine, and an Out lane that reported: the note beside the
    // cards is what carries this page's own retry control.
    await stubFeeds(page, READY_WHATS_ON, DEGRADED_OUT);
    await page.goto("/tonight");

    const screen = page.getByTestId("tonight-screen");
    await expect(screen).toHaveAttribute("data-picks-state", "ready", {
      timeout: 20_000,
    });
    await expect(page.getByText(/Fixture pub quiz/i).first()).toBeVisible();

    // Hold the NEXT spine read open, then press Retry. The rows already on
    // screen must survive the re-read rather than collapsing to a skeleton.
    let releaseSpine: (() => void) | null = null;
    const spineHeld = new Promise<void>((resolve) => {
      releaseSpine = resolve;
    });
    await page.route("**/api/whats-on**", async (route) => {
      await spineHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(READY_WHATS_ON()),
      });
    });

    // A server-painted control can be tapped before React attaches, so the TAP
    // is retried rather than the assertion after it being made stricter.
    const refreshing = page.locator('[data-tonight-listings-note="refreshing"]');
    await expect(async () => {
      await page.getByRole("button", { name: /Retry listings/i }).first().click();
      await expect(refreshing).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    await expect(screen).toHaveAttribute("data-picks-state", "refreshing");
    // The rows stayed, and the held answer is dated by its own evidence.
    await expect(page.getByText(/Fixture pub quiz/i).first()).toBeVisible();
    await expect(refreshing).toContainText(/Checked \d+ \w+/);
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0);

    releaseSpine?.();
  });
});

test.describe("Today picks states", () => {
  test("the picks card names its state and never dead-ends", async ({ page }) => {
    await page.goto("/today");

    const card = page.getByTestId("today-picks");
    await expect(card).toBeVisible();
    const state = await card.getAttribute("data-picks-state");
    expect([
      "ready",
      "refreshing",
      "genuinely_empty",
      "temporarily_unavailable",
    ]).toContain(state);

    if (state === "ready") {
      await expect(card.getByTestId("picks-alternatives")).toHaveCount(0);
      return;
    }

    // Both honest absences owe the reader the same two non-event doors, and
    // the map exit the friction fence already pins stays beside them.
    const alternatives = card.getByTestId("picks-alternatives");
    await expect(alternatives).toBeVisible();
    await expect(alternatives.getByText(ALTERNATIVE_LABEL)).toBeVisible();
    await expect(alternatives.locator('[data-picks-way="quiet-pints"]')).toHaveAttribute(
      "href",
      "/near?patch=soho",
    );
    await expect(
      card.getByRole("link", { name: /the map knows the cheap pints/i }),
    ).toBeVisible();
  });
});
