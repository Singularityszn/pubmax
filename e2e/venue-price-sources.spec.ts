import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function expectPublisherTargets(page: Page, testInfo: TestInfo) {
  const links = page.locator(".listedPriceSource").getByRole("link");
  expect(await links.count()).toBeGreaterThan(0);
  for (const [index, link] of (await links.all()).entries()) {
    await link.scrollIntoViewIfNeeded();
    const target = await link.evaluate((anchor) => {
      const box = anchor.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        // Check the edges as well as the text. A covered padding box is not a target.
        ownsPoints: [box.left + 1, box.left + box.width / 2, box.right - 1].flatMap((x) =>
          [box.top + 1, box.top + box.height / 2, box.bottom - 1].map((y) =>
            document.elementFromPoint(x, y)?.closest("a") === anchor)),
        underline: getComputedStyle(anchor).textDecorationLine,
      };
    });
    await testInfo.attach(`publisher-${index}`, { body: JSON.stringify(target), contentType: "application/json" });
    expect.soft(target.width, `publisher ${index} width`).toBeGreaterThanOrEqual(44);
    expect.soft(target.height, `publisher ${index} height`).toBeGreaterThanOrEqual(44);
    expect(target.ownsPoints, `publisher ${index} hit ownership`).toEqual(Array(9).fill(true));
    expect(target.underline).toContain("underline");
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^https:\/\//);
    if (!href) throw new Error("The publisher link must have a destination.");
    // Exercise the padding and the edge beside the date without contacting the publisher.
    await page.context().route(href, (route) => route.fulfill({ body: "Publisher fixture" }));
    for (const position of [{ x: 1, y: 1 }, { x: target.width - 1, y: target.height / 2 }]) {
      const popupPromise = page.waitForEvent("popup");
      await link.click({ position });
      const popup = await popupPromise;
      await expect(popup).toHaveURL(href);
      await popup.close();
    }
    await page.context().unroute(href);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [390, 1440]) {
  for (const path of ["/pubs/venue-18uogns", "/ledger/venue-18uogns"]) {
    test(`${width}px: ${path} shows the price's publisher and read day`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Ye Olde Swiss Cottage", exact: true })).toBeVisible();
      const source = page.locator(".listedPriceSource").first();
      await expect(source.getByRole("link", { name: "Pint Prices", exact: true })).toBeVisible({ timeout: 1_000 });
      await expect(source.locator("time")).toHaveAttribute("datetime", "2026-10-02");
      await testInfo.attach("citation-layout", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await expectPublisherTargets(page, testInfo);
    });
  }

  test(`${width}px: invite publisher links retain their citation and own 44px targets`, async ({ page, request }, testInfo) => {
    const created = await request.post("/api/plans", { headers: { "idempotency-key": randomUUID() }, data: {
      title: "Publisher target proof", creatorName: "Local host",
      startTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
      stops: [{ venueId: "venue-e1srzr", venueName: "Shakespeares Head (Soho)" }],
    } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).plan.plan.id;
    const { inviteToken } = await (await request.get(`/api/plans/${id}`)).json();
    expect(inviteToken).toBeTruthy();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/invite/${inviteToken}`);
    const source = page.locator(".listedPriceSource");
    await expect(source).toHaveText("Listed by Pint Prices, collected 2 October 2026.");
    await expect(source.locator("time")).toHaveAttribute("datetime", "2026-10-02");
    await testInfo.attach("citation-layout", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await expectPublisherTargets(page, testInfo);
  });
}
