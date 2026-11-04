import { expect, test, type Page } from "@playwright/test";

import { sortDescribeFirst } from "./helpers/planDescribeFirst";
import { setFirstPintIn } from "./helpers/planFirstPint";
import { getLateFoodForArea } from "../lib/lateFood";

// Night mode owns the whole screen, and nothing may own a tap inside it.
//
// verify-preview-4 RED 2 (5 Sep 2026), measured at 320x568 with the analytics
// consent card unset (every new account): the centre of the lower "Get me
// home" slab (y 490 to 554) was owned by the phone tab bar (514 to 568), and
// the centre of "We are here" by the consent card. Both surfaces pass at 844
// tall, which is the one height the chrome suite swept. The bar now steps
// aside for the surface the way it does for a venue sheet (mobileNav.css) and
// the card waits (app/globals.css); this proves it with elementFromPoint at
// the first-generation SE height and at 390x844.

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";

test.use({ storageState: { cookies: [], origins: [] } });

for (const width of [390, 1440]) {
  for (const ending of ["keep_going", "food", "get_home"] as const) {
  test(`Night ${ending} ending requires explicit confirmation at ${width}px`, async ({ page }, testInfo) => {
    const id = "11111111-1111-4111-8111-111111111111";
    const startTime = new Date().toISOString();
    const plan = { plan: { id, title: "Tonight", startTime, createdAt: startTime, routeRevision: 1, status: "active" }, stops: [{ venueId: "venue-1jbkio1", venueName: "The Landor", position: 1 }], context: { nightArea: "clapham" }, crew: [], actions: [] };
    const food = getLateFoodForArea("clapham", [], { now: Date.parse("2026-07-16T23:00:00.000Z") })[0]!;
    await prepare(page, { width, height: 900 });
    await page.addInitScript(({ id, startTime }) => {
      localStorage.setItem("pubmax_active_plan", JSON.stringify({ version: 1, id, startTime, stopIndex: 0, role: "host" }));
      sessionStorage.setItem(`pubmaxx:night-mode-ending-ready:${id}`, "1");
    }, { id, startTime });
    const completions: unknown[] = [];
    await page.route(`**/api/plans/${id}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/complete")) {
        completions.push(route.request().postDataJSON());
        await route.fulfill({ json: { ...plan, plan: { ...plan.plan, status: "completed" }, ending } });
      } else {
        await route.fulfill({ json: path.endsWith("/session") ? { active: true, role: "host", collaborationAuthorized: true } : { stops: [] } });
      }
    });
    await page.route(`**/api/plans/${id}`, (route) => route.fulfill({ json: plan }));
    await page.route("**/api/late-food**", (route) => route.fulfill({ json: { terminals: [food] } }));
    await page.route("**/data/venues_slim.json**", async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      const rows = (Array.isArray(payload) ? payload : payload.rows).filter((venue: { id: string }) =>
        ["venue-1jbkio1", "venue-12x0p9j"].includes(venue.id),
      );
      expect(rows).toHaveLength(2);
      await route.fulfill({ response, json: Array.isArray(payload) ? rows : { ...payload, rows } });
    });
    await page.goto("/tonight");
    const review = page.locator(`.nightCard .routeEndingCard__choice[data-ending="${ending}"]`);
    await expect(review).toBeVisible();
    expect(completions).toEqual([]);
    await review.click();
    const label = ending === "keep_going" ? "Confirm Keep going to The Stonhouse"
      : ending === "food" ? `Confirm food ending with ${food.name}` : "Confirm Get home ending";
    const confirm = page.getByRole("button", { name: label, exact: true });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(label);
    expect(completions).toEqual([]);
    await confirm.click();
    await expect(page.getByText("Night complete", { exact: false }).first()).toBeVisible();
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ ending, terminalVenueId: "venue-1jbkio1", expectedRouteRevision: 1, endingSelection: { kind: ending, ...(ending === "keep_going" ? { venueId: "venue-12x0p9j" } : ending === "food" ? { optionId: food.id } : {}) } });
    if (ending === "keep_going") await expect(page.getByRole("link", { name: "Open The Stonhouse on the map", exact: true })).toHaveAttribute("href", /sel=venue-12x0p9j/);
    await page.screenshot({ path: testInfo.outputPath(`night-ending-${ending}-${width}.png`) });
  });
  }
}

async function prepare(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((key) => {
    window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    // A first-run reader: the consent card is up.
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
  }, CONSENT_KEY);
}

/** Lock a plan whose first pint is half an hour out, so the night is ON. */
async function lockAPlanOnTonight(page: Page): Promise<void> {
  await page.goto("/plan");
  await sortDescribeFirst(page, "Quiet in Clapham for 4, not pricey");
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set.")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  await setFirstPintIn(page, 30);
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);
}

/** Who owns the centre of `selector`: the element itself, or what covers it. */
async function centreOwner(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing";
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return "nothing";
    if (hit === el || el.contains(hit)) return "self";
    if (hit.closest(".mobileTabBar")) return "tab-bar";
    if (hit.closest(".analyticsConsentPrompt")) return "consent";
    return `${hit.tagName.toLowerCase()}.${[...hit.classList].join(".")}`;
  }, selector);
}

for (const viewport of VIEWPORTS) {
  test(`night mode's every action owns its own centre at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.slow();
    await prepare(page, viewport);
    await lockAPlanOnTonight(page);

    const nightMode = page.getByRole("dialog", { name: "Night mode" });
    await expect(nightMode).toBeVisible();
    await expect(page.locator(".nightCrawl__escape")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`night-mode-${viewport.width}x${viewport.height}.png`) });

    // The surface fills the viewport and nothing of the page's chrome is
    // over its foot: the bar has stepped aside (moved off the screen, the
    // way it does under a venue sheet) and the card waits.
    const tabList = page.locator(".mobileTabList");
    if ((await tabList.count()) > 0) {
      await expect
        .poll(() => tabList.evaluate((el) => el.getBoundingClientRect().top))
        .toBeGreaterThanOrEqual(viewport.height - 0.5);
    }
    await expect(page.getByLabel("Anonymous analytics choice")).toBeHidden();

    for (const selector of [
      ".nightCrawl__exit",
      ".nightCrawl__arrive",
      ".nightCrawl__skip",
      ".nightCrawl__escape",
    ]) {
      await expect(page.locator(selector).first()).toBeVisible();
      expect(await centreOwner(page, selector), `${selector} owns its centre`).toBe("self");
    }
    const escape = await page.locator(".nightCrawl__escape").evaluate((el) => el.getBoundingClientRect().bottom);
    expect(escape).toBeLessThanOrEqual(viewport.height);

    // Leaving the surface gives the reader the bar and the card back.
    await page.getByRole("button", { name: "View full plan" }).click();
    await expect(nightMode).toBeHidden();
    await expect(page.getByLabel("Anonymous analytics choice")).toBeVisible();
    if ((await tabList.count()) > 0) {
      await expect
        .poll(() => tabList.evaluate((el) => el.getBoundingClientRect().bottom))
        .toBeLessThanOrEqual(viewport.height + 0.5);
      const mapTab = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Explore", exact: true });
      await expect(mapTab).toBeVisible();
      expect(
        await mapTab.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit === el || el.contains(hit);
        }),
      ).toBe(true);
    }
  });
}
