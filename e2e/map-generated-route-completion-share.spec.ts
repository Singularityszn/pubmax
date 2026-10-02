import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

import type { SelectedDrinkPriceEvidence } from "../lib/planSelectedDrinkPriceEvidence";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

type RouteKind = "vodka" | "zero-proof";
type GeneratedStop = {
  venueId: string;
  venueName: string;
  selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence | null;
};
type GeneratedAuthority = {
  grounded: boolean;
  inferredContext: { nightArea: string; drinkCategory: string | null; zeroProof: boolean };
  budgetSummary: {
    estimatedPerPersonPence: number | null;
    estimatedCrewPence: number | null;
    basis: string;
  };
  stops: GeneratedStop[];
};

// Real generation, progress controls and native clipboard/navigation. Existing
// auth and basemap doubles do not prove provider login or public street paint.
// No route IDs, prices, proofs or completion state are seeded or intercepted.
test.use({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

async function prepareBrowser(page: Page) {
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
}

function renderedPanel(page: Page) {
  return page.locator(".routePanel:visible");
}

async function openRenderedPanel(page: Page) {
  const panel = renderedPanel(page);
  await expect(async () => {
    if (!await panel.isVisible()) {
      await page.getByRole("button", { name: /Edit active \d+-stop plan/ }).click({ timeout: 1_000 });
    }
    await expect(panel).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(panel).toHaveCount(1);
  return panel;
}

async function recordState(page: Page, info: TestInfo, label: string) {
  const panel = renderedPanel(page);
  await info.attach(label, {
    contentType: "application/json",
    body: JSON.stringify({
      url: page.url(),
      storedIds: await page.evaluate(() => {
        const raw = localStorage.getItem("pubmax_built_ids");
        return raw ? JSON.parse(raw) : null;
      }),
      header: await panel.locator(".routeHeader").innerText(),
      metrics: await panel.locator(".routeMetrics").innerText(),
      stops: await panel.locator(".routeList").innerText(),
    }, null, 2),
  });
}

async function expectGeneratedPresentation(page: Page, authority: GeneratedAuthority, kind: RouteKind, soft = false) {
  const panel = await openRenderedPanel(page);
  await expect(panel.locator(".routeList > li")).toHaveCount(authority.stops.length);
  await expect.poll(() => panel.locator(".routeList > li > button strong").evaluateAll((elements) =>
    elements.map((element) => Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "").join("").trim()),
  )).toEqual(authority.stops.map((stop) => stop.venueName));
  const check = soft ? expect.soft : expect;
  const options = { timeout: soft ? 1_000 : 10_000 };
  const label = kind === "vodka" ? "Vodka" : "Alcohol-free";
  await check(panel.locator(".routeHeader h2")).toHaveText(`${label} plan`, options);
  const metrics = panel.locator(".routeMetrics");
  await check(metrics).toContainText("Not recorded", options);
  await check(metrics).toContainText(`${label.toLowerCase()} stops`, options);
  await check(metrics).not.toContainText(/£|estimated round|\bpint stops?\b/i, options);
  await check(panel.getByRole("radio", { name: "Pint", exact: true })).toHaveCount(0, options);

  // Every public price/citation/measure comes from the actual HTTP response.
  // Zero-proof policy provides no alcoholic quote, so its unknown rows remain
  // unknown rather than borrowing a pint or inventing a soft-drink price.
  for (const [index, stop] of authority.stops.entries()) {
    const row = panel.locator(".routeList > li").nth(index);
    const description = row.locator("button p");
    const quote = stop.selectedDrinkPriceEvidence;
    if (!quote) {
      await check(description).toHaveText(`${label} price not recorded`, options);
      await check(row.getByRole("link", { name: "Menu source", exact: true })).toHaveCount(0, options);
      continue;
    }
    await check(description).toContainText(`£${(quote.pence / 100).toFixed(2)}`, options);
    await check(description).toContainText(quote.source === "listed" ? "published menu" : "community report", options);
    const date = new Date(quote.source === "listed" ? quote.observedAt : quote.reportedAt)
      .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    await check(description).toContainText(date, options);
    await check(description).toContainText(quote.serving ? `Serving ${quote.serving}.` : "Serving size not recorded.", options);
    if (quote.source === "listed") {
      await check(row.getByRole("link", { name: "Menu source", exact: true })).toHaveAttribute("href", quote.sourceUrl, options);
    } else {
      await check(row.getByRole("link", { name: "Menu source", exact: true })).toHaveCount(0, options);
    }
  }
}

async function generateRoute(page: Page, info: TestInfo, kind: RouteKind): Promise<GeneratedAuthority> {
  expect((await page.goto(kind === "vodka" ? "/map?plan=1&drink=vodka" : "/map?plan=1"))?.status()).toBe(200);
  await page.getByRole("textbox", { name: "Describe the outing" })
    .fill(kind === "vodka" ? "Vodka in Shoreditch for 2" : "Alcohol-free in Shoreditch for 2");
  if (kind === "zero-proof") {
    const alcoholFree = page.getByRole("group", { name: "Route needs", exact: true })
      .getByRole("button", { name: "Alcohol-free", exact: true });
    await expect(alcoholFree).toHaveAttribute("aria-pressed", "false");
    await alcoholFree.click();
    await expect(alcoholFree).toHaveAttribute("aria-pressed", "true");
  }
  const generation = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans/generate");
  await page.getByRole("button", { name: "Make a plan", exact: true }).click();
  const response = await generation;
  const authority = await response.json() as GeneratedAuthority;
  expect(response.status(), `Real generation prerequisite: ${JSON.stringify(authority)}`).toBe(200);
  expect(authority.grounded).toBe(true);
  expect(authority.inferredContext).toMatchObject({ nightArea: "shoreditch", zeroProof: kind === "zero-proof" });
  if (kind === "vodka") {
    expect(authority.inferredContext.drinkCategory).toBe("vodka");
    const published = authority.stops.filter((stop) => stop.selectedDrinkPriceEvidence?.source === "listed");
    expect(published.length, "Real published primary Vodka quote required before completion sharing").toBeGreaterThan(0);
    for (const stop of authority.stops) {
      if (stop.selectedDrinkPriceEvidence) expect(stop.selectedDrinkPriceEvidence.category).toBe("vodka");
    }
  } else {
    expect(authority.stops.every((stop) => !stop.selectedDrinkPriceEvidence), "Zero-proof must not receive alcoholic selected-price evidence").toBe(true);
  }
  expect(authority.budgetSummary).toMatchObject({
    estimatedPerPersonPence: null, estimatedCrewPence: null, basis: "selected-drink-price-unavailable",
  });
  expect(authority.stops.length).toBeGreaterThanOrEqual(2);
  const ids = authority.stops.map((stop) => stop.venueId);
  expect(new Set(ids).size).toBe(ids.length);
  await info.attach(`real-${kind}-generated-authority`, { contentType: "application/json", body: JSON.stringify(authority, null, 2) });
  await expectGeneratedPresentation(page, authority, kind);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pubmax_built_ids") ?? "null"))).toEqual(ids);
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")?.split(",") ?? []).toEqual(ids);
  return authority;
}

async function openFreshRecipient(browser: Browser, url: string, authority: GeneratedAuthority, kind: RouteKind, info: TestInfo, label: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
    serviceWorkers: "block", storageState: { cookies: [], origins: [] },
  });
  try {
    expect(await context.storageState()).toEqual({ cookies: [], origins: [] });
    const page = await context.newPage();
    await prepareBrowser(page);
    expect((await page.goto(url))?.status()).toBe(200);
    await openRenderedPanel(page);
    await recordState(page, info, label);
    // Soft business checks allow both real completion controls' recipients to
    // be inspected even when the first one exposes the existing relabeling.
    await expectGeneratedPresentation(page, authority, kind, true);
  } finally {
    await context.close();
  }
}

for (const kind of ["vodka", "zero-proof"] as const) {
  for (const edited of [false, true]) {
  test(`${edited ? "edited " : ""}completed generated ${kind === "vodka" ? "Vodka" : "alcohol-free"} route keeps intent through native Copy link and Open shared crawl`, async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    await prepareBrowser(page);
    let authority = await generateRoute(page, info, kind);
    if (edited) {
      const removed = authority.stops.at(-1)!;
      await renderedPanel(page).locator(".routeList > li").last().locator("button").first().click();
      await page.getByRole("button", { name: "Remove from crawl", exact: true }).click();
      authority = { ...authority, stops: authority.stops.slice(0, -1) };
      await expect.poll(() => new URL(page.url()).searchParams.get("pubs")?.split(",") ?? [])
        .toEqual(authority.stops.map((stop) => stop.venueId));
      // Removing a stop keeps its venue sheet open; return along the visible
      // surface trail rather than looking for the map's covered plan control.
      await page.getByRole("button", { name: "Back to Plan an outing", exact: true }).click();
      const editedPanel = await openRenderedPanel(page);
      await expect(editedPanel.locator(".routeList > li")).toHaveCount(authority.stops.length);
      await expect(editedPanel.locator(".routeHeader h2")).toHaveText(`${kind === "vodka" ? "Vodka" : "Alcohol-free"} plan`);
      await expect(editedPanel.locator(".routeMetrics")).toContainText("Not recorded");
      await expect(editedPanel.locator(".routeMetrics")).not.toContainText(/£|estimated round|pint stops/i);
      await expect(editedPanel.locator(".routeList")).not.toContainText(/published menu|community report/);
      await expect(editedPanel.getByRole("link", { name: "Menu source", exact: true })).toHaveCount(0);
      await info.attach(`${kind}-real-route-edit`, { contentType: "application/json", body: JSON.stringify({ removed, currentIds: authority.stops.map((stop) => stop.venueId) }, null, 2) });
    }
    const panel = renderedPanel(page);
    await panel.getByRole("button", { name: "Start this crawl", exact: true }).click();
    await expect(panel.locator(".crawlProgressStatus")).toContainText(`0/${authority.stops.length} stops`);
    await panel.getByRole("button", { name: "Mark complete", exact: true }).click();
    await expect(panel.getByTestId("crawl-celebration")).toBeVisible();
    await expect(panel.locator(".crawlProgressDone")).toContainText(`${authority.stops.length}/${authority.stops.length} stops`);
    await recordState(page, info, `${kind}-after-actual-completion`);

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const copy = panel.getByTestId("crawl-share-copy");
    await copy.click();
    await expect(copy).toHaveText("Link copied");
    const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copiedUrl).searchParams.get("pubs")?.split(",")).toEqual(authority.stops.map((stop) => stop.venueId));
    const open = panel.getByTestId("crawl-share-open");
    const href = await open.getAttribute("href");
    expect(href).not.toBeNull();
    const openedHref = new URL(href!, page.url()).href;
    await open.click();
    await expect(page).toHaveURL((url) => {
      const normalized = new URL(url);
      // Same-map navigation may retain the matching Vodka price lens. Every
      // other URL field and the actual link's ordered route remain exact.
      if (edited && kind === "vodka" && !new URL(openedHref).searchParams.has("drink")
        && normalized.searchParams.getAll("drink").length === 1
        && normalized.searchParams.get("drink") === "vodka") normalized.searchParams.delete("drink");
      return normalized.href === openedHref;
    });
    const openedUrl = page.url();
    expect(new URL(openedUrl).searchParams.get("pubs")?.split(",")).toEqual(authority.stops.map((stop) => stop.venueId));
    await info.attach(`${kind}-actual-completion-share-links`, {
      contentType: "application/json", body: JSON.stringify({ copiedUrl, openedUrl }, null, 2),
    });

    await openFreshRecipient(browser, copiedUrl, authority, kind, info, `${kind}-recipient-from-native-completion-copy`);
    await openFreshRecipient(browser, openedUrl, authority, kind, info, `${kind}-recipient-from-actual-open-shared-crawl`);
  });
  }
}
