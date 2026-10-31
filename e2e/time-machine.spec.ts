import { expect, test, type Page } from "@playwright/test";

import history from "../public/data/price_history/london.json";
import { parsePriceHistory } from "../lib/priceHistory";
import {
  buildTimeMachine,
  ONLY_DATED_LINE,
  pubCountLabel,
  type TimeMachineData,
} from "../lib/priceTimeMachine";
import { stubSocialAuthProviders } from "./helpers/authDoubles";

// The pint price time machine (/time-machine, round 5 F1) in a real browser.
//
// What only a browser can answer:
//   - the "Only pubs with a dated record light up" line is on the first screen
//     of a phone, so a grey pin is never read as a closed pub;
//   - the slider moves on the keyboard, and the year read-out, the count line
//     and the list under the map follow it;
//   - `?year=` opens on that year, so a shared link shares a year;
//   - every placed pub row links to the map, and none of those links fetches
//     the map before a tap (the rows set prefetch off).
//
// The list is the page's answer in reading order. The pins paint through a
// canvas, so this spec never asserts on them.
//
// The counts come from the same history file and the same year rule the page
// uses. Names are not compared: the page names a pub from the venue index.

const WIDTHS = [390, 1280] as const;

// The lookup places nothing, so every row the file holds for a year is
// counted, placed or not, exactly as the page lists it.
const DATA = buildTimeMachine(parsePriceHistory(history), () => null) as TimeMachineData;

/** The oldest year, and the next year that holds a dated record. */
const FIRST_YEAR = DATA.minYear;
const NEXT_YEAR = Object.keys(DATA.rowsByYear)
  .map(Number)
  .filter((year) => year > FIRST_YEAR)
  .sort((a, b) => a - b)[0];

function rowCount(year: number): number {
  return DATA.rowsByYear[year]?.length ?? 0;
}

function countLine(year: number): string {
  const count = rowCount(year);
  return count === 0
    ? `No pub has a dated record from ${year}.`
    : `${pubCountLabel(count)} with a dated record in ${year}.`;
}

/** A row link to the map: the browse link, `?sel=` a venue id. */
const MAP_SELECTION = /\/map(?:\/[a-z-]+)?\?[^#]*\bsel=venue-/;

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

test.beforeEach(async ({ page }) => {
  // The sign-in providers read answers 503 on a keyless build; every keyless
  // page spec answers it (e2e/near-price-trust.spec.ts).
  await stubSocialAuthProviders(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("the history file holds two years to move between", () => {
  expect(rowCount(FIRST_YEAR)).toBeGreaterThan(0);
  expect(NEXT_YEAR).toBeGreaterThan(FIRST_YEAR);
  expect(rowCount(NEXT_YEAR)).toBeGreaterThan(0);
});

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    });

    test("opens on the newest year with the slider, its read-out and the dated line", async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const response = await page.goto("/time-machine");
      expect(response?.status()).toBe(200);

      await expect(
        page.getByRole("heading", { name: "Pint price time machine", level: 1 }),
      ).toBeVisible();
      const slider = page.getByRole("slider", { name: /^Year/ });
      await expect(slider).toBeVisible();
      await expect(slider).toHaveAttribute("min", String(DATA.minYear));
      await expect(slider).toHaveAttribute("max", String(DATA.maxYear));
      await expect(slider).toHaveValue(String(DATA.maxYear));
      await expect(page.locator("output.tmYearValue")).toHaveText(String(DATA.maxYear));
      await expect(page.locator(".tmCount")).toHaveText(countLine(DATA.maxYear));

      // On the first screen, with no scroll: a grey pin is never read alone.
      const dated = page.getByText(ONLY_DATED_LINE, { exact: true });
      await expect(dated).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

      expect(errors).toEqual([]);
    });

    test("?year= opens on that year, and ArrowRight moves the read-out and the list", async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const response = await page.goto(`/time-machine?year=${FIRST_YEAR}`);
      expect(response?.status()).toBe(200);

      const slider = page.getByRole("slider", { name: /^Year/ });
      const readOut = page.locator("output.tmYearValue");
      const rows = page.locator(".tmList .tmRow");
      const listHeading = page.locator("#tmListHeading");

      await expect(slider).toHaveValue(String(FIRST_YEAR));
      await expect(readOut).toHaveText(String(FIRST_YEAR));
      await expect(listHeading).toHaveText(`Pints in ${FIRST_YEAR}`);
      await expect(page.locator(".tmCount")).toHaveText(countLine(FIRST_YEAR));
      await expect(rows).toHaveCount(rowCount(FIRST_YEAR));
      const firstYearRows = await rows.allTextContents();

      // The slider is a client control painted on the server: retry the key
      // press until the read-out answers, not the assertion after it.
      await expect(async () => {
        await slider.focus();
        await slider.press("ArrowRight");
        await expect(readOut).toHaveText(String(NEXT_YEAR), { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });

      await expect(slider).toHaveValue(String(NEXT_YEAR));
      await expect(listHeading).toHaveText(`Pints in ${NEXT_YEAR}`);
      await expect(page.locator(".tmCount")).toHaveText(countLine(NEXT_YEAR));
      await expect(rows).toHaveCount(rowCount(NEXT_YEAR));
      expect(await rows.allTextContents()).not.toEqual(firstYearRows);
      // The address names the year on screen, so a copied link shares it.
      await expect(page).toHaveURL(new RegExp(`/time-machine\\?year=${NEXT_YEAR}$`));

      expect(errors).toEqual([]);
    });

    test("each placed pub row links to the map and fetches nothing before the tap", async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const mapReads: string[] = [];
      page.on("request", (request) => {
        if (MAP_SELECTION.test(request.url())) mapReads.push(request.url());
      });

      const response = await page.goto(`/time-machine?year=${FIRST_YEAR}`);
      expect(response?.status()).toBe(200);

      const rows = page.locator(".tmList .tmRow");
      await expect(rows).toHaveCount(rowCount(FIRST_YEAR));
      const links = page.locator(".tmList .tmRow a.tmRowName");
      await expect(links.first()).toBeVisible();

      // Every placed row is a map link. A row the index cannot place is a
      // plain name, never a link to nowhere.
      const linkCount = await links.count();
      const plainCount = await page.locator(".tmList .tmRow span.tmRowName").count();
      expect(linkCount).toBeGreaterThan(0);
      expect(linkCount + plainCount).toBe(rowCount(FIRST_YEAR));
      for (const href of await links.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href") ?? ""),
      )) {
        expect(href).toMatch(MAP_SELECTION);
      }

      // Bring every row link on screen, so a link that prefetched on sight
      // would have asked for its map by the time the network settles.
      await links.last().scrollIntoViewIfNeeded();
      await page.waitForLoadState("networkidle");
      expect(mapReads, "a row link fetched the map before a tap").toEqual([]);

      const first = links.first();
      const href = (await first.getAttribute("href")) ?? "";
      // Retry the tap only while the page has not left: a second tap on a
      // link already navigating would wait on a link that is gone.
      await expect(async () => {
        if (!MAP_SELECTION.test(page.url())) await first.click({ timeout: 2_000 });
        await expect(page).toHaveURL(MAP_SELECTION, { timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
      expect(new URL(page.url()).searchParams.get("sel")).toBe(
        new URL(href, "http://x").searchParams.get("sel"),
      );

      expect(errors).toEqual([]);
    });
  });
}
