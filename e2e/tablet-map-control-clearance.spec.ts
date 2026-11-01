import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectLayoutSettled } from "./helpers/layoutSettled";
import { expectMapToolbarReady } from "./helpers/mapToolbar";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";

test("map arrival and visible map controls retain their targets at root16 and root32", async ({ page }, testInfo) => {
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
    localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
    localStorage.removeItem("pubmax:map-chosen-area:v1");
  });
  await seedSignedIn(page, "A");
  await page.goto("/map");
  await expectMapLoadingFrameReleased(page);
  await expectMapToolbarReady(page);
  await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toBeEnabled();
  const arrival = page.getByRole("complementary", { name: "First visit", exact: true });
  await expect(arrival).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-zoom-out")).toBeVisible();
  const snapshots = [];
  for (const rootSize of [16, 32]) {
    await page.evaluate((size) => document.documentElement.style.setProperty("font-size", `${size}px`, "important"), rootSize);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expectLayoutSettled(page.getByRole("navigation", { name: "Site navigation", exact: true }));
    await expectLayoutSettled(page.locator(".mapToolbar"));
    await expectLayoutSettled(arrival);
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
    await expect(page.locator(".maplibregl-ctrl-zoom-out")).toBeVisible();
    const snapshot = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(".mapArrivalCard")!;
      const shell = card.closest<HTMLElement>(".appShell")!;
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const controls = Array.from(document.querySelectorAll<HTMLElement>(".mapArrivalCard button, .maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out, .maplibregl-ctrl-compass, .mapLayersFab, .mapCompassBtn, button[aria-label='Recenter route']"))
        .filter((control) => control.getClientRects().length > 0 && getComputedStyle(control).visibility !== "hidden")
        .map((control) => {
          const box = rect(control);
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { name: control.getAttribute("aria-label") ?? control.getAttribute("title") ?? control.textContent?.trim(), className: control.className, ...box,
            centreOwned: control.contains(hit), hitOwner: hit ? { tag: hit.tagName, className: hit.getAttribute("class"), ariaLabel: hit.getAttribute("aria-label") } : null };
        });
      const overlaps = controls.flatMap((first, index) => controls.slice(index + 1).flatMap((second) => {
        const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        return width > 0.5 && height > 0.5 ? [{ first: first.name, second: second.name, width, height }] : [];
      }));
      const text = Array.from(card.querySelectorAll<HTMLElement>(".mapArrivalCardTitle, .mapArrivalCardLead")).map((element) => {
        const range = document.createRange(); range.selectNodeContents(element);
        return { className: element.className, ...rect(element), fontSize: getComputedStyle(element).fontSize,
          lines: Array.from(range.getClientRects()).map((line) => ({ left: line.left, right: line.right, top: line.top, bottom: line.bottom })) };
      });
      const properties = Object.fromEntries(["--map-top-clearance", "--map-toolbar-resting-height", "--site-nav-floating-height", "--map-overlay-top", "--map-camera-stack-height", "--map-chrome-gap", "--map-arrival-occupied-height"].map((name) => [name, getComputedStyle(shell).getPropertyValue(name).trim()]));
      return { rootFontSize: getComputedStyle(document.documentElement).fontSize, dataTextScale: document.documentElement.getAttribute("data-text-scale"), viewportWidth: innerWidth, viewportHeight: innerHeight,
        documentWidth: document.documentElement.scrollWidth, card: rect(card), text, controls, overlaps, appShell: { className: shell.className, ...rect(shell), properties } };
    });
    snapshots.push(snapshot);
    const jsonPath = testInfo.outputPath(`map-controls-root${rootSize}.json`);
    const pngPath = testInfo.outputPath(`map-controls-root${rootSize}.png`);
    await writeFile(jsonPath, JSON.stringify(snapshot, null, 2));
    await page.screenshot({ path: pngPath });
    await testInfo.attach(`root${rootSize}-geometry`, { path: jsonPath, contentType: "application/json" });
    await testInfo.attach(`root${rootSize}`, { path: pngPath, contentType: "image/png" });
  }
  // Both actual states are on disk before the first geometry assertion.
  for (const [index, snapshot] of snapshots.entries()) {
    expect(snapshot.rootFontSize).toBe(index === 0 ? "16px" : "32px");
    expect(snapshot.overlaps).toEqual([]);
    for (const control of snapshot.controls) {
      expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
      expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
      expect(control.centreOwned, `${control.name} centre`).toBe(true);
    }
  }
});

test("map controls restore their berth after toolbar hiding and public arrival dismissal", async ({ page }, testInfo) => {
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
    localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
    localStorage.removeItem("pubmax:map-chosen-area:v1");
  });
  await seedSignedIn(page, "A");
  await page.goto("/map");
  await expectMapLoadingFrameReleased(page);
  await expectMapToolbarReady(page);
  await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toBeEnabled();
  const arrival = page.getByRole("complementary", { name: "First visit", exact: true });
  await expect(arrival).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "32px", "important"));
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const capture = async (name: string) => {
    await expectLayoutSettled(page.locator(".mapToolbar"));
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
    await expect(page.locator(".maplibregl-ctrl-zoom-out")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".appShell")!;
      const card = document.querySelector<HTMLElement>(".mapArrivalCard");
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const controls = Array.from(document.querySelectorAll<HTMLElement>(".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out, .mapLayersFab, .mapCompassBtn, button[aria-label='Recenter route']"))
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden")
        .map((element) => { const box = rect(element); return { name: element.getAttribute("aria-label") ?? element.getAttribute("title"), className: element.className, ...box,
          centreOwned: element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) }; });
      return { rootFontSize: getComputedStyle(document.documentElement).fontSize, occupiedHeight: shell.style.getPropertyValue("--map-arrival-occupied-height"),
        card: card && card.getClientRects().length ? rect(card) : null, controls };
    });
    const output = testInfo.outputPath(`${name}.json`);
    const image = testInfo.outputPath(`${name}.png`);
    await writeFile(output, JSON.stringify(geometry, null, 2));
    await page.screenshot({ path: image });
    await testInfo.attach(name, { path: output, contentType: "application/json" });
    await testInfo.attach(`${name}-image`, { path: image, contentType: "image/png" });
    return geometry;
  };
  const before = await capture("arrival-visible");
  const filters = page.locator(".mapToolbar").getByRole("button", { name: "Filters: venue types, view and zone, pub features", exact: true });
  await filters.click();
  await expect(arrival).toBeHidden();
  await expect.poll(() => page.locator(".appShell").evaluate((element) => (element as HTMLElement).style.getPropertyValue("--map-arrival-occupied-height"))).toBe("");
  const hidden = await capture("toolbar-hides-arrival");
  await page.keyboard.press("Escape");
  await expect(arrival).toBeVisible();
  await expectLayoutSettled(arrival);
  const restored = await capture("arrival-restored");
  await arrival.getByRole("button", { name: "Close", exact: true }).click();
  await expect(arrival).toHaveCount(0);
  const dismissed = await capture("arrival-dismissed");
  expect(before.card).not.toBeNull();
  expect(before.occupiedHeight).toMatch(/^\d+px$/);
  expect(hidden.card).toBeNull();
  expect(hidden.occupiedHeight).toBe("");
  expect(restored.card).not.toBeNull();
  expect(restored.occupiedHeight).toMatch(/^\d+px$/);
  expect(dismissed.card).toBeNull();
  expect(dismissed.occupiedHeight).toBe("");
  for (const geometry of [before, restored, dismissed]) {
    for (const control of geometry.controls) {
      expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
      expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
      expect(control.centreOwned, `${control.name} centre`).toBe(true);
    }
  }
});
