import type { Locator, Page } from "@playwright/test";

/**
 * The describe-first field on /plan, addressed by role and name.
 *
 * `getByLabel("Describe the outing")` matches an accessible name by substring.
 * Since #1402 seated the surface on the `Screen` primitive, that also matches
 * the section itself, whose `aria-labelledby` name is "Describe the outing.
 * We’ll put it in order." Two different names, one loose locator, and every
 * caller answered a strict-mode violation. Role plus name keeps the one
 * control the caller means.
 */
export function describeFirstQuery(page: Page): Locator {
  return page.getByRole("textbox", { name: "Describe the outing" });
}

/**
 * The describe-first surface's own painted action.
 *
 * A launch screen has ONE primary (docs/design/LAUNCH_SCREENS.md), and #1402
 * made this one "Sort it". "Make a plan" is the concierge's button inside the
 * composer, which is not mounted until a route, a recovered draft or a held
 * pub makes the composer visible, so it is the wrong control to reach for on a
 * blank /plan.
 */
export function describeFirstSubmit(page: Page): Locator {
  return page.getByRole("button", { name: "Sort it", exact: true });
}
