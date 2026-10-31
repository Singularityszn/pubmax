import { expect, type Locator, type Page } from "@playwright/test";

import { type OverviewFoldKey } from "@/lib/venueOverviewFolds";

/**
 * The Overview is five folds (lib/venueOverviewFolds.ts), and only Price is
 * open on arrival. A spec that reads a block in another fold opens that fold
 * first, through this ONE helper, so the day a block moves fold there is one
 * place to follow it.
 *
 * The sheet keeps changing height after it opens, so a tap can land beside
 * the summary. The tap is retried only while the fold is still shut, so a
 * slow toggle is never undone.
 */
export async function openOverviewFold(
  scope: Page | Locator,
  key: OverviewFoldKey,
  timeout = 20_000,
): Promise<Locator> {
  const fold = scope.locator(`#venueFold-${key}`).first();
  await expect(fold).toBeAttached({ timeout: Math.max(timeout, 60_000) });
  const summary = fold.locator(":scope > summary");
  await expect(async () => {
    if ((await fold.getAttribute("open")) === null) await summary.click();
    await expect(fold).toHaveAttribute("open", "", { timeout: 1_000 });
  }).toPass({ timeout });
  return fold;
}
