import { expect, test, type Page } from "@playwright/test";

import {
  CRAWL_BINGO_LABELS,
  CRAWL_BINGO_SIZE,
  CRAWL_BINGO_SQUARE_IDS,
  crawlBingoCountLine,
} from "../lib/crawlBingo";
import { stubSocialAuthProviders } from "./helpers/authDoubles";

// Pub crawl bingo on the Night Mode card (round 5 F2).
//
// The card is drawn from the active plan, so the plan is a fixture: the
// device's active-plan pointer is seeded and the plan reads are answered, the
// idiom e2e/night-mode-chrome.spec.ts uses. A fresh night shows nine squares,
// "0 of 9" and none ticked. A square ticks only from an action an existing
// surface records (lib/crawlBingoNightLog.ts), held in this tab's memory, so a
// reload starts the card at zero again.
//
// The last-train read is answered with no station, so the "Work out the last
// train" square cannot tick from the live feed during the run.

const WIDTHS = [390, 1280] as const;
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const STOPS = [
  { venueId: "venue-1jbkio1", venueName: "The Landor", position: 1 },
  { venueId: "venue-12x0p9j", venueName: "The Stonhouse", position: 2 },
];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const url = message.location().url;
    const keylessAuthNoise =
      url.includes("pubmaxx-e2e.supabase.co") ||
      text.includes("wss://pubmaxx-e2e.supabase.co/realtime/");
    if (!keylessAuthNoise) errors.push(text);
  });
  return errors;
}

async function seedTonightsPlan(page: Page): Promise<void> {
  await stubSocialAuthProviders(page);
  const startTime = new Date().toISOString();
  const plan = {
    plan: {
      id: PLAN_ID,
      title: "Tonight",
      startTime,
      createdAt: startTime,
      routeRevision: 1,
      status: "active",
    },
    stops: STOPS,
    context: { nightArea: "clapham" },
    crew: [],
    actions: [],
  };
  await page.addInitScript(
    ({ id, startTime }) => {
      window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem(
        "pubmax_active_plan",
        JSON.stringify({ version: 1, id, startTime, stopIndex: 0, role: "host" }),
      );
    },
    { id: PLAN_ID, startTime },
  );
  await page.route(`**/api/plans/${PLAN_ID}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("/session")
        ? { active: true, role: "host", collaborationAuthorized: true }
        : { stops: [] },
    });
  });
  await page.route(`**/api/plans/${PLAN_ID}`, (route) => route.fulfill({ json: plan }));
  await page.route("**/api/last-train?**", (route) => route.fulfill({ json: {} }));
}

/** Open the Night Mode card from its pill, retrying the tap until the card is up. */
async function openBingo(page: Page) {
  const bingo = page.locator(".nightCard .crawlBingo");
  const pill = page.getByRole("button", { name: "Show tonight's plan" });
  await expect(async () => {
    if (await bingo.isVisible()) return;
    await pill.click({ timeout: 2_000 });
    await expect(bingo).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return bingo;
}

async function expectFreshCard(page: Page): Promise<void> {
  const bingo = await openBingo(page);
  await expect(bingo.getByRole("heading", { name: "Pub crawl bingo" })).toBeVisible();
  await expect(bingo.locator(".crawlBingo__count")).toHaveText(crawlBingoCountLine(0));
  await expect(bingo.locator(".crawlBingo__count")).toHaveText(`0 of ${CRAWL_BINGO_SIZE}`);

  const squares = bingo.locator(".crawlBingo__square");
  await expect(squares).toHaveCount(9);
  await expect(squares).toHaveText(CRAWL_BINGO_SQUARE_IDS.map((id) => CRAWL_BINGO_LABELS[id]));
  await expect(bingo.locator(".crawlBingo__square[data-done]")).toHaveCount(0);
  await expect(bingo.getByRole("img", { name: "Not yet:" })).toHaveCount(9);
  await expect(bingo.getByRole("img", { name: "Done:" })).toHaveCount(0);
  // A square is not a button: a free tap ticks nothing.
  await expect(squares.locator("button")).toHaveCount(0);
  await expect(bingo.locator(".crawlBingo__fullHouse")).toHaveCount(0);
}

for (const width of WIDTHS) {
  test(`a fresh night shows nine squares at 0 of 9, and a reload keeps them at zero at ${width}px`, async ({
    page,
  }) => {
    test.slow();
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedTonightsPlan(page);

    const response = await page.goto("/tonight");
    expect(response?.status()).toBe(200);
    await expectFreshCard(page);

    // A tap on a square is not a recorded action.
    await page.locator(".crawlBingo__square").first().click();
    await expect(page.locator(".crawlBingo__count")).toHaveText("0 of 9");

    await page.reload();
    await expectFreshCard(page);

    expect(errors).toEqual([]);
  });
}
