import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectLayoutSettled } from "./helpers/layoutSettled";
import { expectMapToolbarReady } from "./helpers/mapToolbar";
import { expectMapLoadingFrameReleased, expectMobileMapShellReady } from "./helpers/mobileMapShell";

// London opens on the Fair Pint card. The docked First visit strip and its berth run in every other city.
const DOCKED_ARRIVAL_MAP = "/map/manchester";

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
  await page.goto(DOCKED_ARRIVAL_MAP);
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
  await page.goto(DOCKED_ARRIVAL_MAP);
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

// London's arrival surface is the Fair Pint card, docked at the foot of the map on every width.
const FAIR_PINT_CARD = ".fairPintCard:not([data-fair-prelude])";
const MAP_CONTROLS = ".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out, .maplibregl-ctrl-compass, .mapLayersFab, .mapCompassBtn, button[aria-label='Recenter route'], .mobileMapUtilityCorner :is(button, a[href])";

for (const [width, height] of [[390, 844], [641, 900], [768, 1024], [1024, 768], [1440, 900]] as const) {
  test(`London's Fair Pint card leaves every map control its target at ${width}x${height}, root16 and root32`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
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
    if (width <= 640) await expectMobileMapShellReady(page);
    else await expectMapToolbarReady(page);
    const card = page.locator(FAIR_PINT_CARD);
    await expect(card).toBeVisible();
    await expect(card.getByRole("slider", { name: "Fair pint price" })).toBeEnabled();
    // The map's own controls mount after the card, and Layers rises into place.
    if (width > 640) {
      await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
      await expectLayoutSettled(page.locator(".mapLayersFab"));
    }
    const measure = (name: string) => page.evaluate(({ cardSelector, controlSelector }) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const shown = (element: HTMLElement) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
      const cardNode = document.querySelector<HTMLElement>(cardSelector);
      const cardBox = cardNode && shown(cardNode) ? rect(cardNode) : null;
      const target = (element: HTMLElement) => {
        const box = rect(element);
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { name: element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent?.trim(), ...box, centreOwned: element.contains(hit),
          hitOwner: hit ? { tag: hit.tagName, className: hit.getAttribute("class"), ariaLabel: hit.getAttribute("aria-label") } : null };
      };
      const controls = Array.from(document.querySelectorAll<HTMLElement>(controlSelector)).filter(shown).map(target);
      const cardControls = cardNode && cardBox ? Array.from(cardNode.querySelectorAll<HTMLElement>("button:enabled, input:enabled")).filter(shown).map(target) : [];
      const underCard = cardBox ? controls.filter((control) => Math.min(control.right, cardBox.right) - Math.max(control.left, cardBox.left) > 0.5
        && Math.min(control.bottom, cardBox.bottom) - Math.max(control.top, cardBox.top) > 0.5).map((control) => control.name) : [];
      return { rootFontSize: getComputedStyle(document.documentElement).fontSize, viewport: { width: innerWidth, height: innerHeight },
        card: cardBox, berth: document.documentElement.style.getPropertyValue("--map-fair-pint-berth"), controls, cardControls, underCard };
    }, { cardSelector: FAIR_PINT_CARD, controlSelector: MAP_CONTROLS }).then(async (geometry) => {
      const output = testInfo.outputPath(`${name}.json`);
      const image = testInfo.outputPath(`${name}.png`);
      await writeFile(output, JSON.stringify(geometry, null, 2));
      await page.screenshot({ path: image });
      await testInfo.attach(name, { path: output, contentType: "application/json" });
      await testInfo.attach(`${name}-image`, { path: image, contentType: "image/png" });
      return geometry;
    });
    const snapshots = [];
    for (const rootSize of [16, 32]) {
      await page.evaluate((size) => document.documentElement.style.setProperty("font-size", `${size}px`, "important"), rootSize);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await expectLayoutSettled(card);
      snapshots.push(await measure(`fair-pint-root${rootSize}`));
    }
    // The lowest price adds the reason line under Draw: the tallest card a reader meets.
    await card.getByRole("slider", { name: "Fair pint price" }).press("Home");
    await expect(card.getByText(/^Fewer than 3 pubs in /)).toBeVisible();
    await expectLayoutSettled(card);
    snapshots.push(await measure("fair-pint-root32-lowest-price"));
    const openLayers = width > 640 ? await (async () => {
      const panel = page.locator(".mapLayersPanel");
      await expect(async () => {
        await page.locator(".mapLayersFab").click();
        await expect(panel).toBeVisible({ timeout: 1_000 });
      }).toPass();
      await expectLayoutSettled(panel);
      const geometry = await panel.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const underCard = Array.from(node.querySelectorAll<HTMLElement>("button:enabled, input:enabled")).filter((target) => {
          const rect = target.getBoundingClientRect();
          const y = rect.top + rect.height / 2;
          if (y <= box.top || y >= box.bottom) return false;
          return Boolean(document.elementFromPoint(rect.left + rect.width / 2, y)?.closest(".fairPintCard"));
        }).map((target) => target.getAttribute("aria-label") ?? target.textContent?.trim());
        return { left: box.left, right: box.right, viewport: innerWidth, underCard };
      });
      await page.locator(".mapLayersFab").click();
      await expect(panel).toHaveCount(0);
      return geometry;
    })() : null;
    await card.getByRole("button", { name: "Close", exact: true }).click();
    await expect(card).toHaveCount(0);
    const closed = await measure("fair-pint-closed-root32");
    // Every state is on disk before the first geometry assertion.
    for (const [index, snapshot] of snapshots.entries()) {
      expect(snapshot.rootFontSize).toBe(index === 0 ? "16px" : "32px");
      expect(snapshot.card).not.toBeNull();
      expect(snapshot.controls.length, "map controls on screen").toBeGreaterThan(0);
      expect(snapshot.underCard, "map controls under the card").toEqual([]);
      for (const control of [...snapshot.controls, ...snapshot.cardControls]) expect(control.centreOwned, `${control.name} centre`).toBe(true);
    }
    // Beside the card, the open Layers panel stays on screen and the card covers none of it.
    if (openLayers) {
      expect(openLayers.left, "Layers panel left edge").toBeGreaterThanOrEqual(0);
      expect(openLayers.right, "Layers panel right edge").toBeLessThanOrEqual(openLayers.viewport);
      expect(openLayers.underCard, "Layers panel targets under the card").toEqual([]);
    }
    expect(closed.card).toBeNull();
    expect(closed.berth).toBe("");
    for (const control of closed.controls) expect(control.centreOwned, `${control.name} centre after close`).toBe(true);
  });
}
