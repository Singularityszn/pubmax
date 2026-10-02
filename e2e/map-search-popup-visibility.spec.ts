import { expect, test } from "@playwright/test";

import { expectMapToolbarReady, mapToolbar } from "./helpers/mapToolbar";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// Suggestions can have a visible DOM box while a short overflow-hidden search
// cell clips every painted row. Pointer ownership and a real venue pick prove
// the popup escaped its host; no venue, price or selection response is doubled.
test.use({
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

for (const width of [641, 768, 897, 1440]) {
  test(`${width}px map search suggestions paint outside the field and accept a pointer pick`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 984 });
    await installDeterministicMapBasemap(page);
    await page.addInitScript(() => {
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    });

    expect((await page.goto("/map?drink=gin"))?.status()).toBe(200);
    await expectMapToolbarReady(page);
    const toolbar = mapToolbar(page);
    const search = toolbar.getByRole("combobox", { name: "Search places" });
    await search.fill("Albion");
    const listbox = page.getByRole("listbox", { name: "Search suggestions" });
    const option = listbox.getByRole("group", { name: "Venues", exact: true })
      .getByRole("option").first();
    await expect(option).toBeVisible({ timeout: 30_000 });
    const venueId = await option.getAttribute("data-venue-id");
    expect(venueId, "The actual rendered venue supplies its selection ID").toBeTruthy();
    const venueName = await option.locator(".mapSearchSuggestRowName").innerText();
    await info.attach("search-popup-before-pointer-pick", {
      contentType: "image/png", body: await page.screenshot(),
    });

    // Visibility/boundingBox alone cannot detect this clipping failure.
    await expect.poll(() => option.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && node.contains(hit);
    }), { message: "The visible suggestion owns its centre pointer hit", timeout: 10_000 }).toBe(true);

    const field = await search.boundingBox();
    const cell = await toolbar.locator(".mapToolbarSearch").boundingBox();
    expect(field).not.toBeNull();
    expect(cell).not.toBeNull();
    expect(field!.x).toBeGreaterThanOrEqual(cell!.x - 0.5);
    expect(field!.x + field!.width).toBeLessThanOrEqual(cell!.x + cell!.width + 0.5);
    const rowBoxes = await toolbar.locator(".mapToolbarRow > :visible").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    );
    for (const [index, box] of rowBoxes.entries()) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      if (index > 0) expect(box.left).toBeGreaterThanOrEqual(rowBoxes[index - 1]!.right - 0.5);
    }

    await option.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("sel") === venueId);
    await expect(page.getByRole("heading", { name: venueName, exact: true })).toBeVisible();
    await expect(listbox).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("drink")).toBe("gin");
  });
}
