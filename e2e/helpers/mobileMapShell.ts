import { expect, type Locator, type Page } from "@playwright/test";

import { MAP_CANVAS_READINESS_CEILING_MS } from "@/lib/mapCanvasAvailability";
import { SURFACE_CACHE_NAMESPACE } from "@/lib/surfaceDataCache";

/**
 * Headroom past the product's ceiling. When the canvas never reports in, the
 * shell's own 18s clock starts in a post-hydration effect, after `goto` has
 * already returned, and the fallback still owes a render once it fires, so a
 * wait that ends exactly at the ceiling can expire just before the shell shows.
 */
const MOBILE_MAP_SHELL_SLACK_MS = 5_000;

/**
 * The least a spec may wait for the phone map shell. The shell is held until
 * the map's loading frame lets go (`mobileShellReady` in components/PubMap.tsx),
 * and with a slow or unreachable basemap style that frame lets go only after
 * the 8s style-load timeout and the fallback's answer. The default 10s expect
 * timeout raced that and flaked twice on CI (PR #2104), so the floor is the
 * shell's own readiness ceiling, read from the product rather than retyped,
 * plus the slack above.
 */
const MOBILE_MAP_SHELL_READY_MS =
  MAP_CANVAS_READINESS_CEILING_MS + MOBILE_MAP_SHELL_SLACK_MS;

/** Wait for the shared loading frame before capturing a selected venue. */
export async function expectMapLoadingFrameReleased(page: Page): Promise<void> {
  await expect(page.locator(".mapLoading")).toHaveCount(0, {
    timeout: MOBILE_MAP_SHELL_READY_MS,
  });
}

/**
 * The phone map's top bar is on screen, and with it every control the shell
 * owns (the top bar's buttons and the map-edge column). Wait here, or reach a
 * control through `mobileMapShellControl`, before touching any of them. A
 * longer budget (a throttled perf run) may be passed; a shorter one is raised
 * to the floor.
 */
export async function expectMobileMapShellReady(
  page: Page,
  timeout: number = MOBILE_MAP_SHELL_READY_MS,
): Promise<void> {
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({
    timeout: Math.max(timeout, MOBILE_MAP_SHELL_READY_MS),
  });
}

/**
 * The controls the phone shell owns (components/mobile/MobileMapShell.tsx):
 * the top bar's Search, Filters and More map controls, and the map edge's Near
 * me button and TfL control. TfL is painted on the edge only while a tube line
 * is badly disrupted (`routeTubeStatus(page, "urgent")` below); otherwise its
 * home is the Transit tab of More map controls. Search, Filters, TfL and Near
 * me have namesakes on the desktop toolbar and in sheets, so each is scoped to
 * the shell's own container rather than found by name across the page.
 */
export type MobileMapShellControl = "search" | "filters" | "more" | "tfl" | "nearMe" | "drink";

function shellControlLocator(page: Page, control: MobileMapShellControl): Locator {
  const topbar = page.locator(".mobileMapTopbar");
  switch (control) {
    case "search":
      return topbar.getByRole("button", { name: "Search the map", exact: true });
    case "filters":
      return topbar.locator(".mobileMapFiltersButton");
    case "more":
      return topbar.getByRole("button", { name: "More map controls", exact: true });
    case "tfl":
      return page.locator(".mobileMapUtilityCorner .mobileMapTflButton");
    case "nearMe":
      return page.locator(".mobileMapUtilityCorner .mobileMapLocateFab");
    case "drink":
      return page.locator(".mobileMapChipRow").getByRole("button", { name: /Drink shown on the map/ });
  }
}

/**
 * One of the phone shell's controls, once the shell is on screen. The wait is
 * the shell's, not the control's: a control the product hides (TfL with no
 * feed, Near me while search owns the top) is returned as a locator that
 * resolves to nothing, for the caller to assert on.
 */
export async function mobileMapShellControl(
  page: Page,
  control: MobileMapShellControl,
  timeout?: number,
): Promise<Locator> {
  await expectMobileMapShellReady(page, timeout);
  return shellControlLocator(page, control);
}

/**
 * A deterministic London status feed, so a spec says which TfL state it means
 * rather than inheriting whatever the network answers. "urgent" carries one
 * line with Severe delays (`isUrgentTubeStatus`, lib/mapChromeTiers.ts), which
 * is what puts the TfL control on the phone map edge; "routine" carries only a
 * minor delay and a planned closure, so the resting map shows no TfL control
 * and the feed lives in More map controls, Transit.
 */
export async function routeTubeStatus(page: Page, kind: "urgent" | "routine"): Promise<void> {
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: new Date().toISOString(),
        signals: [],
        tubeLines:
          kind === "urgent"
            ? [
                { line: "Central", status: "Minor delays" },
                { line: "Victoria", status: "Severe delays", disruption: "Signal failure" },
              ]
            : [
                { line: "Central", status: "Minor delays" },
                { line: "Jubilee", status: "Planned closure" },
              ],
      }),
    }),
  );
}

/**
 * Forget the TfL feed the page already read, before a reload that must ask
 * again. The phone map holds its last status answer in session storage
 * (`useMobileTflStatus`, components/mobile/MobileTflPanel.tsx) and reuses it
 * without a network read for `SURFACE_JUST_READ_MS`. A reload inside that
 * window paints the held answer and never asks the route a spec just swapped
 * in, so the new feed is only seen when the reload happens to land late.
 */
export async function forgetHeldTubeStatus(page: Page): Promise<void> {
  await page.evaluate((key) => window.sessionStorage.removeItem(key), `${SURFACE_CACHE_NAMESPACE}/api/citymcp/status`);
}
