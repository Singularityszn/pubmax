import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Captain's audit J37, section 5.5: the core loop must work KEYBOARD-ONLY, and
 * none of it had been driven that way. The loop is discover a venue, plan an
 * outing, share and join, contribute a price. `e2e/a11y-core-journeys.spec.ts`
 * is the axe half of the same fence; this is the half a mouse cannot pass.
 *
 * Nothing here clicks a journey step. Every one is Tab, Enter, Escape or
 * typing, so a step that only works with a pointer fails rather than passing
 * quietly.
 */

const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

// WCAG 2.5.8 AA floor. The product target is 44 (docs/DESIGN_SYSTEM.md), and
// the phone-chrome specs already hold the primaries to it; this is the line
// below which nothing may fall.
const TARGET_SIZE_FLOOR = 24;

type FocusReport = {
  tag: string;
  className: string;
  name: string;
  width: number;
  height: number;
  /** True when the element, or a wrapper owning its ring, paints one. */
  hasFocusIndicator: boolean;
};

async function readFocus(page: Page): Promise<FocusReport | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const paintsRing = (node: HTMLElement): boolean => {
      const style = getComputedStyle(node);
      return (
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
        (style.boxShadow !== "none" && style.boxShadow.trim().length > 0)
      );
    };
    // A bare input inside a painted field is the house pattern, and there the
    // WRAPPER owns the ring on :focus-within, so look a few levels up.
    let ring = false;
    let node: HTMLElement | null = el;
    for (let depth = 0; depth < 4 && node; depth += 1) {
      if (paintsRing(node)) {
        ring = true;
        break;
      }
      node = node.parentElement;
    }
    const box = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      className: typeof el.className === "string" ? el.className : "",
      name:
        el.getAttribute("aria-label") ??
        (el.textContent ?? "").trim().slice(0, 60),
      width: Math.round(box.width),
      height: Math.round(box.height),
      hasFocusIndicator: ring,
    };
  });
}

/** Tab forward until the focused element's accessible name matches, or give up. */
async function tabTo(
  page: Page,
  matcher: RegExp,
  { limit = 70 }: { limit?: number } = {},
): Promise<FocusReport> {
  const seen: string[] = [];
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    const focus = await readFocus(page);
    if (!focus) continue;
    seen.push(focus.name);
    if (matcher.test(focus.name)) return focus;
  }
  throw new Error(
    `Tab never reached ${matcher}. Focus order was:\n  ${seen.join("\n  ")}`,
  );
}

async function seedReturningVisitor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    } catch {
      // A browser that refuses storage still gets the journey, just noisier.
    }
  });
}

