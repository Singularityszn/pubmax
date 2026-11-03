import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";
import { storeThemeChoice } from "./helpers/themeClock";

const STOP_IDS = ["venue-1ufn31x", "venue-1t8siin", "venue-xiesdn", "venue-phqazo", "venue-15i2wst"];
type Stop = { name: string; price: string; drink: string; publisher: string; day: string };

async function prepare(page: Page, theme: "light" | "dark") {
  await storeThemeChoice(page, theme);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.removeItem("pubmax-wild");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax-tour-v2-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
}

async function routeStops(page: Page): Promise<Stop[]> {
  const rows = page.getByRole("list", { name: "Victorian Soho stops", exact: true }).locator(".rowListItem");
  await expect(rows).toHaveCount(STOP_IDS.length);
  const stops: Stop[] = [];
  for (const row of await rows.all()) {
    const meta = await row.locator(".rowListMeta").innerText();
    const evidence = meta.match(/\. ([^.]+)\. ([^.]+)\. Source read ([^.]+)\./);
    expect(evidence, meta).not.toBeNull();
    stops.push({
      name: await row.locator(".rowListTitle").innerText(),
      price: await row.locator(".rowListTrailing").innerText(),
      drink: evidence![1]!, publisher: evidence![2]!, day: evidence![3]!,
    });
  }
  return stops;
}

function money(pence: number) { return `£${(pence / 100).toFixed(2)}`; }

async function assertReceiptMath(receipt: Locator, subtotal: number, people: number) {
  await expect(receipt.locator(".crawlReceipt__peopleText")).toHaveText(`${people} ${people === 1 ? "person" : "people"}`);
  const total = receipt.locator(".crawlReceipt__row--total");
  await expect(total.locator(".crawlReceipt__sumValue")).toHaveText(money(subtotal * people));
  if (people > 1) {
    await expect(receipt.locator(".crawlReceipt__sums .crawlReceipt__row").nth(1))
      .toHaveText(`Split ${people} ways${money(subtotal)} each`);
  } else await expect(total).toContainText("Just you");
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const mouth = document.querySelector<HTMLElement>(".crawlReceipt__mouth")!;
    const clip = mouth.getBoundingClientRect();
    const walker = document.createTreeWalker(mouth, NodeFilter.SHOW_TEXT);
    const clipped: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim() || node.parentElement?.closest("svg")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.left < clip.left - 1 || box.right > clip.right + 1
          || box.top < clip.top - 1 || box.bottom > clip.bottom + 1) clipped.push(node.textContent.trim());
      }
    }
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, clipped };
  });
}

async function evidence(page: Page, receipt: Locator, info: TestInfo, label: string) {
  await receipt.scrollIntoViewIfNeeded();
  const elementPath = info.outputPath(`${label}-receipt.png`);
  const viewportPath = info.outputPath(`${label}-viewport.png`);
  await receipt.screenshot({ path: elementPath });
  await page.screenshot({ path: viewportPath });
  await info.attach(`${label}-receipt`, { path: elementPath, contentType: "image/png" });
  await info.attach(`${label}-viewport`, { path: viewportPath, contentType: "image/png" });
}

