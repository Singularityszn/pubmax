import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { sortDescribeFirst } from "./helpers/planDescribeFirst";

// Oracle: a quote belongs to its venue and amount. A saved quote must retain
// its publisher, serving and read date. Incomplete data must remain unknown.
// These fixtures are disposable persisted user data consumed by the real app.
const evidenceDir = process.env.PLAN_PROVENANCE_EVIDENCE_DIR ?? "test-results/plan-pint-provenance";
type GeneratedStop = {
  venueName: string;
  estimatedPintPricePence?: number;
  priceEvidence?: { pence: number; source?: { label: string; url: string; observedAt: string } };
};
const context = {
  nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 4,
  budget: "value", stopCount: 3, atmosphere: [], foodNeeds: [], accessibilityNeeds: [],
  zeroProof: false, drinkCategory: null, budgetLimitPence: 2000,
  transportConstraints: [], wetherspoonsPreferred: false,
};
const quote = (venueId: string, pence: number, label: string, url: string, observedAt = "2026-10-02") => ({
  venueId, pence, serving: "pint", source: { label, url, observedAt },
});
const stop = (venueId: string, venueName: string, pence: number, label: string, path: string) => ({
  venueId, venueName, estimatedPintPricePence: pence, priceKind: "listed",
  pintPriceEvidence: quote(venueId, pence, label, `https://example.org/${path}`), alternatives: [],
});
const validStops = () => [
  { ...stop("venue-xjf3n0", "Arnos Arms", 560, "Arnos menu", "arnos"), key: 1,
    alternatives: [stop("venue-1f5ygjb", "The Bohemia", 520, "Bohemia menu", "bohemia")] },
  { ...stop("venue-3h52h", "The Elephant Inn", 660, "Elephant menu", "elephant"), key: 2 },
];

test.use({ serviceWorkers: "block" });
test.beforeAll(async () => { await mkdir(evidenceDir, { recursive: true }); });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("pubmax-theme")) localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmax-tour-v1-done", "1");
  });
  // No operator accounts or shared services are contacted in this run.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || url.hostname === "localhost"
      ? route.continue() : route.abort();
  });
});
test.afterEach(async ({ page }, info) => {
  const name = info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const imagePath = `${evidenceDir}/${name}.png`;
  await page.screenshot({ path: imagePath, fullPage: true });
  await info.attach("Product screenshot", { path: imagePath, contentType: "image/png" });
  await writeFile(`${evidenceDir}/${name}.txt`, await page.locator("main").innerText());
});

async function restore(page: Page, stops: unknown[]) {
  await page.goto("/plan");
  await page.evaluate(({ stops, context }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:plan-route-draft:v1", JSON.stringify({
      stops, nightContext: context, routeRevision: null, routeStale: false,
    }));
  }, { stops, context });
  await page.reload();
  await expect(page.locator(".planStop__name")).toHaveCount(stops.length);
}

test("real generated prices keep their source links and dates after reload", async ({ page }) => {
  await page.goto("/plan");
  const response = await sortDescribeFirst(page, "Quiet in Clapham for 4");
  const body = await response.json();
  await writeFile(`${evidenceDir}/generated-api-response.json`, JSON.stringify({ status: response.status(), body }, null, 2));
  expect(response.status(), JSON.stringify(body)).toBe(200);
  await expect(page.locator(".planStop__name")).toHaveCount(body.stops.length);
  const listed = (body.stops as GeneratedStop[]).filter((s) => s.priceEvidence?.source?.label && s.priceEvidence?.pence === s.estimatedPintPricePence);
  expect(listed.length).toBeGreaterThan(0);
  for (const s of listed) {
    const source = s.priceEvidence!.source!;
    const card = page.locator(".planStop").filter({ has: page.locator(".planStop__name", { hasText: s.venueName }) });
    await expect(card.getByRole("link", { name: source.label, exact: true })).toHaveAttribute("href", source.url);
    await expect(card.locator("time")).toHaveAttribute("datetime", source.observedAt);
  }
  const captions = await page.locator(".planStop .planComposer__stopReason").allTextContents();
  await page.reload();
  await expect(page.locator(".planStop .planComposer__stopReason")).toHaveText(captions);
});