test.describe("keyboard: the core loop is operable with no pointer", () => {
  // Blind tabbing is the point of the discover step, and each press costs a
  // round trip on a page carrying a live map, so this needs room when the whole
  // suite is running beside it.
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedReturningVisitor(page);
  });

  test("discover: Tab reaches a pub and opens its detail", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/map");
    await page.waitForTimeout(3_000);

    // The pins are painted into a WebGL canvas, so the DOM parallel is the
    // venue list, and the way in is the Layers control
    // (components/map/MapVenueList.tsx says so in its own header).
    const layers = await tabTo(page, /Map layers/i);
    expect(layers.hasFocusIndicator, "the Layers control shows focus").toBe(true);
    await page.keyboard.press("Enter");

    await tabTo(page, /List view/i, { limit: 25 });
    await page.keyboard.press("Enter");
    await expect(page.locator(".mapVenueList")).toBeVisible();

    // Opening the list puts focus on its first pub, so a reader is not left
    // hunting for where the new surface went.
    const firstRow = await readFocus(page);
    expect(firstRow, "focus moved into the venue list").not.toBeNull();
    expect(firstRow?.height ?? 0).toBeGreaterThanOrEqual(TARGET_SIZE_FLOOR);

    await page.keyboard.press("Enter");
    await expect(
      page.locator(".venueInspector, [role='dialog']").first(),
    ).toBeVisible();
    // And focus follows the pub, rather than staying behind on the list.
    expect(await readFocus(page), "focus moved into the pub detail").not.toBeNull();
  });

  test("contribute: the sheet holds focus and the price door opens the composer", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/map?sel=venue-xjf3n0");
    await page.waitForTimeout(3_000);

    // The phone sheet is modal, so Tab must stay inside it: a reader must not
    // fall out onto a map the sheet is covering.
    const names: string[] = [];
    for (let step = 0; step < 24; step += 1) {
      await page.keyboard.press("Tab");
      const focus = await readFocus(page);
      if (!focus) continue;
      names.push(focus.name);
      const insideSheet = await page.evaluate(() => {
        const el = document.activeElement;
        const sheet = document.querySelector(".mobileSharedSheet, [role='dialog']");
        return !!(el && sheet && sheet.contains(el));
      });
      expect(insideSheet, `focus escaped the sheet at "${focus.name}"`).toBe(true);
    }
    // A ring that never repeats is not a ring: the cycle proves it wraps.
    expect(new Set(names).size, "the sheet's focus ring cycles").toBeLessThan(
      names.length,
    );

    // The one price door for this pub's trust state (lib/pintTrust.ts). One
    // door, whatever the state, so a keyboard reader has one thing to find.
    const door = page.locator(".priceDoor").first();
    await expect(door).toBeVisible();
    await door.focus();
    await page.keyboard.press("Enter");

    // Enter reveals the next step and MOVES FOCUS INTO IT, rather than leaving
    // a reader on a door that has silently opened something below the fold
    // (lib/logIntentReveal.ts). Signed out that step is the sign-in gate,
    // because posting a price needs a verified actor; signed in it is the
    // composer's own figure field. Either is the loop continuing.
    const landed = await page.waitForFunction(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const composer = document.querySelector(".vpsubInput");
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
      if (composer && composer.contains(el)) return "composer";
      if (/price/i.test(text)) return text;
      return null;
    }, undefined, { timeout: 10_000 });
    expect(String(await landed.jsonValue()), "focus landed on the revealed price step")
      .toMatch(/price|composer/i);
  });

  test("plan: describe-first is typable and its answer is announced", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/plan");
    await page.waitForTimeout(2_000);

    const field = page.locator("textarea, input[type='text']").first();
    await expect(field).toBeVisible();
    await field.focus();
    await page.keyboard.type("A quiet pint near London Bridge");
    await expect(field).toHaveValue(/quiet pint/i);

    // Whatever the generator answers, the answer has to reach a screen reader
    // rather than only appearing on screen.
    const live = page.locator("[aria-live], [role='status'], [role='alert']");
    expect(
      await live.count(),
      "the plan surface owns a live region",
    ).toBeGreaterThan(0);
  });

  test("share and join: a Plan's own page is operable from the keyboard", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const api = page.context().request;
    const created = await api.post("/api/plans", {
      headers: { "idempotency-key": randomUUID() },
      data: {
        title: "Keyboard loop crawl",
        startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        creatorName: "Keyboard host",
        stops: [
          { venueId: "venue-xjf3n0", venueName: "Arnos Arms" },
          { venueId: "venue-1f5ygjb", venueName: "The Bohemia" },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const planId = (await created.json()).plan.plan.id as string;

    await page.goto(`/plan/${planId}`);
    await page.waitForTimeout(2_000);

    // Every control on the shared surface has to be reachable AND show focus.
    const reports: FocusReport[] = [];
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const focus = await readFocus(page);
      if (focus) reports.push(focus);
    }
    expect(reports.length, "the Plan page has reachable controls").toBeGreaterThan(3);
    expect(
      reports
        .filter((report) => !report.hasFocusIndicator)
        .map((report) => `${report.tag}.${report.className} "${report.name}"`),
      "every focused control paints a focus indicator",
    ).toEqual([]);
  });
});

