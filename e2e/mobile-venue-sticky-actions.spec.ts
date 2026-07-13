import { expect, test } from "@playwright/test";

function stableVenueIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("mobile venue sticky Share and Crawl actions stay tappable in build mode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem("pubmax-e2e-shared-url", value);
        },
      },
    });
  });

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
  expect(response?.status()).toBe(200);

  const sheet = page.locator(".mapDrawer.right");
  await expect(sheet).toHaveClass(/open/);

  const stickyActions = page.getByRole("toolbar", { name: "Venue actions" });
  await expect(stickyActions).toBeVisible();

  const crawlButton = stickyActions.getByRole("button", { name: "Crawl" });
  await expect(crawlButton).toHaveAttribute("aria-pressed", "false");
  await crawlButton.click();
  const removeButton = stickyActions.getByRole("button", { name: "Remove" });
  await expect(removeButton).toHaveAttribute("aria-pressed", "true");
  await removeButton.click();
  await expect(crawlButton).toHaveAttribute("aria-pressed", "false");

  await stickyActions.getByRole("button", { name: /share arnos arms/i }).click();
  await expect(stickyActions.getByRole("status")).toHaveText("Link copied.");
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-shared-url"))).toContain(
    `/map?sel=${ARNOS_ARMS_ID}`,
  );
});

test("mobile sticky Train action opens Last train and the sheet reopens cleanly", async ({
  page,
}) => {
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  const sheet = page.locator(".mapDrawer.right");
  await expect(sheet).toHaveClass(/open/);

  const stickyActions = page.getByRole("toolbar", { name: "Venue actions" });
  await expect(stickyActions).toBeVisible();

  const lastTrainTab = page.getByRole("tab", { name: "Last train", exact: true });
  await stickyActions.getByRole("button", { name: "Check last train" }).click();
  await expect(lastTrainTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#venuePanel-getting-home")).toBeVisible();
  await expect(sheet).toHaveClass(/sheet-full/);

  await page.getByRole("button", { name: "Close pub detail" }).click();
  await expect(sheet).not.toHaveClass(/open/);

  await page.reload();
  await expect(sheet).toHaveClass(/open/);
  await expect(stickyActions).toBeVisible();
  await expect(page.getByRole("tab", { name: "Drops", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#venuePanel-pints")).toBeVisible();
});