test("reorder and repeated swaps retain real generated quotes after reload", async ({ page }) => {
  await page.goto("/plan");
  const response = await sortDescribeFirst(page, "Quiet in Clapham for 4");
  const body = await response.json();
  expect(response.status()).toBe(200);
  await expect(page.locator(".planStop__name")).toHaveCount(body.stops.length);
  const originalNames = await page.locator(".planStop__name").allTextContents();
  const first = body.stops[0];
  const source = first.priceEvidence.source;
  await page.locator(".planStop__open").nth(1).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator(".planStop__name")).toHaveText([originalNames[1], originalNames[0], ...originalNames.slice(2)]);
  await page.reload();
  const original = page.locator(".planStop").filter({ has: page.locator(".planStop__name", { hasText: first.venueName }) });
  await expect(original.getByRole("link", { name: source.label })).toHaveAttribute("href", source.url);
  const candidates = [...first.alternatives, first];
  for (const candidate of candidates) {
    await page.locator(".planStop").nth(1).locator(".planStop__swap").click();
    const card = page.locator(".planStop").nth(1);
    await expect(card.locator(".planStop__name")).toHaveText(candidate.venueName);
    if (candidate.priceEvidence?.source) {
      await expect(card.getByRole("link", { name: candidate.priceEvidence.source.label })).toHaveAttribute("href", candidate.priceEvidence.source.url);
      await expect(card.locator("time")).toHaveAttribute("datetime", candidate.priceEvidence.source.observedAt);
    } else {
      await expect(card.locator(".planStop__price")).toHaveCount(0);
    }
    await page.reload();
    await expect(page.locator(".planStop__name").nth(1)).toHaveText(candidate.venueName);
    if (candidate.priceEvidence?.source) {
      const restored = page.locator(".planStop").nth(1);
      await expect(restored.getByRole("link", { name: candidate.priceEvidence.source.label })).toHaveAttribute("href", candidate.priceEvidence.source.url);
      await expect(restored.locator("time")).toHaveAttribute("datetime", candidate.priceEvidence.source.observedAt);
    }
  }
});

test("swapping a saved priced alternative updates its quote and budget subtotal", async ({ page }) => {
  await restore(page, validStops());
  await expect(page.getByTestId("plan-route-summary")).toContainText("£12.20 each for pints");
  await expect(page.locator(".planBudgetLedger")).toContainText("£12.20 for one pint at each stop");
  const arnos = page.locator(".planStop").filter({ hasText: "Arnos Arms" });
  await arnos.locator(".planStop__swap").click();
  const bohemia = page.locator(".planStop").filter({ hasText: "The Bohemia" });
  await expect(bohemia.locator(".planStop__price")).toHaveText("£5.20");
  await expect(bohemia.getByRole("link", { name: "Bohemia menu" })).toHaveAttribute("href", "https://example.org/bohemia");
  await expect(page.locator(".planBudgetLedger")).toContainText("£11.80 for one pint at each stop");
  await page.screenshot({ path: `${evidenceDir}/budget-swapped-quote.png`, fullPage: true });
  await page.locator(".planStop").filter({ hasText: "The Bohemia" }).locator(".planStop__swap").click();
  await expect(page.locator(".planStop").filter({ hasText: "Arnos Arms" }).getByRole("link", { name: "Arnos menu" })).toHaveAttribute("href", "https://example.org/arnos");
  await expect(page.locator(".planBudgetLedger")).toContainText("£12.20 for one pint at each stop");
});

