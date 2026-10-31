import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { NEAR_GUINNESS_HREF, NEAR_GUINNESS_WALK_MINUTES } from "../lib/nearMeAnswer";
import { stubSocialAuthProviders } from "./helpers/authDoubles";

// The Guinness line on /near (round 5 B3): "Cheapest Guinness within 15
// minutes: {pub}, {price}, listed {month}", linked to /drink/guinness.
//
// The line is drawn from the listed rows the build bundles, so whether a pub
// is in reach of a given spot depends on the data. The located case therefore
// holds "absent, OR the exact sentence linking to /drink/guinness", never a
// loose contains. A located answer that prints the line wrong fails; one that
// honestly has no listed Guinness in reach passes by printing nothing.
//
// A reader whose location is refused is answered from a fallback centre they
// are not standing at, and a walk from there means nothing: no line at all.

const WIDTHS = [390, 1280] as const;
// Soho, a short walk from many listed pubs.
const CENTRAL_LONDON = { latitude: 51.5136, longitude: -0.1365, accuracy: 10 };

const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
// The product's two endings (lib/nearMeAnswer.ts#nearGuinnessLine): the month
// the row was listed, or the plain line for a row with no recorded read.
const GUINNESS_LINE = new RegExp(
  `^Cheapest Guinness within ${NEAR_GUINNESS_WALK_MINUTES} minutes: .+, £\\d+\\.\\d{2}, (?:listed ${MONTH} \\d{4}|listing date not recorded)$`,
);

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

async function prepare(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubSocialAuthProviders(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function grantLocation(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(CENTRAL_LONDON);
}

for (const width of WIDTHS) {
  test(`located in central London, the Guinness line is absent or the exact sentence at ${width}px`, async ({
    page,
    context,
  }) => {
    const errors = watchErrors(page);
    await grantLocation(context);
    await prepare(page, width);

    const response = await page.goto("/near?locate=1");
    expect(response?.status()).toBe(200);

    // The cards and the line are set in the same answer, so once a card is
    // up the line has had its one chance to render.
    const cards = page.locator(".nmnCard");
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    // The located answer, not an area answer: the line may only speak here.
    await expect(page.locator(".nmnFoot:not(.nmnFootArea)")).toBeVisible();

    const line = page.locator(".nmnGuinness");
    const count = await line.count();
    expect(count).toBeLessThanOrEqual(1);
    if (count === 1) {
      const link = line.getByRole("link");
      await expect(link).toHaveCount(1);
      await expect(link).toHaveText(GUINNESS_LINE);
      await expect(link).toHaveAttribute("href", NEAR_GUINNESS_HREF);
      await expect(line).toHaveText(GUINNESS_LINE);
    } else {
      await expect(page.getByText(/Cheapest Guinness/)).toHaveCount(0);
    }

    expect(errors).toEqual([]);
  });

  test(`with location refused, the fallback answer carries no Guinness line at ${width}px`, async ({
    page,
    context,
  }) => {
    const errors = watchErrors(page);
    await context.clearPermissions();
    await prepare(page, width);

    const response = await page.goto("/near?locate=1");
    expect(response?.status()).toBe(200);

    const cards = page.locator(".nmnCard");
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    // The fallback is an area answer, never the located one.
    await expect(page.locator(".nmnFootArea")).toBeVisible();
    await expect(page.locator(".nmnGuinness")).toHaveCount(0);
    await expect(page.getByText(/Cheapest Guinness/)).toHaveCount(0);

    expect(errors).toEqual([]);
  });
}
