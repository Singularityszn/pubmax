import type { Page } from "@playwright/test";

export async function advanceUrlSync(page: Page): Promise<void> {
  await page.clock.runFor(1_000);
}
