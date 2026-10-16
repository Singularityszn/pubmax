import { expect, type Page } from "@playwright/test";

import { MAP_CANVAS_READINESS_CEILING_MS } from "@/lib/mapCanvasAvailability";

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
export const MOBILE_MAP_SHELL_READY_MS =
  MAP_CANVAS_READINESS_CEILING_MS + MOBILE_MAP_SHELL_SLACK_MS;

/**
 * The phone map's top bar is on screen, and with it every control the shell
 * owns (More map controls, Filters, the TfL chip, the map-edge column). Wait
 * here before touching any of them. A longer budget (a throttled perf run) may
 * be passed; a shorter one is raised to the floor.
 */
export async function expectMobileMapShellReady(
  page: Page,
  timeout: number = MOBILE_MAP_SHELL_READY_MS,
): Promise<void> {
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({
    timeout: Math.max(timeout, MOBILE_MAP_SHELL_READY_MS),
  });
}
