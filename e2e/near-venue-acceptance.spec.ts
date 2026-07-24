import { test, expect, type Page } from "@playwright/test";

// DAG L06 — with intent-write off (the shipped default) /near stays a browse-only
// surface: the standard SiteNav shell renders, each answer card is a single
// browse button, and opening one selects the Venue on the Map (?sel=) WITHOUT
// writing a PlanningIntent. Accepting a Venue is a separate, explicit act the
// PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE flag gates on; none of its affordances
// appear here. The explicit-acceptance path itself is exercised exhaustively in
// __tests__/venueAcceptance.test.ts (pure, node-env), since the flag DTO is
// delivered to the client by the Map lane (L05) and is off on this base.

const PLANNING_INTENT_KEY = "pubmax:planning-intent:v1";

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("Near is browse-only and writes no PlanningIntent with acceptance off", async ({ page }) => {
  const errors = watchPageErrors(page);

  // Shareable patch link answers immediately, no geolocation prompt needed.
  const response = await page.goto("/near?patch=soho");
  expect(response?.status()).toBe(200);

  // Standard app chrome (upstream centered Near shell) — never the removed
  // custom back-arrow shell.
  await expect(page.getByRole("navigation", { name: "Site navigation" })).toBeVisible();
  await expect(page.locator("section.nmn")).toBeVisible();

  // The patch answer resolves to real cards.
  const firstCard = page.locator(".nmnCard").first();
  await expect(firstCard).toBeVisible();

  // Acceptance affordances are absent while the flag is off: no "Use this pub"
  // button and no evidence receipt.
  await expect(page.locator(".nmnAccept")).toHaveCount(0);
  await expect(page.locator(".nmnAcceptReceipt")).toHaveCount(0);

  // Nothing was written just by rendering the answer.
  const beforeClick = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    PLANNING_INTENT_KEY,
  );
  expect(beforeClick).toBeNull();

  // Opening a card is browse: it navigates to the canonical selected Map URL and
  // still leaves no stored intent behind.
  await firstCard.click();
  await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=/);
  const afterClick = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    PLANNING_INTENT_KEY,
  );
  expect(afterClick).toBeNull();

  // The /near surface itself raised no uncaught errors.
  expect(errors).toEqual([]);
});
