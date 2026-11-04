import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectLayoutSettled } from "./helpers/layoutSettled";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { expectMapToolbarReady } from "./helpers/mapToolbar";

// Fixture authentication and CSS root-size emulation are not native/device proof.
test("tablet map toolbar controls stay readable at 641px and root32", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 641, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await installAuthDoubles(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await seedSignedIn(page, "A");
  await page.goto("/map");
  await expectMapLoadingFrameReleased(page);
  const nav = page.getByRole("navigation", { name: "Site navigation", exact: true });
  await expect(nav.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toBeEnabled();
  await expectMapToolbarReady(page);
  const toolbar = page.getByRole("search").filter({ has: page.getByRole("combobox", { name: "Search pubs", exact: true }) });
  await expect(toolbar).toHaveCount(1);
  await expect(toolbar.getByRole("button", { name: "Plan an outing", exact: true })).toBeEnabled();
  await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expectLayoutSettled(nav);
  await expectLayoutSettled(toolbar);
  const geometry = await toolbar.evaluate((element) => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Site navigation"]');
    const navBox = nav?.getBoundingClientRect();
    const bar = element.getBoundingClientRect();
    const controls = Array.from(element.querySelectorAll<HTMLElement>(".mapToolbarRow input, .mapToolbarRow button, .mapToolbarRow a"))
      .filter((control) => control.getClientRects().length > 0 && getComputedStyle(control).visibility !== "hidden")
      .map((control) => {
        const box = control.getBoundingClientRect();
        const labels = [];
        const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const text = range.getBoundingClientRect();
          if (text.width > 1 && text.height > 1) labels.push({ text: node.textContent.trim(), left: text.left, right: text.right, top: text.top, bottom: text.bottom });
        }
        const style = getComputedStyle(control);
        return { name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
          left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
          clientWidth: control.clientWidth, scrollWidth: control.scrollWidth, fontSize: style.fontSize, labels,
          centreOwned: control.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      });
    const overlaps = controls.flatMap((first, index) => controls.slice(index + 1).flatMap((second) => {
      const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      return width > 0.5 && height > 0.5 ? [{ first: first.name, second: second.name, width, height }] : [];
    }));
    return { rootFontSize: getComputedStyle(document.documentElement).fontSize,
      dataTextScale: document.documentElement.getAttribute("data-text-scale"),
      viewportWidth: innerWidth, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth, toolbarTop: bar.top, toolbarBottom: bar.bottom, navBottom: navBox?.bottom ?? null,
      controls, overlaps };
  });
  const geometryPath = testInfo.outputPath("toolbar-geometry.json");
  const screenshotPath = testInfo.outputPath("toolbar.png");
  await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("toolbar-geometry", { path: geometryPath, contentType: "application/json" });
  await testInfo.attach("toolbar", { path: screenshotPath, contentType: "image/png" });
  expect(geometry.rootFontSize).toBe("32px");
  expect(geometry.controls.length).toBeGreaterThanOrEqual(4);
  expect(geometry.overlaps).toEqual([]);
  expect(geometry.navBottom).not.toBeNull();
  expect(geometry.toolbarTop).toBeGreaterThanOrEqual(geometry.navBottom ?? Infinity);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  for (const control of geometry.controls) {
    expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
    expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
    expect(control.centreOwned, `${control.name} hit target`).toBe(true);
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(control.top).toBeGreaterThanOrEqual(0);
    expect(control.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    for (const label of control.labels) {
      expect(label.left, `${control.name} whole label left`).toBeGreaterThanOrEqual(control.left - 0.5);
      expect(label.right, `${control.name} whole label right`).toBeLessThanOrEqual(control.right + 0.5);
      expect(label.top).toBeGreaterThanOrEqual(control.top - 0.5);
      expect(label.bottom).toBeLessThanOrEqual(control.bottom + 0.5);
    }
  }
});
