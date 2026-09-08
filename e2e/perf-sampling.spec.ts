import { expect, test } from "@playwright/test";

import { PERFORMANCE_BUDGETS, routeNeedsMoreEvidence } from "../lib/performanceBudgets";
import { runPerfRoute } from "./helpers/perfMeasurement";

for (const noisy of [false, true]) {
  test(`stable low samples execute the ${noisy ? "marked" : "ordinary"} route plan`, async ({ page }) => {
    const marked = PERFORMANCE_BUDGETS.routes.find((route) => route.noisy);
    expect(marked).toBeDefined();
    let navigations = 0;
    await page.route("**/surface-state-perf-probe", (route) => {
      navigations += 1;
      return route.fulfill({
        contentType: "text/html",
        body: '<p id="ready">Ready</p>',
      });
    });
    // Only the browser clock is fixed. The production sampling loop still
    // navigates, waits for readiness, drains, and reads each measured sample.
    await page.addInitScript(() => {
      Object.defineProperty(performance, "getEntriesByType", {
        value: (type: string) => type === "navigation"
          ? [{ requestStart: 0, responseStart: 1, loadEventEnd: 1 }]
          : [],
      });
      Object.assign(window, { __pubmaxPerfPaint: { readyAt: 1, lcpMs: 1, cls: 0 } });
    });
    const method = {
      ...PERFORMANCE_BUDGETS.method,
      network: { ...PERFORMANCE_BUDGETS.method.network, quietMs: 0 },
    };
    const route = {
      ...marked!,
      path: "/surface-state-perf-probe",
      readySelector: "#ready",
      settledSelectorHidden: undefined,
      noisy: noisy ? marked!.noisy : undefined,
    };
    const result = await runPerfRoute(page, route, method);
    expect(routeNeedsMoreEvidence(result.samples, route, method, 4)).toBe(false);
    expect(result.samples).toHaveLength(noisy ? 7 : 3);
    expect(navigations).toBe(noisy ? 9 : 4);
    expect(result.aggregate).toMatchObject({ serverRenderMs: 1, requests: 1, jsDecodedKB: 0, lcpMs: 1 });
  });
}
