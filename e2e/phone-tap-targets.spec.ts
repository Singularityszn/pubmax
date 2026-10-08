import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// A THUMB NEEDS 44 PX, AND A CORAL WORD NEEDS 4.5:1  (13 Sep site audit D12, D13)
//
// The audit measured the source credits on three content routes at 15, 20 and
// 14 px tall on a phone: 12 on /tonight, 24 on /out and 53 on /historic, plus
// a 33 px wide "Back" on /moment. It also read every coral word on /tonight in
// light at 2.9:1. Both are MEASURED here, from the DOM a phone paints, because
// a hit box and a contrast ratio are numbers and an eyeballed shot misses both.
// ─────────────────────────────────────────────────────────────────────────────

const PHONE = { width: 390, height: 844 } as const;
const MIN_HIT = 44;

/** Playwright globs match the full URL, so an /api/out pattern also matches /api/outage. */
function isOutListingsRequest(url: URL): boolean {
  return url.pathname === "/api/out";
}

const LISTED_EVENT = {
  id: "events-tm-playhouse",
  placeName: "Soho Theatre",
  kind: "event",
  startsAt: "2026-08-16T19:00:00.000Z",
  title: "A Night at the Playhouse",
  source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
  observedAt: "2026-08-16T09:00:00.000Z",
  confidence: "listed",
  sourceId: "1",
};

const READY_OUT = {
  status: "ready",
  listingsStatus: "ready",
  events: [
    { ...LISTED_EVENT, venueId: "venue-playhouse" },
    {
      ...LISTED_EVENT,
      id: "events-tm-unmatched",
      sourceId: "2",
      title: "Unmatched Playhouse",
      placeName: "The O2",
    },
  ],
  openPlans: [],
  openPlansStatus: "ready",
  attribution: [],
  observedAt: {},
  providers: [{ name: "ticketmaster", configured: true, rows: 2, status: "ready" }],
  venueMatch: "ready",
} as const;

async function prepare(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-theme", "light");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  // The same quiet night e2e/tonight.spec.ts reads: a keyless build cannot
  // reach the live listings, and this spec is about hit boxes, not supply.
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready", rows: [], servedAt: new Date().toISOString(), observedAt: {} }),
    }),
  );
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(READY_OUT),
    }),
  );
}

type Undersized = { label: string; width: number; height: number };

/**
 * Every visible anchor and button in the page's main content, with a box
 * smaller than a thumb in either direction. A control inside a closed
 * disclosure paints nothing, so it is not measured until it opens.
 */
async function undersizedTargets(page: Page): Promise<Undersized[]> {
  return page.locator("main").evaluate((main, min) => {
    const found: Undersized[] = [];
    for (const element of main.querySelectorAll<HTMLElement>("a[href], button")) {
      if (element.closest("details:not([open])") && !element.matches("summary *")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width >= min && box.height >= min) continue;
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const label = `${element.tagName.toLowerCase()}.${[...element.classList].join(".")} "${
        element.getAttribute("aria-label") ?? text
      }"`;
      found.push({ label, width: Math.round(box.width), height: Math.round(box.height) });
    }
    return found;
  }, MIN_HIT);
}

const ROUTES = [
  {
    path: "/tonight",
    family: ".tonightHypedSource",
    ready: (page: Page) => page.getByTestId("tonight-hyped-row").first(),
  },
  {
    path: "/out",
    family: ".outSourceCredit",
    ready: (page: Page) => page.getByRole("heading", { name: "A Night at the Playhouse" }),
  },
  {
    path: "/historic",
    family: ".historicCite",
    ready: (page: Page) => page.locator(".historicCite").first(),
  },
  {
    path: "/moment",
    family: ".screenSecondary > a",
    ready: (page: Page) => page.getByRole("heading", { name: "Keep this one." }),
  },
] as const;

// A cold production server paints /historic's 342 cited pubs slowly, and axe
// then walks every node of that page. The default 30 s ceiling timed out the
// /historic contrast test on a cold 7-worker run that passes warm in 13 s, and
// the cold hit-box tests took 22 s, so both describes get room.
test.describe("phone tap targets @390", () => {
  test.describe.configure({ timeout: 90_000 });
  for (const route of ROUTES) {
    test(`${route.path}: every anchor and button in main is at least 44 px each way`, async ({
      page,
    }) => {
      await prepare(page);
      await page.goto(route.path);
      await expect(route.ready(page)).toBeVisible({ timeout: 20_000 });
      // The family the audit named has to be ON the page, or an empty page
      // would pass by measuring nothing.
      expect(await page.locator(`main ${route.family}`).count()).toBeGreaterThan(0);
      // /tonight swaps its screen while the listings refresh, and for a moment
      // the outgoing and incoming <main> are both attached. Measure the one
      // that stays, or the strict locator below throws on the swap.
      await expect(page.locator("main")).toHaveCount(1);

      expect(await undersizedTargets(page)).toEqual([]);
    });
  }
});

test.describe("coral words in light @390", () => {
  test.describe.configure({ timeout: 90_000 });
  for (const route of ROUTES.filter((candidate) => candidate.path !== "/moment")) {
    test(`${route.path} has no text below AA contrast`, async ({ page }, testInfo) => {
      await prepare(page);
      await page.goto(route.path);
      await expect(route.ready(page)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");

      const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      await testInfo.attach(`axe color-contrast ${route.path} light`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });
      const offenders = results.violations.flatMap((violation) =>
        violation.nodes.map((node) => `${node.target.join(" ")}: ${node.any[0]?.message ?? ""}`),
      );
      expect(offenders).toEqual([]);
    });
  }
});
