import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ThingsToDoResult } from "../lib/citymcp/client";
import type { WhatsOnRow } from "../lib/whatsOn";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { storeThemeChoice } from "./helpers/themeClock";
import { UI_UX_CHROMIUM_ARGS } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

// The first location prompt waits for painted pins, so this file needs a real
// WebGL context. SwiftShader gives every box the same software one.
test.use({ serviceWorkers: "block", launchOptions: { args: [...UI_UX_CHROMIUM_ARGS] } });

for (const theme of ["light", "dark"] as const) for (const fontSize of [16, 32]) {
  test(`desktop toolbar controls remain separate at ${fontSize}px browser text in ${theme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await storeThemeChoice(page, theme);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontSize } });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?wild=0");
    await expectMapLoadingFrameReleased(page);
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator(".mapSplitList")).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
    const toolbar = page.locator(".mapToolbar");
    const controls = [toolbar.getByRole("combobox", { name: "Search pubs" }), toolbar.locator(".mapVenueKindFilterBtn"), toolbar.locator(".mapToolbarDrinkLaneBtn"), toolbar.locator(".planBtn"), toolbar.locator(".citySwitcherTrigger")];
    for (const control of controls) await expect(control).toBeVisible();
    const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
    await info.attach(`toolbar-${theme}-${fontSize}-geometry`, { body: JSON.stringify(boxes), contentType: "application/json" });
    const shot = await page.screenshot();
    await info.attach(`toolbar-${theme}-${fontSize}-viewport`, { body: shot, contentType: "image/png" });
    if (process.env.R5_PROOF_DIR) {
      await mkdir(process.env.R5_PROOF_DIR, { recursive: true });
      await writeFile(path.join(process.env.R5_PROOF_DIR, `toolbar-${theme}-${fontSize}.png`), shot);
      await writeFile(path.join(process.env.R5_PROOF_DIR, `toolbar-${theme}-${fontSize}.json`), JSON.stringify(boxes, null, 2));
    }
    await controls[0]!.focus();
    for (const control of controls.slice(1)) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
    }
    const filter = controls[1]!;
    await filter.focus();
    await page.keyboard.press("Space");
    await expect(filter).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    for (let i = 0; i < boxes.length; i += 1) {
      const a = boxes[i]!;
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(1440);
      for (let j = i + 1; j < boxes.length; j += 1) {
        const b = boxes[j]!;
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 &&
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
        expect(overlap, `controls ${i} and ${j} overlap`).toBe(false);
      }
    }
  });
}

for (const theme of ["light", "dark"] as const) for (const fontSize of [16, 32]) {
  test(`first location prompt contains its text and controls at ${fontSize}px in ${theme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await storeThemeChoice(page, theme);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontSize } });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?wild=0");
    const card = page.locator(".mapArrivalCard");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 45_000 });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
    const children = [card.locator(".mapArrivalCardTitle"), card.locator(".mapArrivalCardLead"),
      card.getByRole("button", { name: "Use my location" }), card.getByRole("button", { name: "Choose an area" }),
      card.getByRole("button", { name: "Close" })];
    for (const child of children) await expect(child).toBeVisible();
    const box = (await card.boundingBox())!;
    const boxes = await Promise.all(children.map((child) => child.boundingBox()));
    const shot = await page.screenshot();
    await info.attach(`arrival-${theme}-${fontSize}-viewport`, { body: shot, contentType: "image/png" });
    if (process.env.R5_PROOF_DIR) {
      await mkdir(process.env.R5_PROOF_DIR, { recursive: true });
      await writeFile(path.join(process.env.R5_PROOF_DIR, `arrival-${theme}-${fontSize}.png`), shot);
      await writeFile(path.join(process.env.R5_PROOF_DIR, `arrival-${theme}-${fontSize}.json`), JSON.stringify({ box, boxes }, null, 2));
    }
    for (let i = 0; i < boxes.length; i += 1) {
      const a = boxes[i]!;
      expect(a.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(a.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(a.x + a.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(a.y + a.height).toBeLessThanOrEqual(box.y + box.height + 1);
      for (let j = i + 1; j < boxes.length; j += 1) {
        const b = boxes[j]!;
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 &&
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
        expect(overlap, `prompt elements ${i} and ${j} overlap`).toBe(false);
      }
    }
    await children[2]!.focus();
    await page.keyboard.press("Tab");
    await expect(children[3]!).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(children[4]!).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  });
}


test("Soho Tonight lane clears the wrapped toolbar at 32px browser text", async ({ page, context }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await storeThemeChoice(page, "dark");
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32 } });
  await installDeterministicMapBasemap(page);
  const now = "2026-11-03T18:00:00.000Z";
  await page.clock.setFixedTime(new Date(now));
  const opportunities: ThingsToDoResult = {
    window: "tonight",
    asOf: now,
    opportunities: [{
      title: "An evening at The French House",
      kind: "food_drink",
      place: {
        id: "venue-1kpe609",
        name: "The French House",
        area: "Soho",
        location: { lat: 51.51312, lng: -0.13196 },
      },
    }],
  };
  const listings: { rows: WhatsOnRow[]; servedAt: string; asOf: null } = {
    rows: [],
    servedAt: now,
    asOf: null,
  };
  await page.route("**/api/citymcp/things-to-do?**", (route) =>
    route.fulfill({ json: opportunities }),
  );
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({ json: listings }),
  );
  await page.goto("/map?area=piccadilly-soho");
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
  const lane = page.locator(".tonightLane");
  await expect(lane).toBeVisible({ timeout: 30_000 });
  await expect(lane).toContainText("Tonight nearby");
  await expect(lane).toContainText("Pins");
  const activePins = lane.getByRole("button", { name: "Hide Pins", exact: true });
  await expect(activePins).toHaveAttribute("aria-pressed", "true");
  const toolbar = (await page.locator(".mapToolbar").boundingBox())!;
  const laneBox = (await lane.boundingBox())!;
  const shot = await page.screenshot();
  await info.attach("soho-32-tonight-viewport", { body: shot, contentType: "image/png" });
  if (process.env.R5_PROOF_DIR) {
    await mkdir(process.env.R5_PROOF_DIR, { recursive: true });
    await writeFile(path.join(process.env.R5_PROOF_DIR, "soho-32-tonight.png"), shot);
    await writeFile(path.join(process.env.R5_PROOF_DIR, "soho-32-tonight.json"), JSON.stringify({ toolbar, lane: laneBox }, null, 2));
  }
  expect(laneBox.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 0.5);
});
