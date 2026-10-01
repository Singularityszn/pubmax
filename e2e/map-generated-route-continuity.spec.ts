import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { SelectedDrinkPriceEvidence } from "../lib/planSelectedDrinkPriceEvidence";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

type GeneratedStop = {
  venueId: string;
  venueName: string;
  selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence | null;
};
type GeneratedAuthority = {
  grounded: boolean;
  inferredContext: { nightArea: string; drinkCategory: string; zeroProof: boolean };
  budgetSummary: {
    estimatedPerPersonPence: number | null;
    estimatedCrewPence: number | null;
    basis: string;
  };
  stops: GeneratedStop[];
};

// Real generate HTTP route, native Reload/Copy link, and untouched application
// route storage. Auth and basemap use existing doubles; no provider login,
// publisher authentication, real-street rendering or portable proof claim.
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

async function renderedNames(page: Page) {
  return renderedPanel(page).locator(".routeList > li > button strong")
    .evaluateAll((elements) => elements.map((element) =>
      Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "").join("").trim(),
    ));
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

async function expectGeneratedPresentation(page: Page, authority: GeneratedAuthority, soft = false) {
  const panel = await openRenderedPanel(page);
  await expect(panel.locator(".routeList > li")).toHaveCount(authority.stops.length);
  await expect.poll(() => renderedNames(page)).toEqual(authority.stops.map((stop) => stop.venueName));
  const check = soft ? expect.soft : expect;
  // The exact stop rows already settled. Bound post-navigation mismatch
  // collection so a real failure cannot spend one full timeout per quote.
  const options = { timeout: soft ? 1_000 : 10_000 };
  await check(panel.locator(".routeHeader h2")).toHaveText("Vodka plan", options);
  const metrics = panel.locator(".routeMetrics");
  await check(metrics).toContainText("Not recorded", options);
  await check(metrics).toContainText("vodka stops", options);
  await check(metrics).not.toContainText(/£|estimated round|\bpint stops?\b/i, options);
  await check(panel.getByRole("radio", { name: "Pint", exact: true })).toHaveCount(0, options);

  // Match each visible public quote to the real response, never a fabricated
  // price, serving or venue fixture. Missing quote remains explicitly unknown.
  for (const [index, stop] of authority.stops.entries()) {
    const row = panel.locator(".routeList > li").nth(index);
    const description = row.locator("button p");
    const evidence = stop.selectedDrinkPriceEvidence;
    if (!evidence) {
      await check(description).toHaveText("Vodka price not recorded", options);
      continue;
    }
    await check(description).toContainText(`£${(evidence.pence / 100).toFixed(2)}`, options);
    await check(description).toContainText(evidence.source === "listed" ? "published menu" : "community report", options);
    const date = new Date(evidence.source === "listed" ? evidence.observedAt : evidence.reportedAt)
      .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    await check(description).toContainText(date, options);
    await check(description).toContainText(evidence.serving ? `Serving ${evidence.serving}.` : "Serving size not recorded.", options);
    if (evidence.source === "listed") {
      await check(row.getByRole("link", { name: "Menu source", exact: true }))
        .toHaveAttribute("href", evidence.sourceUrl, options);
    } else {
      await check(row.getByRole("link", { name: "Menu source", exact: true })).toHaveCount(0, options);
    }
  }
}

async function generateVodka(page: Page, info: TestInfo): Promise<GeneratedAuthority> {
  expect((await page.goto("/map?plan=1&drink=vodka"))?.status()).toBe(200);
  await page.getByRole("textbox", { name: "Describe the outing" }).fill("Vodka in Shoreditch for 2");
  const generation = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/plans/generate",
  );
  await page.getByRole("button", { name: "Make a plan", exact: true }).click();
  const response = await generation;
  const authority = await response.json() as GeneratedAuthority;
  expect(response.status(), JSON.stringify(authority)).toBe(200);
  expect(authority.grounded).toBe(true);
  expect(authority.inferredContext).toMatchObject({ nightArea: "shoreditch", drinkCategory: "vodka", zeroProof: false });
  expect(authority.budgetSummary).toMatchObject({
    estimatedPerPersonPence: null, estimatedCrewPence: null, basis: "selected-drink-price-unavailable",
  });
  expect(authority.stops.length).toBeGreaterThanOrEqual(2);
  expect(new Set(authority.stops.map((stop) => stop.venueId)).size).toBe(authority.stops.length);
  const quoted = authority.stops.filter((stop) => stop.selectedDrinkPriceEvidence);
  expect(quoted.length, "Real primary Vodka quote required before testing continuity").toBeGreaterThan(0);
  for (const stop of quoted) expect(stop.selectedDrinkPriceEvidence?.category).toBe("vodka");
  await info.attach("real-generated-authority", {
    contentType: "application/json", body: JSON.stringify(authority, null, 2),
  });
  await expectGeneratedPresentation(page, authority);
  const ids = authority.stops.map((stop) => stop.venueId);
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("pubmax_built_ids");
    return raw ? JSON.parse(raw) : null;
  })).toEqual(ids);
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")?.split(",") ?? [])
    .toEqual(ids);
  await recordState(page, info, "generated-map-before-continuity-action");
  return authority;
}

test("generated Vodka route reload keeps drink intent, unknown total and attributed quotes", async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepareBrowser(page);
  const authority = await generateVodka(page, info);
  const currentUrl = page.url();
  expect((await page.reload())?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(new URL(currentUrl).pathname);
  await openRenderedPanel(page);
  await recordState(page, info, "generated-map-after-native-reload");
  await expectGeneratedPresentation(page, authority, true);
});

test("copied generated Vodka map link keeps drink intent and attribution in a fresh browser context", async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  await prepareBrowser(page);
  const authority = await generateVodka(page, info);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = renderedPanel(page);
  await panel.getByRole("button", { name: "Copy a shareable link to this crawl", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Copy a shareable link to this crawl", exact: true }))
    .toContainText("Copied");
  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedUrl).toBe(page.url());
  expect(new URL(copiedUrl).searchParams.get("pubs")?.split(","))
    .toEqual(authority.stops.map((stop) => stop.venueId));

  // No route/localStorage/proof metadata transfers into this context. The
  // recipient receives only the link the actual Copy control produced.
  const recipient = await browser.newContext({
    viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
    serviceWorkers: "block", storageState: { cookies: [], origins: [] },
  });
  try {
    const recipientPage = await recipient.newPage();
    await prepareBrowser(recipientPage);
    expect((await recipientPage.goto(copiedUrl))?.status()).toBe(200);
    await openRenderedPanel(recipientPage);
    await recordState(recipientPage, info, "generated-map-after-real-copied-link");
    await expectGeneratedPresentation(recipientPage, authority, true);
  } finally {
    await recipient.close();
  }
});
