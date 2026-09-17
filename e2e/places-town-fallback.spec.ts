import { expect, test } from "@playwright/test";

// The consolidation moved the picker to /places and retired /choose-city. The
// old address answered a town nobody prices by reading the UK place index and
// offering the base map where that town is, so the picker owes the same answer
// or the move is a capability loss with a redirect on top.
//
// The walk is the whole path: the OLD address, the 308, and the arrival.
test("a town typed at the picker still opens its own arrival", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/choose-city?focus=search");
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/places");

  const field = page.locator(".placesSearchInput");
  const townList = page.locator(".placesTownList");

  // Didsbury is Manchester, and a place inside a city we ship keeps that city's
  // guide rather than being offered as an unpriced elsewhere.
  await expect(async () => {
    await field.fill("Didsbury");
    await expect(townList).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const didsbury = townList.locator("a").first();
  await expect(didsbury).toHaveAttribute("href", "/map/manchester");
  await expect(didsbury).toContainText("Didsbury");

  // Chester is not a substring shortcut to Manchester. The town remains a result.
  await field.fill("Chester");
  const chester = townList.locator("a").filter({
    has: page.locator(".placesCityName", { hasText: /^Chester$/ }),
  });
  await expect(chester).toHaveCount(1);
  await expect(chester).toHaveAttribute(
    "href", "/map?place=Chester&lat=53.1923027&lng=-2.8882727",
  );

  // Sheffield is nobody's city pack, so it lands on the base map at its own
  // coordinates with the honest line about prices.
  await field.fill("Sheffield");
  const sheffield = townList.locator("a").first();
  await expect(sheffield).toHaveAttribute(
    "href",
    "/map?place=Sheffield&lat=53.3800941&lng=-1.4789213",
  );
  await expect(sheffield).toContainText("No prices logged here yet");
});

// DEFECT (UI test, 2026-09-12, 390x844): the ODbL credit the town answer owes
// printed its tail under the floating create action, so "ODbL." and the full
// stop were painted beneath the button. A licence line is the one line that may
// never be partly hidden. The remedies are the control's own published lane
// (`.createFabLane`, components/nav/createFab.module.css) and a credit whose tap floor
// no longer grows its line box into the tab bar's band. Rendered geometry is
// what proves it, never the stylesheet's text.
test("the town answer's licence credit is clear of the floating chrome", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/places");
  const field = page.locator(".placesSearchInput");
  const credit = page.locator(".placesTownSource");

  // Alresford returns three rows, which is what put the credit in the floating
  // stack's band in the first place.
  await expect(async () => {
    await field.fill("Alresford");
    await expect(credit).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  const probe = await page.evaluate(() => {
    const line = document.querySelector(".placesTownSource");
    if (!line) return null;
    const range = document.createRange();
    range.selectNodeContents(line);
    const rects = [...range.getClientRects()];
    const covering = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.position !== "fixed") return false;
        if (style.visibility === "hidden" || style.display === "none") return false;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        return rects.some(
          (rect) =>
            box.left < rect.right &&
            box.right > rect.left &&
            box.top < rect.bottom &&
            box.bottom > rect.top,
        );
      })
      .map((element) => element.className.toString());
    const paintsItsOwnText = rects.every((rect) =>
      line.contains(
        document.elementFromPoint(
          (rect.left + rect.right) / 2,
          (rect.top + rect.bottom) / 2,
        ),
      ),
    );
    // The link inside it still answers the tap floor.
    const link = line.querySelector("a")!.getBoundingClientRect();
    return { covering, paintsItsOwnText, scrollY: window.scrollY, linkHeight: link.height };
  });

  expect(probe).not.toBeNull();
  expect(probe?.scrollY).toBe(0);
  expect(probe?.covering).toEqual([]);
  expect(probe?.paintsItsOwnText).toBe(true);
  expect(probe?.linkHeight).toBeGreaterThanOrEqual(44);
});
