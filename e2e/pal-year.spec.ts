import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

import { londonDayKey } from "../lib/pintContributions";
import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// "Your year so far" (components/pal/PalYear.tsx) on /pal, read from this
// device: the nights kept and the crawls walked. Then "Share my year"
// (components/pal/PalYearShare.tsx): the person ticks the lines, the link
// carries only those, and the shared page and its card read the link. Shots
// land in artifacts/pal-year/ (gitignored).

const SHOTS = "artifacts/pal-year";

test("the Pal reads the year back from this device", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const year = Number(londonDayKey(new Date()).slice(0, 4));
  // The Pal home is a signed-in page: account A, its Pal, and its own
  // mapped prices, answered here so the test reads the card, not the stores.
  await installAuthDoubles(page);
  const now = `${year}-01-01T12:00:00.000Z`;
  const serverPal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
    adultAttestedAt: now, ...DEFAULT_PAL_DRAFT, name: "Ripley", muted: false, hidden: false,
    proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
  };
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal: serverPal, adultOnFile: true } }));
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pint-drops/stats?**", (route) => route.fulfill({
    json: { stats: { handle: ACCOUNTS.A.handle, pintsMapped: 6, total: 6, streak: { current: 0, best: 0 }, byBorough: [{ borough: "Camden", count: 4 }, { borough: "Islington", count: 2 }] } },
  }));
  await page.addInitScript(({ year: thisYear, ownerId, appearance, personality, voice }) => {
    const now = `${thisYear}-01-01T12:00:00.000Z`;
    // The share sheet, answered here so the test reads what was sent.
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: async (data: { title: string; text: string; url: string }) => {
        (window as unknown as { __yearShared?: unknown }).__yearShared = data;
      },
    });
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
      version: 1, days: [`${thisYear}-01-01`, `${thisYear}-01-02`, `${thisYear}-01-03`], lastPlanId: null,
    }));
    window.localStorage.setItem("pubmax_crawl_progress", JSON.stringify({ crawls: {
      soho: { stopIds: ["venue-1ufn31x", "venue-1t8siin", "venue-xiesdn"], visited: ["venue-1ufn31x", "venue-1t8siin", "venue-xiesdn"], startedAt: `${thisYear}-01-01T19:00:00.000Z`, completedAt: `${thisYear}-01-01T22:00:00.000Z` },
      again: { stopIds: ["venue-xiesdn", "venue-xjf3n0"], visited: ["venue-xiesdn", "venue-xjf3n0"], startedAt: `${thisYear}-01-03T19:00:00.000Z`, completedAt: `${thisYear}-01-03T22:00:00.000Z` },
    } }));
  }, { year, ownerId: ACCOUNTS.A.id, ...DEFAULT_PAL_DRAFT });
  await seedSignedIn(page, "A");
  await page.goto("/pal");

  const card = page.getByTestId("pal-year");
  await expect(card).toBeVisible({ timeout: 60_000 });
  const londonMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", month: "numeric" }).format(new Date());
  const december = londonMonth === "12";
  await expect(card.getByRole("heading", { name: december ? "Your Year in Pints" : "Your year so far" })).toBeVisible();
  const lines = card.locator(".palYearLines li");
  await expect(lines.first()).toHaveText("We kept 3 nights together this year.");
  await expect(card).toContainText("January was our busiest month.");
  await expect(card).toContainText("We walked 5 stops.");
  await expect(card).toContainText(/You kept coming back to .+\. 2 crawls in all\./);
  await expect(card).toContainText(/Our first night was 1 January, starting at .+\./);
  await expect(card).toContainText("You have mapped 6 prices across 2 boroughs so far. Every one helps the next person.");
  await expect(card).not.toContainText(/streak|rank|points/i);

  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await mkdir(SHOTS, { recursive: true });
  await card.screenshot({ path: `${SHOTS}/pal-year-390.png` });

  // The person ticks what goes on the card. The counts start ticked, a line
  // that names a pub or a day starts unticked.
  const open = card.getByRole("button", { name: "Share my year" });
  await expect(async () => {
    await open.click();
    await expect(open).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const pick = card.getByRole("group", { name: "What goes on the card" });
  await expect(pick.getByRole("checkbox", { name: "3 nights out." })).toBeChecked();
  await expect(pick.getByRole("checkbox", { name: /^Kept coming back to .+\. 2 crawls in all\.$/ })).not.toBeChecked();
  const first = pick.getByRole("checkbox", { name: /^First night out: 1 January, at .+\.$/ });
  await expect(first).not.toBeChecked();
  await first.check();
  await pick.getByRole("checkbox", { name: /^6 prices mapped across 2 boroughs\./ }).uncheck();
  await card.screenshot({ path: `${SHOTS}/pal-year-share-390.png` });

  await card.getByRole("button", { name: "Share the card" }).click();
  await expect(card.getByRole("status")).toHaveText("Sent. Only the lines you ticked went with it.");
  const shared = await page.evaluate(() => (window as unknown as { __yearShared?: { title: string; text: string; url: string } }).__yearShared);
  expect(shared?.text).toBe(`My ${year} ${december ? "in pints" : "so far"}: 3 nights out, 5 stops walked. Read yours on PUBMAXX.`);
  const link = new URL(shared!.url);
  expect(link.pathname).toBe(`/year-in-pints/${year}`);
  expect([...link.searchParams.keys()]).toEqual(["to", "n", "m", "s", "fd", "fs"]);
  expect(link.search).not.toMatch(/handle|ripley|p=|fv=/i);

  // A stranger opens the link: only the ticked lines, the pub named from the
  // dataset, and the door to their own year.
  await page.goto(`${link.pathname}${link.search}`);
  await expect(page.getByRole("heading", { level: 1, name: `My ${year} ${december ? "in pints" : "so far"}` })).toBeVisible();
  const sharedLines = page.getByTestId("year-share-lines").locator("li");
  await expect(sharedLines).toHaveText([
    "3 nights out.",
    "January was the busiest month.",
    "5 stops walked.",
    /^First night out: 1 January, at .+\.$/,
  ]);
  await expect(page.getByRole("link", { name: "Read your own year" })).toHaveAttribute("href", "/pal");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const cardUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(cardUrl).toContain(`/api/year-card?y=${year}&${link.search.slice(1)}`);
  await page.screenshot({ path: `${SHOTS}/year-in-pints-page-390.png`, fullPage: true });

  const image = await page.request.get(new URL(cardUrl!).pathname + new URL(cardUrl!).search);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  await writeFile(`${SHOTS}/year-card.png`, await image.body());
});
