import { expect, type Page } from "@playwright/test";

export async function reloadForUrlSync(page: Page): Promise<void> {
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("urlSyncProbe", "1");
    window.history.replaceState(window.history.state, "", url);
  });
  await page.reload();
}

export async function expectUrlSync(page: Page): Promise<void> {
  await expect(page).toHaveURL((url) => !url.searchParams.has("urlSyncProbe"));
}
