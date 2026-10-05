import { expect, test, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

type GeneratedStop = {
  venueId: string;
  venueName: string;
  alternatives: { venueId: string; venueName: string }[];
};

async function installWebMcpHarness(page: Page) {
  await page.addInitScript(() => {
    const tools: Record<string, { execute: (input: unknown, context: { signal: AbortSignal }) => Promise<unknown> }> = {};
    Object.defineProperty(window, "__pubmaxxWebMcpTools", { value: tools });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: typeof tools[string]) {
          const named = tool as typeof tools[string] & { name: string };
          tools[named.name] = named;
          return Promise.resolve(undefined);
        },
      },
    });
  });
}

async function invokeTool(page: Page, name: string, input: unknown) {
  return page.evaluate(async ({ toolName, toolInput }) => {
    const tools = (window as typeof window & {
      __pubmaxxWebMcpTools: Record<string, {
        execute: (input: unknown, context: { signal: AbortSignal }) => Promise<unknown>;
      }>;
    }).__pubmaxxWebMcpTools;
    return tools[toolName].execute(toolInput, { signal: new AbortController().signal });
  }, { toolName: name, toolInput: input });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await installWebMcpHarness(page);
  await page.route("**/api/citymcp/status**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      asOf: "2026-09-03T18:00:00.000Z",
      weather: { condition: "Clear", tempC: 18 },
      tubeLines: [{ line: "Northern", status: "Minor delays" }],
      signals: [],
    }),
  }));
  await page.route("**/api/citymcp/things-to-do**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      asOf: "2026-09-03T18:00:00.000Z",
      opportunities: [{ title: "Late comedy", kind: "comedy", place: { name: "Clapham Grand" } }],
    }),
  }));
});

test("person and agent share evidence, route revisions, and safe swaps", async ({ page }) => {
  await page.goto("/webmcp");
  await expect(page.getByRole("status")).toContainText("Agent tools ready");

  await invokeTool(page, "search_pubmaxx_venues", { query: "Falcon", limit: 4 });
  await invokeTool(page, "read_london_night_context", {});
  await expect(page.getByText("The Falcon")).toBeVisible();
  await expect(page.getByText("Late comedy")).toBeVisible();

  const generated = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/plans/generate",
  );
  await invokeTool(page, "draft_pub_crawl", {
    request: "Three cheap lively pubs in Clapham",
    expectedRevision: 0,
  });
  const route = await (await generated).json() as { stops: GeneratedStop[] };
  await expect(page.getByText("Revision 1")).toBeVisible();
  for (const stop of route.stops) {
    await expect(page.getByRole("heading", { name: stop.venueName, exact: true })).toBeVisible();
  }

  // The route's own alternatives drive the swap, so it uses real pack ids.
  const usedVenueIds = new Set(route.stops.map((stop) => stop.venueId));
  const swappedIndex = route.stops.findIndex((stop) =>
    stop.alternatives.some((alternative) => !usedVenueIds.has(alternative.venueId)));
  const swappedStop = route.stops[swappedIndex];
  const replacement = swappedStop?.alternatives.find((alternative) => !usedVenueIds.has(alternative.venueId));
  if (!swappedStop || !replacement) throw new Error("the generated route offered no unused alternative to swap in");
  const position = swappedIndex + 1;
  const swap = await invokeTool(page, "swap_crawl_stop", { position, expectedRevision: 1 });
  expect(swap).toMatchObject({ status: "ok", revision: 2, routeStale: true });
  await expect(page.getByText("Revision 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: replacement.venueName, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: swappedStop.venueName, exact: true })).toHaveCount(0);
  await expect(page.getByText("Needs refresh")).toBeVisible();

  const fits = await page.locator(".webmcpShell").evaluate(
    (element) => element.scrollWidth <= element.clientWidth + 1,
  );
  expect(fits).toBe(true);
  for (const button of await page.getByRole("button").all()) {
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
