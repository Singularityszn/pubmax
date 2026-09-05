import { expect, test, type Page } from "@playwright/test";

/**
 * F09 / J09: a single-destination outing and a two-stop outing must have an
 * obvious path. Before this landed the picker offered 3 to 6 alone, and the
 * generator refused a stopCount of 1 or 2 as a malformed Night Context.
 */
const VIEWPORT = { width: 390, height: 844 };

async function clearPlannerDrafts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmaxx:plan-route-draft:v1");
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.removeItem("pubmaxx:plan-draft:v1");
  });
}

async function chooseStopCount(page: Page, stopCount: number): Promise<void> {
  const picker = page.getByRole("group", { name: "Number of pub stops" });
  await expect(picker).toBeVisible();
  const button = picker.getByRole("button", { name: String(stopCount), exact: true });
  // A server-painted control is tappable before React attaches, so retry the
  // tap rather than asserting harder on what it produces (AGENTS.md).
  await expect(async () => {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

for (const stopCount of [1, 2] as const) {
  test(`describe-first builds a real ${stopCount}-stop outing at 390px`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize(VIEWPORT);
    await clearPlannerDrafts(page);

    const landing = await page.goto("/plan");
    expect(landing?.status()).toBe(200);

    const input = page.locator("#plan-describe-first-query");
    await expect(input).toBeVisible();
    await input.fill("quiet in Clapham, not pricey");
    await chooseStopCount(page, stopCount);

    const generation = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && response.url().endsWith("/api/plans/generate")
    ));
    await page.getByRole("button", { name: "Sort it", exact: true }).click();
    const generated = await (await generation).json() as {
      stops?: Array<{ venueId?: string }>;
      inferredContext?: { stopCount?: number };
    };
    expect(generated.inferredContext?.stopCount).toBe(stopCount);
    const venueIds = (generated.stops ?? []).map((stop) => stop.venueId);
    expect(venueIds).toHaveLength(stopCount);
    expect(new Set(venueIds).size).toBe(stopCount);

    await expect(page.locator(".planComposer__stop")).toHaveCount(stopCount, { timeout: 150_000 });
    // One pub is a meetup; two is still a crawl, because there is a walk.
    // The legend carries the preview label too, so match its opening words.
    await expect(page.locator(".planComposer__stops > legend"))
      .toHaveText(stopCount === 1 ? /^The meetup\b/ : /^The crawl\b/);

    await page.screenshot({
      path: testInfo.outputPath(`plan-${stopCount}-stop-390.png`),
      fullPage: true,
    });
  });
}

test("the stop picker offers one through six and never scrolls sideways at 390px", async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await clearPlannerDrafts(page);
  await page.goto("/plan");

  const picker = page.getByRole("group", { name: "Number of pub stops" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button")).toHaveCount(6);
  for (const count of [1, 2, 3, 4, 5, 6]) {
    await expect(picker.getByRole("button", { name: String(count), exact: true })).toBeVisible();
  }

  // Every choice keeps a real tap target, and the page never gains a sideways
  // scrollbar for the two buttons this change added.
  const boxes = await picker.getByRole("button").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, right: rect.right };
    }));
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.right).toBeLessThanOrEqual(VIEWPORT.width);
  }
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the picker is readable before the action it changes", async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await clearPlannerDrafts(page);
  await page.goto("/plan");

  const picker = page.getByRole("group", { name: "Number of pub stops" });
  const primary = page.locator("[data-primary-action]").first();
  await expect(picker).toBeVisible();
  await expect(primary).toBeVisible();

  const pickerBox = await picker.boundingBox();
  const primaryBox = await primary.boundingBox();
  if (!pickerBox || !primaryBox) throw new Error("expected both controls to be laid out");
  expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(primaryBox.y);
});
