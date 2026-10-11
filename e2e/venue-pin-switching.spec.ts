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
    let previousHeading = await heading.textContent();
    const selectionHeadings = [previousHeading!];
    for (let selection = 0; selection < 2; selection += 1) {
      await expect.poll(async () => (await visiblePins(page)).filter((point) => !selections.includes(point.id)).length).toBeGreaterThan(0);
      const next = (await visiblePins(page)).find((point) => !selections.includes(point.id))!;
      await page.mouse.click(next.x, next.y);
      await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(next.id);
      await expect(sheet).toBeVisible();
      await expect(heading).not.toHaveText(previousHeading!);
      previousHeading = await heading.textContent();
      selections.push(next.id);
      selectionHeadings.push(previousHeading!);
    }
    await page.screenshot({ path: testInfo.outputPath("third-pub.png") });

    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(selections[1]);
    await expect(heading).toHaveText(selectionHeadings[1]);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(selections[0]);
    await expect(heading).toHaveText(selectionHeadings[0]);
    await sheet.getByRole("button", { name: "Close pub detail", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has("sel")).toBe(false);
    await expect(sheet).toBeHidden();
    await expect.poll(() => canvas.evaluate((node) => !!node.closest("[inert]"))).toBe(false);
  });
}
