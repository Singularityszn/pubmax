import { expect, test, type Page } from "@playwright/test";

import { stubSocialAuthProviders } from "./helpers/authDoubles";

// "Share this pint" (P2-C, docs/rules/app-landing-city-and-listing-pages.md):
// one quiet action on the /near top answer, a share text that never drops the
// source or the day, and a link whose preview is that pub's own pint card.

test.setTimeout(60_000);

const READ = "2026-10-02T10:00:00.000Z";

async function prepareReturningVisitor(page: Page): Promise<void> {
  await stubSocialAuthProviders(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    // No OS sheet in this browser, so the clipboard fallback is what runs.
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
}

test("the /near top answer offers one share that carries its source and day", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareReturningVisitor(page);
  // Name a publisher and a read for every row, so the top card has both halves
  // whatever today's dataset says about it.
  await page.route("**/api/near-price-trust**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      results: { publisher: string | null; observedAt: string | null }[];
    };
    for (const row of body.results) {
      row.publisher = "Pint Prices";
      row.observedAt = READ;
    }
    await route.fulfill({ response, json: body });
  });

  await page.goto("/near?patch=soho", { waitUntil: "commit" });
  await expect(page.locator(".nmnCardTrust")).toHaveCount(5);

  const share = page.locator(".nmnSharePint button");
  await expect(share).toHaveCount(1);
  await expect(share).toHaveText("Share this pint");
  // Only the top card carries it.
  await expect(page.locator(".nmnList > li").first().locator(".nmnSharePint")).toHaveCount(1);

  await share.click();
  await expect(page.locator(".sharePintStatus")).toHaveText(
    "Link copied, with the price and who listed it.",
  );
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(
    /^£\d+\.\d{2} a pint at .+ \(listed by Pint Prices, 2 Oct\)\. https?:\/\/[^ ]+\/map(\/[a-z-]+)?\?sel=[^&]+&card=pint$/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("a pint share link previews that pub's own card", async ({ page, request }) => {
  await prepareReturningVisitor(page);
  await page.goto("/near?patch=soho", { waitUntil: "commit" });
  await expect(page.locator(".nmnCard")).toHaveCount(5);
  await page.locator(".nmnCard").first().click();
  await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=/);
  const venueId = new URL(page.url()).searchParams.get("sel");
  expect(venueId).toBeTruthy();

  const documentResponse = await request.get(
    `/map?sel=${encodeURIComponent(venueId!)}&card=pint`,
  );
  expect(documentResponse.status()).toBe(200);
  const html = await documentResponse.text();
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? "";
  expect(ogImage).toContain(`/api/pint-card?venue=${encodeURIComponent(venueId!)}`);

  const card = await request.get(new URL(ogImage).pathname + new URL(ogImage).search);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
});
