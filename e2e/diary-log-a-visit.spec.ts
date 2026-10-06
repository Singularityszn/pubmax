import { expect, test, type Page } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { runnerShotDir } from "./helpers/runnerShotDir";

/**
 * DIARY, PHASE 1: a drinker logs a visit from a pub's sheet with a half-star
 * rating and a short line, then reads it back in their diary on their profile.
 * The same pub on the same London day is refused the second time.
 *
 * The keyless e2e server verifies no bearer, so `/api/diary` is a route double
 * that keeps the real route's contract (`app/api/diary/route.ts`, pinned by
 * `__tests__/diaryRoute.test.ts`): POST answers 201 `{ entry }` for a new
 * pub-day and 409 `DIARY_ENTRY_EXISTS` for a repeat, GET answers the owner's
 * `{ status, entries }` newest day first. What this proves is the browser half:
 * the composer on the venue sheet, the half-star pick, the words on the
 * refusal, and the entry on the profile.
 */
test.use({ viewport: { width: 390, height: 844 } });

const SHOTS = runnerShotDir("pubmax-diary-phase1");
const VENUE_ID = "venue-1f5ygjb";
const VENUE_NAME = "The Bohemia";
const OWNER = "profile:00000000-0000-4000-8000-0000000000a1";

type Entry = {
  id: string;
  ownerActor: string;
  venueId: string;
  venueName: string;
  visitedOn: string;
  rating: number | null;
  review: string;
  visibility: "private";
  createdAt: string;
};

async function serveDiary(page: Page): Promise<{ posts: Array<Record<string, unknown>> }> {
  const entries: Entry[] = [];
  const posts: Array<Record<string, unknown>> = [];
  await page.route("**/api/diary", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const newestFirst = [...entries].sort((a, b) => (a.visitedOn < b.visitedOn ? 1 : -1));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ready", entries: newestFirst }),
      });
    }
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    posts.push(body);
    const visitedOn = String(body.visitedOn);
    if (entries.some((entry) => entry.venueId === body.venueId && entry.visitedOn === visitedOn)) {
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "You already logged this pub for that day.",
          code: "DIARY_ENTRY_EXISTS",
        }),
      });
    }
    const entry: Entry = {
      id: `entry-${entries.length + 1}`,
      ownerActor: OWNER,
      venueId: String(body.venueId),
      venueName: VENUE_NAME,
      visitedOn,
      rating: typeof body.rating === "number" ? body.rating : null,
      review: String(body.review ?? ""),
      visibility: "private",
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ entry }),
    });
  });
  return { posts };
}

async function openVenueSurface(page: Page) {
  const inspector = page.locator(".venueInspector");
  const expand = page.getByRole("button", { name: "Expand sheet" });
  await expect
    .poll(async () => (await inspector.isVisible()) || (await expand.isVisible()), {
      timeout: 60_000,
    })
    .toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible();
  return inspector;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax:first-run-welcome:v1", "1");
    } catch {
      // Storage may be blocked.
    }
  });
});

test("log a visit from the pub sheet, see it on the profile, and a repeat is refused", async ({ page }) => {
  await installAuthDoubles(page);
  const served = await serveDiary(page);
  await seedSignedIn(page, "A");

  await page.goto(`/map?sel=${VENUE_ID}`, { waitUntil: "domcontentloaded" });
  const sheet = await openVenueSurface(page);

  const open = sheet.getByTestId("diary-log-open");
  const card = sheet.getByTestId("diary-log-card");
  await expect(async () => {
    await open.click();
    await expect(card).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 25_000 });
  await expect(card.getByText(`How was ${VENUE_NAME}?`)).toBeVisible();
  await expect(card.getByText(/Only you can see your diary/)).toBeVisible();

  // A half star: the interactive row is a slider, so the keyboard reaches 4.5.
  const stars = card.getByRole("slider", { name: `Your rating of ${VENUE_NAME}` });
  await stars.focus();
  await stars.press("Home");
  for (let i = 0; i < 7; i += 1) await stars.press("ArrowRight");
  await stars.press("Enter");
  await expect(card.getByText("4.5 / 5")).toBeVisible();

  // An emoji is one character here, as it is on the server: 200 of them leave 80.
  const line = card.getByLabel("One short line");
  await line.fill("🍺".repeat(200));
  await expect(card.getByText("80 characters left")).toBeVisible();
  await line.fill("🍺".repeat(300));
  await expect(card.getByText("0 characters left")).toBeVisible();
  expect([...(await line.inputValue())]).toHaveLength(280);
  await line.fill("Calm back room, good pint.");
  await page.screenshot({ path: `${SHOTS}/diary-composer-390.png` });
  await card.getByTestId("diary-log-submit").click();

  await expect(sheet.getByText(new RegExp(`Logged ${VENUE_NAME} for .* It is in your diary\\.`))).toBeVisible();
  expect(served.posts).toHaveLength(1);
  expect(served.posts[0]).toMatchObject({
    venueId: VENUE_ID,
    rating: 4.5,
    review: "Calm back room, good pint.",
  });
  await page.screenshot({ path: `${SHOTS}/diary-logged-390.png` });

  // The same pub on the same day: the sheet says so in plain words.
  await expect(async () => {
    await open.click();
    await expect(card).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await card.getByTestId("diary-log-submit").click();
  await expect(sheet.getByRole("alert")).toHaveText("You already logged this pub for that day.");

  // And the entry is on the profile, with its stars, its line and a map link.
  await page.goto("/u/you", { waitUntil: "domcontentloaded" });
  const diary = page.getByRole("heading", { name: "Your diary" });
  await expect(diary).toBeVisible({ timeout: 30_000 });
  const entry = page.getByTestId("diary-entry");
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole("link", { name: VENUE_NAME })).toHaveAttribute(
    "href",
    new RegExp(VENUE_ID),
  );
  await expect(entry.getByRole("img", { name: `Your rating of ${VENUE_NAME}: 4.5 out of 5 stars` })).toBeVisible();
  await expect(entry.getByText("Calm back room, good pint.")).toBeVisible();
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/diary-profile-390.png`, fullPage: true });
});

test("the profile diary says so when nothing is logged yet", async ({ page }) => {
  await installAuthDoubles(page);
  await serveDiary(page);
  await seedSignedIn(page, "A");
  await page.goto("/u/you", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Your diary" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Nothing logged yet\./)).toBeVisible();
  await expect(page.getByTestId("diary-entry")).toHaveCount(0);
});

test("a signed-out profile never asks for a diary", async ({ page }) => {
  await installAuthDoubles(page);
  const reads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/diary") reads.push(request.method());
  });
  await page.goto("/u/you", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_500);
  await expect(page.getByRole("heading", { name: "Your diary" })).toHaveCount(0);
  expect(reads).toEqual([]);
});
