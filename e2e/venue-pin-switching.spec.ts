import { expect, test, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

type TapPoint = { kind: "pin" | "cluster"; id: string; x: number; y: number };

async function visiblePins(page: Page): Promise<TapPoint[]> {
  return page.evaluate(() => {
    const probe = (window as typeof window & {
      __pubmaxPaintedMapTapPoints?: () => TapPoint[];
    }).__pubmaxPaintedMapTapPoints;
    return probe?.().filter((point) => point.kind === "pin") ?? [];
  });
}

for (const width of [390, 900, 1440]) {
  test(`can select three pubs without closing the venue at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?sel=venue-eltcmh");
    const sheet = page.locator(width === 390 ? ".mobileSharedSheet" : ".mapDrawer.right.open");
    await expect(sheet).toBeVisible();
    const heading = sheet.getByRole("heading").first();
    await expect(heading).toHaveText("The Blackfriar");
    const canvas = page.locator(".maplibregl-canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.evaluate((node) => !!node.closest("[inert]"))).toBe(false);
    const layers = page.locator(".mapLayersFab");
    if (width > 640) {
      await expect(layers).toHaveCount(1);
      await expect.poll(() => layers.evaluate((node) => !!node.closest("[inert]"))).toBe(true);
    }

    if (width === 390) {
      await sheet.getByRole("button", { name: "Expand sheet", exact: true }).click();
      await expect.poll(() => canvas.evaluate((node) => !!node.closest("[inert]"))).toBe(true);
      await sheet.getByRole("button", { name: "Collapse sheet", exact: true }).click();
      await expect.poll(() => canvas.evaluate((node) => !!node.closest("[inert]"))).toBe(false);
    }

    const selections = ["venue-eltcmh"];
    const selectedHistoryLength = await page.evaluate(() => history.length);
    let previousHeading = await heading.textContent();
    const selectionHeadings = [previousHeading!];
    for (let selection = 0; selection < 2; selection += 1) {
      let next: TapPoint | undefined;
      await expect.poll(async () => {
        const candidates = (await visiblePins(page)).filter((point) => !selections.includes(point.id));
        next = candidates[0];
        return candidates.length;
      }).toBeGreaterThan(0);
      if (!next) throw new Error("The successful pin snapshot did not contain a new venue.");
      await page.mouse.click(next.x, next.y);
      await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(next.id);
      await expect(sheet).toBeVisible();
      await expect(heading).not.toHaveText(previousHeading!);
      previousHeading = await heading.textContent();
      selections.push(next.id);
      selectionHeadings.push(previousHeading!);
      // A new pub replaces the current venue surface without adding Back depth.
      await expect.poll(() => page.evaluate(() => history.length)).toBe(selectedHistoryLength);
    }
    await page.screenshot({ path: testInfo.outputPath("third-pub.png") });

    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.has("sel")).toBe(false);
    await expect(sheet).toBeHidden();
    await expect.poll(() => canvas.evaluate((node) => !!node.closest("[inert]"))).toBe(false);

    await page.goForward();
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(selections[2]);
    await expect(sheet).toBeVisible();
    await expect(heading).toHaveText(selectionHeadings[2]);
    await sheet.getByRole("button", { name: "Close pub detail", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has("sel")).toBe(false);
    await expect(sheet).toBeHidden();
    await expect.poll(() => canvas.evaluate((node) => !!node.closest("[inert]"))).toBe(false);
  });
}
