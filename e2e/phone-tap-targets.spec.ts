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
 * Every visible anchor and button under `scope`, with a hit box smaller than a
 * thumb in either direction. A control inside a closed disclosure paints
 * nothing, so it is not measured until it opens.
 *
 * The hit box is the element's own border box, with ONE exception: a STRETCHED
 * LINK. The shared list row (components/ui/row-list.tsx) makes the whole row
 * one tap target through its title link's `::after`, positioned absolutely at
 * inset 0, so a tap anywhere on the row lands on the link while the <a> box
 * itself is one line of text. For that link alone the measure reads the box
 * the pseudo-element actually covers: the padding box of its containing block
 * (the nearest ancestor that contains an absolute box). Anything short of
 * that exact shape (an inset other than 0 on any side, a pseudo-element that
 * takes no pointer events, paints no content or is not absolute) is measured
 * by its own box as before, and a stretched link inside a small row is still
 * held to the full 44 px (proved by the fixture test at the foot of this file).
 */
function measureUndersized({ scopeSelector, min }: { scopeSelector: string; min: number }): Undersized[] {
  const scope = document.querySelector(scopeSelector);
  if (!scope) throw new Error(`no ${scopeSelector} to measure`);

  const establishesAbsoluteContainingBlock = (element: Element): boolean => {
    const style = getComputedStyle(element);
    return (
      style.position !== "static" ||
      style.transform !== "none" ||
      style.perspective !== "none" ||
      style.filter !== "none" ||
      style.containerType !== "normal" ||
      /\b(layout|paint|strict|content)\b/.test(style.contain) ||
      /\b(transform|perspective|filter)\b/.test(style.willChange)
    );
  };

  /** The rectangle a tap lands on the element in. */
  const hitBox = (element: HTMLElement): { width: number; height: number } => {
    const own = element.getBoundingClientRect();
    if (element.tagName !== "A") return own;
    const after = getComputedStyle(element, "::after");
    const stretched =
      after.content !== "none" &&
      after.content !== "normal" &&
      after.display !== "none" &&
      after.position === "absolute" &&
      after.pointerEvents !== "none" &&
      after.visibility !== "hidden" &&
      [after.top, after.right, after.bottom, after.left].every((side) => side === "0px");
    if (!stretched) return own;
    // The pseudo-element's own parent is the <a>, so the walk starts there: a
    // positioned link contains its own ::after and gains nothing.
    let block: Element | null = element;
    while (block && !establishesAbsoluteContainingBlock(block)) block = block.parentElement;
    if (!block) return { width: window.innerWidth, height: window.innerHeight };
    const rect = block.getBoundingClientRect();
    const style = getComputedStyle(block);
    return {
      width: rect.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
      height: rect.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth),
    };
  };

  const found: Undersized[] = [];
  for (const element of scope.querySelectorAll<HTMLElement>("a[href], button")) {
    if (element.closest("details:not([open])") && !element.matches("summary *")) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const own = element.getBoundingClientRect();
    if (own.width === 0 || own.height === 0) continue;
    const box = hitBox(element);
    if (box.width >= min && box.height >= min) continue;
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    const label = `${element.tagName.toLowerCase()}.${[...element.classList].join(".")} "${
      element.getAttribute("aria-label") ?? text
    }"`;
    found.push({ label, width: Math.round(box.width), height: Math.round(box.height) });
  }
  return found;
}

async function undersizedTargets(page: Page, scopeSelector = "main"): Promise<Undersized[]> {
  return page.evaluate(measureUndersized, { scopeSelector, min: MIN_HIT });
}

