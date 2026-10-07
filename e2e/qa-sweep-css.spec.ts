import { expect, test, type Page } from "@playwright/test";

import { measureHitArea, resolvedColour } from "./helpers/hitArea";
import { desktopVenueDrawer } from "./helpers/mapSurfaceDrawers";

// The small fixes from the signed-in and signed-out QA sweeps, measured in the
// browser under the shipped stylesheets. The arrival ask beside an open drawer
// needs a painted map, so it is measured in e2e/map-desktop-arrival-chrome.spec.ts. Where a surface needs data a keyless
// build does not have (a crowd reading, a founders wall, a generated plan), the
// check loads the route that owns the stylesheet and measures the same markup
// the component renders, as e2e/message-bubble-geometry.spec.ts does.

const PHONE = { width: 390, height: 844 };
const EM_DASH = String.fromCodePoint(0x2014);
const DESKTOP = { width: 1440, height: 900 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function inject(page: Page, html: string, host = "main"): Promise<void> {
  await page.evaluate(
    ({ html, host }) => {
      const probe = document.createElement("div");
      probe.id = "qa-probe";
      probe.style.padding = "40px 24px";
      probe.innerHTML = html;
      (document.querySelector(host) ?? document.body).prepend(probe);
    },
    { html, host },
  );
}

test.describe("44px hit areas at 390", () => {
  test.use({ viewport: PHONE });

  test("a Report pill keeps its small box and reaches 44px of hit area", async ({ page }) => {
    await page.goto("/founders");
    await inject(page, '<p><button type="button" class="reportBtn">Report</button></p>');
    const area = await measureHitArea(page.locator("#qa-probe .reportBtn"));
    expect(area.boxHeight).toBeLessThan(44);
    expect(area.hitHeight).toBeGreaterThanOrEqual(44);
    expect(area.hitWidth).toBeGreaterThanOrEqual(44);
  });

  test("a Report pill's reach never covers the control above or below it", async ({ page }) => {
    await page.goto("/founders");
    await inject(
      page,
      `<button type="button" id="qa-above" style="display:block;width:100%;height:44px">Above</button>
      <p style="margin:0"><button type="button" class="reportBtn">Report</button></p>
      <button type="button" id="qa-below" style="display:block;width:100%;height:44px">Below</button>`,
    );
    const area = await measureHitArea(page.locator("#qa-probe .reportBtn"));
    expect(area.hitHeight).toBeGreaterThanOrEqual(44);
    const lands = await page.evaluate(() => {
      const pill = document.querySelector("#qa-probe .reportBtn")!.getBoundingClientRect();
      const x = pill.left + pill.width / 2;
      const above = document.getElementById("qa-above")!.getBoundingClientRect();
      const below = document.getElementById("qa-below")!.getBoundingClientRect();
      return [
        document.elementFromPoint(x, above.bottom - 1)?.id,
        document.elementFromPoint(x, below.top + 1)?.id,
      ];
    });
    expect(lands).toEqual(["qa-above", "qa-below"]);
  });

  test("a founders row is one tap target for its handle", async ({ page }) => {
    await page.goto("/founders");
    await inject(
      page,
      `<ol class="foundersList"><li class="foundersRow">
        <span class="foundersNumber" aria-hidden="true">#1</span>
        <span class="foundersAvatar"></span>
        <span class="foundersWho"><a class="foundersHandle" href="/u/early_bird">@early_bird</a></span>
      </li></ol>`,
    );
    const row = page.locator("#qa-probe .foundersRow");
    const landsOnHandle = await row.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const link = el.querySelector(".foundersHandle")!;
      const points: Array<[number, number]> = [
        [box.left + 6, box.top + box.height / 2],
        [box.right - 6, box.top + box.height / 2],
        [box.left + box.width / 2, box.top + 2],
        [box.left + box.width / 2, box.bottom - 2],
      ];
      return points.map(([x, y]) => link.contains(document.elementFromPoint(x, y)));
    });
    expect(landsOnHandle).toEqual([true, true, true, true]);
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("the walking route link is 44px tall and does not push the layout", async ({ page }) => {
    await page.goto("/plan");
    await inject(
      page,
      '<div id="qa-walk-flow" style="display: flow-root"><a class="planRoute__walk" href="/map">See the walking route</a></div>',
      "body",
    );
    const link = page.locator("#qa-probe .planRoute__walk");
    const area = await measureHitArea(link);
    expect(area.boxHeight).toBeGreaterThanOrEqual(44);
    // The padding that makes the tap target is taken back out of the margins,
    // so the link still claims less space in the flow than its own box.
    const flowHeight = (await page.locator("#qa-walk-flow").boundingBox())!.height;
    expect(flowHeight).toBeLessThan(area.boxHeight);
  });
});

test.describe("theme ink", () => {
  test.use({ viewport: PHONE });

  test("the destructive Pal action takes the theme's negative ink", async ({ page }) => {
    await page.goto("/pal");
    await inject(
      page,
      '<button type="button" class="palDanger"><span><strong>Delete Pal</strong></span></button>',
      ".palExperience",
    );
    const ink = await page
      .locator("#qa-probe .palDanger")
      .evaluate((el) => getComputedStyle(el).color);
    expect(ink).toBe(await resolvedColour(page, "#qa-probe", "var(--tint-ink-negative)"));
    expect(ink).not.toBe("rgb(255, 177, 188)");
  });

  test("the photo composer's drink group and share box wear launch styles", async ({ page }) => {
    await page.goto("/ledger/venue-eltcmh");
    await inject(
      page,
      `<fieldset class="venuePhotoComposerField"><legend>Drink</legend></fieldset>
       <label class="venuePhotoComposerShare"><input type="checkbox" checked> Share</label>`,
    );
    const field = await page
      .locator("#qa-probe .venuePhotoComposerField")
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { border: style.borderTopWidth, padding: style.paddingTop };
      });
    expect(field).toEqual({ border: "0px", padding: "0px" });
    const accent = await page
      .locator("#qa-probe .venuePhotoComposerShare input")
      .evaluate((el) => getComputedStyle(el).accentColor);
    expect(accent).toBe(await resolvedColour(page, "#qa-probe", "var(--brass)"));
  });

  test("a profile editor field is filled apart from its panel", async ({ page }) => {
    await page.goto("/u/you");
    await inject(
      page,
      `<div class="profilePage"><div style="background: var(--panel)">
        <form class="profileEditor"><input aria-label="Name"></form>
      </div></div>`,
      "body",
    );
    const fill = await page
      .locator("#qa-probe .profileEditor input")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).toBe(await resolvedColour(page, "#qa-probe", "var(--paper)"));
    // Same check the sweep made by eye: a field the colour of its panel reads flat.
    expect(fill).not.toBe(await resolvedColour(page, "#qa-probe", "var(--panel)"));
  });
});