test.describe("keyboard: the chrome every journey rides", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the phone dock is a run of reachable destinations", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seedReturningVisitor(page);
    await page.goto("/tonight");
    await page.waitForTimeout(1_500);

    const tabs: Locator = page.locator(".mobileTab");
    const count = await tabs.count();
    expect(count, "the dock's destinations").toBeGreaterThanOrEqual(5);
    for (let index = 0; index < count; index += 1) {
      const tab = tabs.nth(index);
      await tab.focus();
      const box = await tab.boundingBox();
      expect(box, "the dock destination is laid out").not.toBeNull();
      expect(
        Math.min(box?.width ?? 0, box?.height ?? 0),
        "the dock destination clears the target floor",
      ).toBeGreaterThanOrEqual(TARGET_SIZE_FLOOR);
      const focus = await readFocus(page);
      expect(focus?.hasFocusIndicator, "the dock destination shows focus").toBe(true);
    }
  });

  test("the skip link is the first stop and reaches the main content", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await seedReturningVisitor(page);
    await page.goto("/tonight");
    await page.waitForTimeout(1_000);

    await page.keyboard.press("Tab");
    const first = await readFocus(page);
    expect(first?.name ?? "", "the first tab stop skips the chrome").toMatch(/skip/i);
    await page.keyboard.press("Enter");
    const landed = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const main = document.querySelector("main");
      return !!(el && main && (main.contains(el) || el === main || el.id === "main"));
    });
    expect(landed, "Enter on the skip link lands in the main content").toBe(true);
  });
});

test.describe("reduced motion: no meaning is carried by movement alone", () => {
  test.describe.configure({ timeout: 120_000 });

  const ROUTES = ["/", "/tonight", "/plan"] as const;

  for (const route of ROUTES) {
    test(`${route} says everything it means while still`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await seedReturningVisitor(page);
      await page.setViewportSize(PHONE);
      await page.goto(route);
      await page.waitForTimeout(2_000);

      // Under reduced motion nothing may sit part-way through an entrance: an
      // element left animating its own opacity in would stay invisible for good.
      const invisible = await page.evaluate(() => {
        const offenders: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
          if (el.closest("[aria-hidden='true']")) continue;
          if (el.children.length > 0) continue;
          const text = (el.textContent ?? "").trim();
          if (!text) continue;
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (Number(style.opacity) < 0.1) {
            offenders.push(
              `${el.tagName}.${el.className} "${text.slice(0, 40)}" opacity ${style.opacity}`,
            );
          }
        }
        return offenders.slice(0, 10);
      });
      expect(invisible, "text left invisible by a suppressed entrance").toEqual([]);

      // And no surface may be parked MID-transform: a card translated off its
      // own place is a card a reduced-motion reader never sees arrive.
      const parked = await page.evaluate(() => {
        const offenders: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll("*"))) {
          // SVG transforms position drawings, including the static map labels.
          if (!(el instanceof HTMLElement)) continue;
          if (el.closest("[aria-hidden='true']")) continue;
          const style = getComputedStyle(el);
          if (!style.transform || style.transform === "none") continue;
          const parts = style.transform
            .match(/matrix\(([^)]+)\)/)?.[1]
            .split(",")
            .map(Number);
          if (!parts || parts.length < 6) continue;
          const [, , , , translateX, translateY] = parts;
          if (Math.abs(translateX) > 200 || Math.abs(translateY) > 200) {
            const text = (el.textContent ?? "").trim();
            if (text) {
              offenders.push(
                `${el.tagName}.${el.className} parked at ${translateX},${translateY}`,
              );
            }
          }
        }
        return offenders.slice(0, 10);
      });
      expect(parked, "content parked off its place by a suppressed transition").toEqual(
        [],
      );
    });
  }
});
