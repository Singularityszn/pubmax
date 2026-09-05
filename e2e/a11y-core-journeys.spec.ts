import { randomUUID } from "node:crypto";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { runAccessibilityGate } from "./accessibilityGate";

/**
 * Captain's audit J37, section 5.5: the essential journeys must work with a
 * screen reader, and none of that had ever been measured. This spec is the
 * axe half of that fence; `e2e/a11y-keyboard-loop.spec.ts` is the keyboard
 * half.
 *
 * ONE run per (route, width, theme), always under reduced motion, because a
 * violation that only appears in dark or only at 390 is still a reader who
 * cannot use the surface. The gate blocks on serious and critical alone
 * (`runAccessibilityGate`), which is the WCAG-blocking pair; moderate and
 * minor findings are attached to the report rather than failing the build, so
 * the fence stays a floor nobody is tempted to raise past.
 */

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;
const THEMES = ["light", "dark"] as const;
const VIEWPORTS = [PHONE, DESKTOP] as const;

// A curated pub with a price, so the venue sheet opens on a real Overview
// rather than the unknown-selection fallback.
const SELECTED_VENUE_ID = "venue-xjf3n0";

type PlanCreateResponse = {
  memberToken: string;
  plan: { plan: { id: string; startTime: string } };
};

/**
 * The map canvas is a WebGL surface axe cannot inspect and MapLibre owns its
 * own DOM, so the gate reads the app's chrome and excludes the canvas the way
 * the venue-sheet specs do. Everything a reader can operate stays in scope.
 */
const MAP_EXCLUDE = [".maplibregl-canvas-container", ".maplibregl-control-container"];

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  // The surfaces paint their first frame from server HTML, so a short settle
  // is enough for the client islands to mount their live regions and labels.
  await page.waitForTimeout(1_200);
}

async function gateRoute({
  page,
  testInfo,
  path,
  exclude,
  prepare,
}: {
  page: Page;
  testInfo: TestInfo;
  path: string;
  exclude?: string[];
  prepare?: (page: Page) => Promise<void>;
}): Promise<void> {
  // Every combination runs before anything fails, so one report names every
  // surface a reader cannot use rather than the first one measured.
  const failures: string[] = [];
  for (const viewport of VIEWPORTS) {
    // A width change alone does not remount the phone shell: it only mounts
    // when the page BOOTS at phone width, so each width navigates afresh.
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(path);
      await settle(page);
      await prepare?.(page);
      const label = `${path} at ${viewport.width} ${theme}`;
      try {
        await runAccessibilityGate({ page, testInfo, exclude, label });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  expect(failures.join("\n\n"), failures.join("\n\n")).toBe("");
}

test.describe("axe: the core journeys carry no serious or critical violation", () => {
  // Four axe passes plus four navigations per route, on a production build.
  test.describe.configure({ timeout: 180_000 });

  test("discover: the landing answers a stranger", async ({ page }, testInfo) => {
    await gateRoute({ page, testInfo, path: "/" });
  });

  test("discover: the map with a venue selected", async ({ page }, testInfo) => {
    await gateRoute({
      page,
      testInfo,
      path: `/map?sel=${SELECTED_VENUE_ID}`,
      exclude: MAP_EXCLUDE,
      // The sheet arrives on its own reveal sequence, and axe reading a strip
      // mid-settle composites its text against a backdrop no reader ever sees.
      // Measure the settled surface, which is the one a reader gets.
      prepare: async (target) => {
        await target
          .locator(".mobileSharedSheet, .venueInspector")
          .first()
          .waitFor({ state: "visible", timeout: 20_000 });
        await expect(target.locator(".sheet-settling")).toHaveCount(0, {
          timeout: 10_000,
        });
        await target.waitForTimeout(800);
      },
    });
  });

  test("discover: tonight", async ({ page }, testInfo) => {
    await gateRoute({ page, testInfo, path: "/tonight" });
  });

  test("discover: today", async ({ page }, testInfo) => {
    await gateRoute({ page, testInfo, path: "/today" });
  });

  test("plan: the composer opens on describe-first", async ({ page }, testInfo) => {
    await gateRoute({ page, testInfo, path: "/plan" });
  });

  test("contribute: the Moment composer", async ({ page }, testInfo) => {
    await gateRoute({ page, testInfo, path: "/moment" });
  });

  test("account: the viewer's own page", async ({ page }, testInfo) => {
    await gateRoute({ page, testInfo, path: "/u/you" });
  });
});

test.describe("axe: a shared Plan reads for its host and for a guest", () => {
  test.describe.configure({ timeout: 240_000 });

  const stops = [
    { venueId: "venue-xjf3n0", venueName: "Arnos Arms" },
    { venueId: "venue-1f5ygjb", venueName: "The Bohemia" },
    { venueId: "venue-3h52h", venueName: "The Elephant Inn" },
  ];

  async function createPlan(page: Page): Promise<string> {
    // The page's OWN request context, so the HttpOnly member cookie lands on
    // this browser context and the page reads on the host branch.
    const api = page.context().request;
    const created = await api.post("/api/plans", {
      headers: { "idempotency-key": randomUUID() },
      data: {
        title: "Accessibility gate crawl",
        startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        creatorName: "Gate host",
        stops,
      },
    });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as PlanCreateResponse;
    const planId = body.plan.plan.id;
    const ready = await api.patch(`/api/plans/${planId}`, {
      data: {
        memberToken: body.memberToken,
        status: "ready",
        context: {
          nightArea: "clapham",
          daypart: "evening",
          partyType: "friends",
          groupSize: 3,
          budget: "value",
        },
      },
    });
    expect(ready.ok()).toBeTruthy();
    return planId;
  }

  test("as the host", async ({ page }, testInfo) => {
    const planId = await createPlan(page);
    await gateRoute({ page, testInfo, path: `/plan/${planId}` });
  });

  test("as a guest with no seat", async ({ page, browser }, testInfo) => {
    const planId = await createPlan(page);
    // A second, cookie-free context is the uninvited link recipient.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    try {
      await gateRoute({ page: guest, testInfo, path: `/plan/${planId}` });
    } finally {
      await guestContext.close();
    }
  });
});
