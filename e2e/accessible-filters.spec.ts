import { test, expect, type Page } from "@playwright/test";

// Accessible-venue filters E2E (PRD issue #28). WebGL-AGNOSTIC and read-only:
// the control rail is a DOM surface that operates without the map canvas, so we
// assert the checkboxes exist, are keyboard/label-accessible, and drive the
// honest "confirmed so far" summary — WITHOUT depending on MapLibre rendering.
// House style mirrors e2e/social-loop.spec.ts: desktop viewport for the rail,
// web-first (auto-retrying) assertions, tolerate an empty/quiet dataset.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// Open /map on a desktop viewport (the rail is hidden on mobile) and wait for
// PubMap to hydrate — proven by the map region mounting (canvas OR fallback).
async function openRail(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();
  const rail = page.locator(".controlRail");
  await expect(rail).toHaveCount(1);
  return rail;
}

test("the accessible-venue filter checkboxes render, labelled and keyboard-operable", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const rail = await openRail(page);

  const section = rail.locator(".accessibilityFilters");
  await expect(section).toHaveCount(1);

  // Each checkbox is reachable by its visible label text (accessible name), so
  // it works for keyboard + screen-reader users, not just a mouse on the map.
  for (const label of ["Step-free entry", "Accessible toilet", "Seated service"]) {
    const box = section.getByLabel(label, { exact: true });
    await expect(box).toHaveCount(1);
    await expect(box).not.toBeChecked();
  }

  expect(errors).toEqual([]);
});

test("toggling step-free surfaces the honest 'confirmed so far' summary", async ({ page }) => {
  const errors = watchPageErrors(page);
  const rail = await openRail(page);
  const section = rail.locator(".accessibilityFilters");

  // No summary until a filter is active (nothing to say).
  await expect(section.locator(".accessibilitySummary")).toHaveCount(0);

  // Turn on step-free via its label (keyboard-equivalent: label toggles the box).
  const stepFree = section.getByLabel("Step-free entry", { exact: true });
  await stepFree.check();
  await expect(stepFree).toBeChecked();

  // The honest count/empty copy appears — framed as "help by spilling", never a
  // broken-filter dead end. It renders on both a populated and an empty dataset
  // (the count is just a number, ≥ 0), so this is safe against quiet data.
  const summary = section.locator(".accessibilitySummary");
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText("confirmed step-free entry");
  await expect(summary).toContainText("help by spilling what you know");

  // Turning it back off removes the summary again (no-op state restored).
  await stepFree.uncheck();
  await expect(section.locator(".accessibilitySummary")).toHaveCount(0);

  expect(errors).toEqual([]);
});
