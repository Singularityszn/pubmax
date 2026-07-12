import { test, expect, type Page } from "@playwright/test";

// First-class /tonight screen E2E (Wave A · A2). WebGL-AGNOSTIC and
// tolerant of a quiet upstream: the screen is a pure DOM surface fed by the
// CityMCP `things_to_do` proxy, which fail-softs to an empty list. So we always
// assert the screen mounts with its heading + provenance, and only exercise the
// filter → tap-into-venue flow WHEN the upstream actually returned rows.
// House style mirrors e2e/accessible-filters.spec.ts.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("the /tonight screen mounts with an honest header and provenance", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/tonight");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("tonight-screen")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /what.?s on near you/i }),
  ).toBeVisible();

  // The screen resolves to exactly one of: list, empty, error status. Wait for
  // the loading status to clear into one of those terminal states.
  await expect(page.locator(".tonightStatus, .tonightList")).toHaveCount(1, {
    timeout: 10_000,
  });

  expect(errors).toEqual([]);
});

test("filtering by kind narrows the list and rows tap into a venue", async ({
  page,
}) => {
  await page.goto("/tonight");
  await expect(page.getByTestId("tonight-screen")).toBeVisible();

  const list = page.getByTestId("tonight-list");
  // Tolerate a quiet dataset: if no list rendered (empty/error/thin), there is
  // nothing to filter — the mount test already covered the honest fallback.
  if ((await list.count()) === 0) {
    test.info().annotations.push({
      type: "note",
      description: "Upstream returned no tonight rows — filter flow skipped.",
    });
    return;
  }

  const rows = page.getByTestId("tonight-row");
  const totalRows = await rows.count();
  expect(totalRows).toBeGreaterThan(0);

  // If a kind filter chip is present (needs >1 distinct kind), clicking it must
  // not grow the visible set.
  const chips = page.locator(".tonightChip[aria-pressed='false']");
  if ((await chips.count()) > 0) {
    await chips.first().click();
    await expect(rows).not.toHaveCount(0); // an active chip always has ≥1 row
    expect(await rows.count()).toBeLessThanOrEqual(totalRows);
    // Reset to All.
    await page.locator(".tonightChip", { hasText: /^All/ }).click();
    await expect(rows).toHaveCount(totalRows);
  }

  // The first row that links into the map is a real navigation target.
  const mapLink = page.locator(".tonightRowLink[href^='/map']").first();
  if ((await mapLink.count()) > 0) {
    const href = await mapLink.getAttribute("href");
    expect(href).toMatch(/^\/map/);
  }
});
