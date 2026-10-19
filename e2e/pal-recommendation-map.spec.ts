import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`four Soho recommendations stay with their map at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/pal/chat");
    await page.getByRole("textbox", { name: "Where, how many, what budget" }).fill(
      "Find me four pubs in Soho and show them on the map.",
    );
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".palChatCards .palChatCard")).toHaveCount(4);
    await expect(page).toHaveURL(/\/pal\/chat$/);
    const map = page.getByRole("region", { name: "4 pubs on the map" });
    await expect(map).toBeVisible();
    await expect(map.locator('.palChatMapCanvas[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
    await expect(map.locator(".palChatMapPin")).toHaveCount(4);
    const pinBoxes = await map.locator(".palChatMapPin").evaluateAll((pins) => pins.map((pin) => {
      const box = pin.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    for (let first = 0; first < pinBoxes.length; first += 1) {
      const a = pinBoxes[first]!;
      expect(a.width).toBeGreaterThanOrEqual(44);
      for (let second = first + 1; second < pinBoxes.length; second += 1) {
        const b = pinBoxes[second]!;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      }
    }
    const tappable = await map.locator(".palChatMapPin").evaluateAll((pins) => pins.map((pin) => {
      const box = pin.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return target === pin || pin.contains(target);
    }));
    expect(tappable).toEqual([true, true, true, true]);
    for (const name of await page.locator(".palChatCardTitle").allTextContents()) {
      await expect(map).toContainText(name);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `artifacts/pubpal-complete-1019/soho-map-${viewport.width}.png` });
    const pin = map.locator(".palChatMapPin").first();
    const selectedId = await pin.getAttribute("data-venue-id");
    await pin.click();
    await expect(page).toHaveURL(new RegExp(`/map\\?sel=${selectedId}`));
    await expect(page.locator(".venueInspector")).toBeAttached({ timeout: 30_000 });
    await expect(page.locator(".venueInspector")).toContainText("Shakespeares Head");
  });
}
