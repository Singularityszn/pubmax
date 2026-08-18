/**
 * UX lane 13: LCP, CLS and decoded JS at 390×844 against perf/route-budgets.json.
 * Gated on PUBMAX_PERF_BUDGET (same CI job as e2e/performance-budget.spec.ts).
 * Attaches a markdown table for the PR body; fails only when JS decoded exceeds
 * its budget by more than 10%.
 */
import { expect, test, type Page } from "@playwright/test";

import { PERFORMANCE_BUDGETS } from "../lib/performanceBudgets";

type UxLaneRoute = {
  path: string;
  readySelector: string;
  settledSelectorHidden?: string;
  /** Route path in perf/route-budgets.json used for JS ceiling comparison. */
  budgetPath: string | null;
};

const UX_LANE_ROUTES: UxLaneRoute[] = [
  { path: "/", readySelector: "main", budgetPath: "/" },
  { path: "/near?patch=soho", readySelector: ".nmn", budgetPath: null },
  {
    path: "/map/london",
    readySelector: ".mobileMapTopbar",
    settledSelectorHidden: ".mapLoading",
    budgetPath: "/map",
  },
  { path: "/out", readySelector: "main", budgetPath: "/out" },
];

const REGRESSION_TOLERANCE = 1.1;

async function installPerfObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const gateWindow = window as typeof window & {
      __pubmaxGateMetrics?: { lcp: number; cls: number };
    };
    gateWindow.__pubmaxGateMetrics = { lcp: 0, cls: 0 };

    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries.at(-1);
      if (last) gateWindow.__pubmaxGateMetrics!.lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { hadRecentInput?: boolean; value?: number }
      >) {
        if (!entry.hadRecentInput) {
          gateWindow.__pubmaxGateMetrics!.cls += entry.value ?? 0;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function dismissFirstRunChrome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    performance.setResourceTimingBufferSize(1000);
  });
}

async function loadUxRoute(page: Page, route: UxLaneRoute): Promise<number> {
  await page.goto(route.path, { waitUntil: "load" });
  await expect(page.locator(route.readySelector).first()).toBeVisible({
    timeout: 45_000,
  });
  if (route.settledSelectorHidden) {
    await expect(page.locator(route.settledSelectorHidden)).toBeHidden({
      timeout: 45_000,
    });
  }
  await page.waitForTimeout(100);
  return page.evaluate(() => performance.now());
}

async function readUxMetrics(
  page: Page,
  interactiveAt: number,
): Promise<{ lcp: number; cls: number; jsDecodedKB: number }> {
  return page.evaluate((boundary) => {
    const gateWindow = window as typeof window & {
      __pubmaxGateMetrics?: { lcp: number; cls: number };
    };
    const metrics = gateWindow.__pubmaxGateMetrics ?? { lcp: 0, cls: 0 };
    const origin = location.origin;
    let jsBytes = 0;
    for (const entry of performance.getEntriesByType("resource")) {
      const resource = entry as PerformanceResourceTiming;
      if (!resource.name.startsWith(origin)) continue;
      if (resource.startTime > boundary) continue;
      const isJs =
        resource.initiatorType === "script" || /\.js(\?|$)/.test(resource.name);
      if (isJs) jsBytes += resource.decodedBodySize || 0;
    }
    return {
      lcp: metrics.lcp,
      cls: metrics.cls,
      jsDecodedKB: Math.round(jsBytes / 1024),
    };
  }, interactiveAt);
}

function budgetForPath(path: string | null): number | null {
  if (!path) return null;
  const route = PERFORMANCE_BUDGETS.routes.find((entry) => entry.path === path);
  return route?.jsDecodedKB ?? null;
}

test("UX lane routes report LCP, CLS and JS decoded against route budgets", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.PUBMAX_PERF_BUDGET, "Owned by the performance-budget CI job.");
  test.setTimeout(240_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await dismissFirstRunChrome(page);
  await installPerfObservers(page);

  const rows: string[] = [];
  const regressions: string[] = [];

  for (const route of UX_LANE_ROUTES) {
    const interactiveAt = await loadUxRoute(page, route);
    const { lcp, cls, jsDecodedKB } = await readUxMetrics(page, interactiveAt);
    const budgetKb = budgetForPath(route.budgetPath);
    const overPct =
      budgetKb !== null && jsDecodedKB > budgetKb
        ? Math.round(((jsDecodedKB - budgetKb) / budgetKb) * 100)
        : null;

    if (budgetKb !== null && jsDecodedKB > budgetKb * REGRESSION_TOLERANCE) {
      regressions.push(
        `${route.path}: JS decoded ${jsDecodedKB} KB > budget ${budgetKb} KB (+${overPct}%)`,
      );
    }

    rows.push(
      `| ${route.path} | ${Math.round(lcp)} | ${cls.toFixed(3)} | ${jsDecodedKB} | ${
        budgetKb ?? "n/a"
      } | ${overPct !== null ? `+${overPct}%` : "n/a"} |`,
    );
  }

  const markdown = [
    "## UX lane 13 performance (390×844, production build)",
    "",
    "| route | LCP (ms) | CLS | JS decoded (KB) | budget (KB) | over budget |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    "LCP and CLS are reported for the PR; JS decoded is compared to perf/route-budgets.json.",
  ].join("\n");

  await testInfo.attach("ux-lane-13-perf.md", {
    body: markdown,
    contentType: "text/markdown",
  });

  expect(regressions, markdown).toEqual([]);
});