async function jsonEvidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: "application/json" });
}

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`Victorian Soho promotions keep evidence and maths at ${width}px in ${theme}`, async ({ page }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await prepare(page, theme);
      await page.goto("/routes/victorian-soho?wild=0");
      const line = page.locator(".pintLine");
      const receipt = page.getByRole("region", { name: "The crawl receipt", exact: true });
      await expect(line.getByRole("img")).toBeVisible();
      await expect(receipt).toBeVisible();
      await expect(receipt.locator(".crawlReceipt__paper")).toHaveAttribute("data-print", "done");
      await expect(receipt).toContainText("Selected pints subtotal.");
      await expect(receipt).toContainText("Pay what the bar charges.");
      const stops = await routeStops(page);
      const items = receipt.locator(".crawlReceipt__item");
      await expect(items).toHaveCount(stops.length);
      for (const [index, stop] of stops.entries()) {
        const item = items.nth(index);
        await expect(item.locator(".crawlReceipt__itemName")).toHaveText(stop.name);
        await expect(item.locator(".crawlReceipt__itemPrice")).toHaveText(stop.price);
        await expect(item).toContainText(`${stop.drink}, a pint`);
        await expect(item).toContainText(`${stop.publisher}. Read ${stop.day}.`);
        await expect(line.locator(`.pintLine__label[data-at="${index}"]`)).toContainText(stop.price);
      }
      const subtotal = stops.reduce((sum, stop) => sum + Math.round(Number(stop.price.replace("£", "")) * 100), 0);
      await expect(line.locator(".pintLine__totals")).toContainText(money(subtotal));
      await assertReceiptMath(receipt, subtotal, 3);
      await receipt.getByRole("button", { name: "One more person", exact: true }).click();
      await assertReceiptMath(receipt, subtotal, 4);
      for (let count = 4; count > 1; count--) await receipt.getByRole("button", { name: "One fewer person", exact: true }).click();
      await assertReceiptMath(receipt, subtotal, 1);
      await expect(receipt.getByRole("button", { name: "One fewer person", exact: true })).toBeDisabled();
      const mapLink = page.getByRole("link", { name: "Plan the Victorian Soho crawl on the map", exact: true });
      const mapHref = (await mapLink.getAttribute("href"))!;
      expect(new URL(mapHref, page.url()).searchParams.get("pubs")?.split(",")).toEqual(STOP_IDS);
      const natural = await geometry(page);
      expect(natural.documentWidth).toBeLessThanOrEqual(width + 1);
      expect(natural.clipped).toEqual([]);
      const linePath = info.outputPath("natural-pint-line.png");
      await line.screenshot({ path: linePath });
      await info.attach("natural-pint-line", { path: linePath, contentType: "image/png" });
      await evidence(page, receipt, info, "natural-100-percent");
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
      const large = await geometry(page);
      await evidence(page, receipt, info, "large-text-200-percent");
      await jsonEvidence(info, "large-text-geometry", large);
      expect(large.documentWidth).toBeLessThanOrEqual(width + 1);
      expect(large.clipped).toEqual([]);
      await jsonEvidence(info, "provenance-and-observed-evidence", {
        buildRevisionProvided: process.env.PW_EVIDENCE_BUILD_SHA ?? "UNKNOWN",
        baseURL: info.project.use.baseURL, path: "/routes/victorian-soho?wild=0", width, theme,
        browser: info.project.name, reducedMotion: true, stops, subtotalPence: subtotal, mapHref, natural, large,
        screenshots: "Natural screenshots use the unmodified page. Large-text screenshots use a labelled 200 percent root font.",
      });

      if (width === 1440 && theme === "light") {
        await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
        await mapLink.click();
        await expect(page).toHaveURL((url) => url.pathname === "/map" && url.searchParams.get("mode") === "build"
          && url.searchParams.get("crawl") === "victorian-soho" && url.searchParams.get("style") === "heritage");
        await expectMapLoadingFrameReleased(page);
        await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", String(STOP_IDS.length));
        await expect(page.getByRole("button", { name: "Show whole walk", exact: true })).toBeVisible();
        await expect(page.locator(".mapDrawer.springDrawer.open")).toHaveCount(0);
        await page.getByRole("button", { name: "Edit stops", exact: true }).click();
        await expectSoleDesktopDrawer(page, "planner");
        const planner = page.locator(".mapDrawer.left .routePanel");
        await expect(planner.locator("ol.routeList > li")).toHaveCount(STOP_IDS.length);
        for (const stop of stops) await expect(planner).toContainText(stop.name);
        expect(new URL(page.url()).searchParams.get("pubs")?.split(",")).toEqual(STOP_IDS);
        const mapPath = info.outputPath("real-map-handoff-viewport.png");
        await page.screenshot({ path: mapPath });
        await info.attach("real-map-handoff-viewport", { path: mapPath, contentType: "image/png" });
        await page.goto(`/map?sel=${STOP_IDS[0]}`);
        await expectMapLoadingFrameReleased(page);
        await expectSoleDesktopDrawer(page, "venue");
        const sheet = page.locator(".mapDrawer.right .venueInspector");
        await expect(sheet.getByRole("heading", { name: stops[0]!.name, exact: true })).toBeVisible();
        await expect(sheet).toContainText(stops[0]!.price);
        await expect(sheet).toContainText(`Dataset price from ${stops[0]!.publisher}`);
        await sheet.getByRole("tab", { name: "Menu", exact: true }).click();
        await sheet.getByRole("button", { name: /^Drinks \d+ on record$/ }).click();
        const drink = sheet.locator(".drinkRow").filter({ hasText: stops[0]!.drink }).first();
        await expect(drink).toContainText(stops[0]!.price);
        await expect(drink).toContainText(stops[0]!.publisher);
        const expectedDay = new Date(`${stops[0]!.day} 12:00:00 GMT`).toISOString().slice(0, 10);
        await expect(drink.locator("time")).toHaveAttribute("dateTime", new RegExp(`^${expectedDay}`));
        const drinkPath = info.outputPath("actual-pub-sheet-menu.png");
        await drink.screenshot({ path: drinkPath });
        await info.attach("actual-pub-sheet-menu", { path: drinkPath, contentType: "image/png" });
      }
    });
  }
}
