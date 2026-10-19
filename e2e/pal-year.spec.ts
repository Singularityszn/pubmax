import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// "Your year so far" (components/pal/PalYear.tsx) on /pal, read from this
// device: the nights kept and the crawls walked. Shots land in
// artifacts/pal-year/ (gitignored).

const SHOTS = "artifacts/pal-year";

test("the Pal reads the year back from this device", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const year = new Date().getFullYear();
  // The Pal home is a signed-in page: account A, its Pal, and its own
  // mapped prices, answered here so the test reads the card, not the stores.
  await installAuthDoubles(page);
  const now = "2026-10-04T12:00:00.000Z";
  const serverPal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id, name: "Ripley",
    adultAttestedAt: now, ...DEFAULT_PAL_DRAFT, muted: false, hidden: false,
    proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
  };
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal: serverPal, adultOnFile: true } }));
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pint-drops/stats?**", (route) => route.fulfill({
    json: { stats: { handle: ACCOUNTS.A.handle, pintsMapped: 6, total: 6, streak: { current: 0, best: 0 }, byBorough: [{ borough: "Camden", count: 4 }, { borough: "Islington", count: 2 }] } },
  }));
  await page.addInitScript(({ year: thisYear, ownerId, appearance, personality, voice }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // A device account A signed in to before, so its stored Pal stays.
    window.localStorage.setItem("pubmax_account_owner", ownerId);
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId, name: "Ripley",
      adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: false,
      proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    }));
    window.localStorage.setItem("pubmax:nights-kept:v1", JSON.stringify({
      version: 1, days: [`${thisYear}-02-20`, `${thisYear}-10-03`, `${thisYear}-10-17`], lastPlanId: null,
    }));
    window.localStorage.setItem("pubmax_crawl_progress", JSON.stringify({ crawls: {
      soho: { stopIds: ["venue-1ufn31x", "venue-1t8siin", "venue-xiesdn"], visited: ["venue-1ufn31x", "venue-1t8siin", "venue-xiesdn"], startedAt: `${thisYear}-02-20T19:00:00.000Z`, completedAt: `${thisYear}-02-20T22:00:00.000Z` },
      again: { stopIds: ["venue-xiesdn", "venue-xjf3n0"], visited: ["venue-xiesdn", "venue-xjf3n0"], startedAt: `${thisYear}-10-17T19:00:00.000Z`, completedAt: `${thisYear}-10-17T22:00:00.000Z` },
    } }));
  }, { year, ownerId: ACCOUNTS.A.id, ...DEFAULT_PAL_DRAFT });
  await seedSignedIn(page, "A");
  await page.goto("/pal");

  const card = page.getByTestId("pal-year");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole("heading", { name: "Your year so far" })).toBeVisible();
  const lines = card.locator(".palYearLines li");
  await expect(lines.first()).toHaveText("We kept 3 nights together this year.");
  await expect(card).toContainText("October was our busiest month.");
  await expect(card).toContainText("We walked 5 stops.");
  await expect(card).toContainText(/You kept coming back to .+\. 2 crawls in all\./);
  await expect(card).toContainText(/Our first night was 20 February, starting at .+\./);
  await expect(card).toContainText("You have mapped 6 prices across 2 boroughs so far. Every one helps the next person.");
  await expect(card).not.toContainText(/streak|rank|points/i);

  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await mkdir(SHOTS, { recursive: true });
  await card.screenshot({ path: `${SHOTS}/pal-year-390.png` });
});