const ROUTES = [
  {
    path: "/tonight",
    family: ".tonightHypedSource",
    ready: (page: Page) => page.getByTestId("tonight-hyped-row").first(),
  },
  {
    // /out folded into /tonight (16 Oct 2026): its credits now sit under
    // Tonight's Tomorrow switch, so the test taps it before measuring.
    path: "/tonight",
    name: "/tonight later listings",
    open: (page: Page) =>
      page.getByTestId("tonight-later").getByRole("button", { name: "Tomorrow", exact: true }).click(),
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
] as const satisfies readonly {
  path: string;
  name?: string;
  open?: (page: Page) => Promise<void>;
  family: string;
  ready: (page: Page) => ReturnType<Page["locator"]>;
}[];

// A cold production server paints /historic's 342 cited pubs slowly, and axe
// then walks every node of that page. The default 30 s ceiling timed out the
// /historic contrast test on a cold 7-worker run that passes warm in 13 s, and
// the cold hit-box tests took 22 s, so both describes get room.
test.describe("phone tap targets @390", () => {
  test.describe.configure({ timeout: 90_000 });
  for (const route of ROUTES) {
    test(`${"name" in route ? route.name : route.path}: every anchor and button in main is at least 44 px each way`, async ({
      page,
    }) => {
      await prepare(page);
      await page.goto(route.path);
      if ("open" in route) await route.open(page);
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

for (const width of [320, 390]) {
  test(`compiled row styles keep the full focus and click target with pending feedback at ${width}px`, async ({ page }, testInfo) => {
    await prepare(page);
    await page.setViewportSize({ width, height: PHONE.height });
    await page.goto("/tonight");
    await expect(page.getByRole("button", { name: /Switch to .* theme/i }).first()).toBeEnabled();
    const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).href),
    );
    expect(stylesheets.length).toBeGreaterThan(0);

    // Reuse the app's compiled CSS. The fixture keeps this composition test
    // independent of the server clock that controls Tonight's soft-plan rows.
    // Live route tap targets and Next navigation are tested separately.
    // The fixture is its own same-origin document, never setContent: setContent
    // keeps Tonight's window, so a late React commit wrote Tonight's head into
    // the fixture and moved the row between the two measurements below (CI
    // read the ring 56 px off the row at 320 and 390).
    const fixtureUrl = new URL("/__e2e/compiled-row-fixture", page.url());
    const links = stylesheets
      .map((href) => `<link rel="stylesheet" href="${href.replaceAll('"', "&quot;")}">`)
      .join("");
    await page.route(fixtureUrl.href, (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html data-theme="light"><head>${links}</head><body>
      <main><ul class="rowList"><li class="rowListItem rowListItem--link">
        <span class="rowListBody"><a class="rowListTitle rowListTitleLink navPendingLink" href="#row-destination">
          Row destination<span class="navPendingIndicator" data-pending aria-hidden="true"></span>
        </a></span>
      </li></ul></main>
    </body></html>`,
      }),
    );
    // The stylesheets block the load event, so every rule is in before a read.
    await page.goto(fixtureUrl.href);
    expect(await page.evaluate(() => document.styleSheets.length)).toBe(stylesheets.length);
    const row = page.locator(".rowListItem");
    const link = page.getByRole("link", { name: "Row destination", exact: true });
    await expect(row).toHaveCSS("display", "grid");
    await expect(link.locator(".navPendingIndicator")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();

    const ring = await link.evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineStyle: style.outlineStyle,
      };
    });
    const size = await row.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }));
    expect(ring.outlineWidth).toBeGreaterThan(0);
    expect(ring.outlineStyle).not.toBe("none");
    expect(ring.width).toBeGreaterThanOrEqual(MIN_HIT);
    expect(ring.height).toBeGreaterThanOrEqual(MIN_HIT);
    expect(Math.abs(ring.width - size.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(ring.height - size.height)).toBeLessThanOrEqual(1);

    const rowBox = await row.boundingBox();
    const linkBox = await link.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(linkBox).not.toBeNull();
    // Choose from geometry only. Some layouts have no horizontal padding.
    // Hit testing below verifies the chosen point; it must not select it.
    const rowRight = rowBox!.x + rowBox!.width;
    const rowBottom = rowBox!.y + rowBox!.height;
    const linkRight = linkBox!.x + linkBox!.width;
    const linkBottom = linkBox!.y + linkBox!.height;
    const midX = rowBox!.x + rowBox!.width / 2;
    const midY = rowBox!.y + rowBox!.height / 2;
    const point = [
      { edge: "left", gap: linkBox!.x - rowBox!.x, x: (rowBox!.x + linkBox!.x) / 2, y: midY },
      { edge: "top", gap: linkBox!.y - rowBox!.y, x: midX, y: (rowBox!.y + linkBox!.y) / 2 },
      { edge: "right", gap: rowRight - linkRight, x: (linkRight + rowRight) / 2, y: midY },
      { edge: "bottom", gap: rowBottom - linkBottom, x: midX, y: (linkBottom + rowBottom) / 2 },
    ].find((candidate) => candidate.gap > 2);
    await testInfo.attach("compiled-row-geometry", {
      body: JSON.stringify({ width, row: rowBox, anchor: linkBox, pseudo: ring, rowClient: size, point: point ?? null }, null, 2),
      contentType: "application/json",
    });
    expect(point, "the row must have an edge gap outside its anchor").toBeDefined();
    const { x, y } = point!;
    expect(x).toBeGreaterThan(rowBox!.x);
    expect(x).toBeLessThan(rowRight);
    expect(y).toBeGreaterThan(rowBox!.y);
    expect(y).toBeLessThan(rowBottom);
    expect(x < linkBox!.x || x > linkRight || y < linkBox!.y || y > linkBottom).toBe(true);
    expect(await link.evaluate((element, target) => {
      const hit = document.elementFromPoint(target.x, target.y);
      return hit === element || element.contains(hit);
    }, { x, y })).toBe(true);
    await page.mouse.click(x, y);
    await expect(page).toHaveURL(/#row-destination$/);
  });
}

test.describe("coral words in light @390", () => {
  test.describe.configure({ timeout: 90_000 });
  for (const route of ROUTES.filter((candidate) => candidate.path !== "/moment")) {
    test(`${"name" in route ? route.name : route.path} has no text below AA contrast`, async ({ page }, testInfo) => {
      await prepare(page);
      await page.goto(route.path);
      if ("open" in route) await route.open(page);
      await expect(route.ready(page)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
      if (route.path === "/tonight") {
        for (const name of ["Tomorrow", "Weekend"]) {
          const control = page.getByRole("button", { name, exact: true });
          await expect(control).toBeEnabled();
          await expect(control).toHaveCSS("opacity", "1");
        }
      }

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

// The measure above reads a stretched link at the box its ::after covers. That
// is an exception to a strict rule, so it is proved strict on a fixture: a
// stretched link counts its row only when the row is a thumb tall, and every
// near miss of the stretched shape is still measured by the link's own box.
test("the tap-target measure credits a stretched link with its row, and nothing smaller", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.setContent(`
    <style>
      body { margin: 0; font: 16px/1.3 sans-serif; }
      li { list-style: none; }
      .row { position: relative; width: 300px; padding: 12px 8px; }
      .row--tall { min-height: 56px; box-sizing: border-box; }
      .row--short { height: 30px; box-sizing: border-box; padding: 4px 8px; }
      .stretch::after { content: ""; position: absolute; inset: 0; }
      .inset::after { content: ""; position: absolute; inset: 0 0 0 4px; }
      .inert::after { content: ""; position: absolute; inset: 0; pointer-events: none; }
      .self { position: relative; }
    </style>
    <main>
      <ul>
        <li class="row row--tall"><a class="stretch" href="#tall">Tall row</a></li>
        <li class="row row--short"><a class="stretch" href="#short">Short row</a></li>
        <li class="row row--tall"><a class="stretch self" href="#self">Positioned link</a></li>
        <li class="row row--tall"><a class="inset" href="#inset">Inset row</a></li>
        <li class="row row--tall"><a class="inert" href="#inert">Inert row</a></li>
        <li class="row row--tall"><a href="#plain">Plain link</a></li>
      </ul>
    </main>
  `);

  const labels = (await undersizedTargets(page)).map((target) => target.label);
  // The tall stretched row is a thumb's target: its link is not reported.
  expect(labels.some((label) => label.includes("Tall row"))).toBe(false);
  // A stretched link whose row is 30 px tall still fails, at the row's height.
  const short = (await undersizedTargets(page)).find((target) => target.label.includes("Short row"));
  expect(short, "a stretched link in a 30 px row is undersized").toBeDefined();
  expect(short!.height).toBe(30);
  // Near misses of the stretched shape are measured by the link's own box.
  for (const name of ["Positioned link", "Inset row", "Inert row", "Plain link"]) {
    expect(labels.some((label) => label.includes(name)), `${name} is measured by its own box`).toBe(true);
  }
});