test.describe("desktop chrome at 1440", () => {
  test.use({ viewport: DESKTOP });

  test("the sign-in notice sits below the nav pill instead of over it", async ({ page }) => {
    await page.goto("/map?_authCallback=1&authError=1");
    const notice = page.locator(".authCallbackNotice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    const nav = page.getByRole("navigation", { name: "Site navigation" });
    await expect(nav).toBeVisible();
    const navBox = (await nav.boundingBox())!;
    const noticeBox = (await notice.boundingBox())!;
    expect(noticeBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height);
  });

  test("the venue drawer's close button has its own disc over the hero photograph", async ({
    page,
  }) => {
    await page.goto("/map?sel=venue-149rmv7");
    const drawer = desktopVenueDrawer(page);
    await expect(drawer).toHaveAttribute("aria-hidden", "false", { timeout: 90_000 });

    const backing = await drawer
      .locator(".mapDrawerHead .surfaceNavHome")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(backing).not.toBe("rgba(0, 0, 0, 0)");
    expect(backing).not.toBe("transparent");
  });
});

test("the offline page speaks in the app's sans face, with no em dash", async ({ page }) => {
  await page.goto("/offline.html");
  const face = await page
    .locator("h1")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(face.startsWith("ui-sans-serif")).toBe(true);
  expect(face).not.toMatch(/Georgia|Times New Roman/);
  expect(await page.locator("body").innerText()).not.toContain(EM_DASH);
  expect(await page.title()).not.toContain(EM_DASH);
});
