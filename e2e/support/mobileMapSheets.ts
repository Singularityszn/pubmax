import { expect, type Locator, type Page } from "@playwright/test";

export async function mockScrollableMobileSheets(page: Page): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await page.route("**/api/whats-on**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      asOf: new Date().toISOString(),
      rows: Array.from({ length: 5 }, (_, index) => ({
        id: `mobile-tonight-${index}`,
        venueId: "venue-xjf3n0",
        placeName: `Test pub ${index + 1}`,
        kind: index % 2 ? "sport" : "quiz",
        startsAt: `${day}T2${index}:00:00+01:00`,
        title: `Tonight listing ${index + 1}`,
        source: { label: "Venue site", url: "https://example.com/" },
        observedAt: new Date().toISOString(),
        confidence: "listed",
      })),
    }),
  }));
  await page.route("**/api/citymcp/status**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      asOf: new Date().toISOString(),
      signals: [],
      tubeLines: Array.from({ length: 14 }, (_, index) => ({
        line: `Test line ${index + 1}`,
        status: "Severe delays",
        disruption: `Long disruption report ${index + 1} with enough detail to exercise mobile scrolling.`,
      })),
    }),
  }));
}

export async function expectContainedInSheetBody(content: Locator): Promise<void> {
  const containment = await content.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const body = node.closest(".mobileSharedSheetBody")?.getBoundingClientRect();
    return body ? { left: rect.left - body.left, right: body.right - rect.right } : null;
  });
  expect(containment).not.toBeNull();
  expect(containment?.left ?? -1).toBeGreaterThanOrEqual(0);
  expect(containment?.right ?? -1).toBeGreaterThanOrEqual(0);
}