test("legacy prices show unknown publisher and serving without inventing a pint total", async ({ page }) => {
  await restore(page, [{
    key: 1, venueId: "venue-xjf3n0", venueName: "Arnos Arms", alternatives: [],
    estimatedPintPricePence: 560, priceKind: "listed", priceObservedAt: "2026-10-02",
  }]);
  const card = page.locator(".planStop");
  await expect(card).toContainText("Serving size not recorded");
  await expect(card).toContainText("Publisher not recorded");
  await expect(card.locator("time")).toHaveAttribute("datetime", "2026-10-02");
  await expect(page.getByTestId("plan-route-summary")).toContainText("£5.60 each for drinks");
  await expect(page.locator(".planBudgetLedger")).toContainText("£5.60 in listed prices");
  await expect(page.locator(".planBudgetLedger__title")).not.toContainText("one pint a stop");
  await expect(card.locator(".planStop__price")).toHaveAttribute("class", "planStop__price");
});

test("another venue or amount cannot lend its source to a restored price", async ({ page }) => {
  const rows = validStops();
  rows[0].pintPriceEvidence.venueId = "wrong-venue";
  rows[1].pintPriceEvidence.pence = 1;
  await restore(page, rows);
  await expect(page.locator(".planStop__meta")).toHaveText(["Estimated price", "Estimated price"]);
  await expect(page.locator(".planStop time")).toHaveCount(0);
  await expect(page.locator(".planStop").getByRole("link", { name: /menu$/ })).toHaveCount(0);
  await expect(page.getByTestId("plan-route-summary")).toContainText("Estimated £12.20 each for drinks");
  await expect(page.locator(".planBudgetLedger")).toContainText("No total yet");
  await expect(page.locator(".planStop__price")).toHaveClass(["planStop__price", "planStop__price"]);
});

test("unsafe links and invalid dates remain unavailable in restored quotes", async ({ page }) => {
  const rows = validStops();
  rows[0].pintPriceEvidence.source.url = "javascript:alert(1)";
  rows[0].pintPriceEvidence.source.observedAt = "2026-02-30";
  rows[1].pintPriceEvidence.source.observedAt = "2099-01-01";
  await restore(page, rows);
  const card = page.locator(".planStop").first();
  await expect(card).toContainText("Arnos menu · Link unavailable");
  await expect(card).toContainText("Source read date unknown");
  await expect(card.getByRole("link", { name: "Arnos menu" })).toHaveCount(0);
  await expect(page.locator(".planStop time")).toHaveCount(0);
  await expect(page.locator(".planStop").nth(1).getByRole("link", { name: "Elephant menu" })).toHaveAttribute("href", "https://example.org/elephant");
});

test("an unpriced replacement drops the old quote and budget total", async ({ page }) => {
  const rows = validStops().map((row, index) => index === 0 ? {
    ...row, alternatives: [{ venueId: "venue-1f5ygjb", venueName: "The Bohemia" }],
  } : row);
  await restore(page, rows);
  await page.locator(".planStop").first().locator(".planStop__swap").click();
  const card = page.locator(".planStop").first();
  await expect(card.locator(".planStop__name")).toHaveText("The Bohemia");
  await expect(card.locator(".planStop__price")).toHaveCount(0);
  await expect(card).not.toContainText("Arnos menu");
  await expect(page.locator(".planBudgetLedger")).toContainText("No total yet");
  await page.reload();
  await expect(page.locator(".planStop").first().locator(".planStop__price")).toHaveCount(0);
});

test("price credits remain readable on phone and desktop in both themes", async ({ page }) => {
  await restore(page, validStops());
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => localStorage.setItem("pubmax-theme", theme), theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (width === 390) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".planStop__name")).toHaveCount(2);
      const overlaps = await page.locator(".planStop").evaluateAll((cards) => cards.flatMap((card) => {
        const price = card.querySelector(".planStop__price")!.getBoundingClientRect();
        return [...card.querySelectorAll(".planStop__name, .planStop__meta, .planComposer__stopReason")]
          .flatMap((field) => {
            const range = document.createRange();
            range.selectNodeContents(field);
            return [...range.getClientRects()].filter((text) => text.width && text.height &&
              text.left < price.right && price.left < text.right && text.top < price.bottom && price.top < text.bottom)
              .map(() => field.textContent);
          });
      }));
      expect(overlaps).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidenceDir}/credits-${width}-${theme}.png`, fullPage: true });
    }
  }
});
