import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { PINT_COMPASS_DOOR_NAME } from "../lib/pintCompassDoor";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMobileMapShellReady, mobileMapShellControl } from "./helpers/mobileMapShell";

// The map's two doors to /compass, measured. On a phone the door is a shortcut
// in More map controls, Layers, because the resting map edge keeps Near me
// alone (the three-layer rule). On a desktop it is the row under Use my
// location in the city list, Near me's own home there. Each check reads the
// rendered boxes: every control at least 44 px each way, at least one spacing
// token between any two, nothing overlapping, nothing clipped or truncated.

const SHOTS = "artifacts/pint-compass";

type Box = { x: number; y: number; width: number; height: number };

async function quietMap(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await installDeterministicMapBasemap(page);
  await page.addInitScript((choice) => {
    localStorage.setItem("pubmax-theme", choice);
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  }, theme);
}

/** A spacing token's value in px, read off the page rather than retyped. */
async function spaceToken(page: Page, name: "--space-1" | "--space-2"): Promise<number> {
  const value = await page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token),
    name,
  );
  const px = Number.parseFloat(value);
  expect(Number.isFinite(px), name).toBe(true);
  return px;
}

/** The empty space between two boxes along whichever axis separates them. */
function separation(a: Box, b: Box): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(dx, dy);
}

async function boxesOf(controls: Locator): Promise<Box[]> {
  const boxes: Box[] = [];
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (box) boxes.push(box);
  }
  return boxes;
}

function expectTargetsAndGaps(boxes: Box[], minGap: number, viewportWidth: number) {
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      // A positive separation also means the two do not overlap.
      expect(separation(boxes[i] as Box, boxes[j] as Box), `controls ${i} and ${j}`).toBeGreaterThanOrEqual(minGap - 0.5);
    }
  }
}

async function expectNotTruncated(control: Locator) {
  const clipped = await control.evaluate((node) => {
    const parts = [node, ...node.querySelectorAll("*")] as HTMLElement[];
    return parts.some((part) => part.scrollWidth > part.clientWidth + 1 && getComputedStyle(part).overflow !== "visible");
  });
  expect(clipped).toBe(false);
}

for (const width of [320, 390, 430] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${width}px ${theme}: More map controls carries the Pint compass door with room around it`, async ({ page }) => {
      test.setTimeout(120_000);
      mkdirSync(SHOTS, { recursive: true });
      await page.setViewportSize({ width, height: 844 });
      await quietMap(page, theme);
      await page.goto("/map");
      await expectMobileMapShellReady(page);

      // The resting map edge gains nothing: Near me is still there, and the
      // door is not. (The edge may also hold TfL while a line is badly
      // disrupted, so its count is the feed's business, not this change's.)
      await expect(await mobileMapShellControl(page, "nearMe")).toHaveCount(1);
      const corner = page.locator(".mobileMapUtilityCorner");
      await expect(corner.getByRole("link", { name: PINT_COMPASS_DOOR_NAME })).toHaveCount(0);
      await expect(corner.getByRole("button", { name: /compass/i })).toHaveCount(0);

      const more = await mobileMapShellControl(page, "more");
      await expect(async () => {
        await more.click();
        await expect(page.getByRole("tab", { name: "Layers" })).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      await page.getByRole("tab", { name: "Layers" }).click();

      const shortcuts = page.locator(".mobileLayerShortcuts").filter({ visible: true });
      const door = shortcuts.getByRole("link", { name: PINT_COMPASS_DOOR_NAME });
      await expect(door).toBeVisible();
      await expect(door).toHaveText("Pint compass");
      await expectNotTruncated(door);

      const controls = shortcuts.locator(":scope > a, :scope > button");
      expectTargetsAndGaps(await boxesOf(controls), await spaceToken(page, "--space-2"), width);
      await page.screenshot({ path: `${SHOTS}/map-door-${width}-${theme}.png` });

      await door.click();
      await expect(page).toHaveURL(/\/compass$/);
      await expect(page.getByRole("heading", { level: 1, name: "Point me at a cheap pint" })).toBeVisible();
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`1280px ${theme}: the city list carries the Pint compass door under Use my location`, async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await quietMap(page, theme);
    await page.goto("/map");

    const trigger = page.locator(".citySwitcherTrigger").filter({ visible: true });
    const list = page.getByRole("listbox", { name: "Choose city map" });
    await expect(async () => {
      await trigger.click();
      await expect(list).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });

    const nearMe = list.getByRole("button", { name: /Use my location|Locating/ });
    const door = list.getByRole("link", { name: PINT_COMPASS_DOOR_NAME });
    await expect(door).toBeVisible();
    await expect(door).toHaveText("Pint compass");
    await expectNotTruncated(door);

    // Near me and the door are a pair: the door comes straight after it.
    const [nearBox, doorBox] = await boxesOf(list.locator(".citySwitcherLocationLink"));
    expect(nearBox && doorBox).toBeTruthy();
    expect(await nearMe.boundingBox()).toEqual(nearBox);
    expectTargetsAndGaps([nearBox as Box, doorBox as Box], await spaceToken(page, "--space-1"), 1280);

    // Every row in the list keeps its target and none overlaps the next.
    const rows = await boxesOf(list.locator(".citySwitcherLink").filter({ visible: true }));
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] as Box;
      expect(row.height).toBeGreaterThanOrEqual(44);
      const next = rows[i + 1];
      if (next) expect(next.y).toBeGreaterThanOrEqual(row.y + row.height - 0.5);
    }
    const listBox = await list.boundingBox();
    expect(listBox).not.toBeNull();
    if (listBox) expect(listBox.x + listBox.width).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: `${SHOTS}/map-door-1280-${theme}.png` });

    await door.click();
    await expect(page).toHaveURL(/\/compass$/);
  });
}
