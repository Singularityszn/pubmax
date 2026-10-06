import { expect, test } from "@playwright/test";

import { MIN_ESTIMATE_SAMPLE } from "@/lib/priceEstimate";
import {
  CONFIRMED_MAX_AGE_DAYS,
  HOW_WE_ESTIMATE_HREF,
  HOW_WE_ESTIMATE_LABEL,
  LISTED_MAX_AGE_DAYS,
  PRICE_STANDINGS,
  priceStandingLabel,
  priceStandingNote,
} from "@/lib/priceTier";

// THE PAGE EVERY "est. £X" POINTS AT, AND THE ALIAS EVERY SPOKEN "sign in"
// LANDS ON. The end-to-end regression of 17 Sep 2026 found these two routes
// with no browser coverage at all: /how-we-estimate is a real content page
// explaining what a modelled price is allowed to claim, named in a source
// sweep by __tests__/priceEstimateAuthorityFence.test.ts but rendered by
// nothing, and /signin is a six-line redirect to /login that nothing proved
// still redirects.
//
// WHAT THIS SPEC OWNS is that the page's numbers are the CODE's numbers. The
// page reads the four standings, the two ages and the sample floor out of
// lib/priceTier.ts and lib/priceEstimate.ts rather than typing them, so this
// spec imports the same modules: a page that starts restating "30 days" in
// prose fails here the day the constant moves, which is the whole reason the
// page was written that way. app/AGENTS.md's privacy-notice rule is the same
// rule one route along - a page describing what the code does changes with it.

const PHONE = { width: 320, height: 844 } as const;

test.describe("/how-we-estimate", () => {
  test("names the four standings, both ages and the sample floor from the code", async ({
    page,
  }) => {
    const response = await page.goto(HOW_WE_ESTIMATE_HREF);
    expect(response?.status()).toBe(200);

    const main = page.locator("main#main");
    await expect(main).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How we estimate");

    // Every standing is on the page under its own shipped label and note, so a
    // standing added to the closed set cannot stay unexplained here.
    for (const standing of PRICE_STANDINGS) {
      await expect(main, `${standing} label`).toContainText(priceStandingLabel(standing));
      await expect(main, `${standing} note`).toContainText(priceStandingNote(standing));
    }

    // The two ages and the sample floor are figures the page must not invent.
    await expect(main).toContainText(`${CONFIRMED_MAX_AGE_DAYS} days`);
    await expect(main).toContainText(`${LISTED_MAX_AGE_DAYS} days`);
    await expect(main).toContainText(`at least ${MIN_ESTIMATE_SAMPLE} published prices`);

    // An estimate says it is one, and says it never reaches a citable lane.
    await expect(main).toContainText("est. £X");
    await expect(main).toContainText("never reaches the Pint Index");
  });

  test("says what it is modelling from today, and says so honestly when it cannot", async ({
    page,
  }) => {
    await page.goto(HOW_WE_ESTIMATE_HREF);

    const section = page.locator("section", { has: page.locator("#today") });
    await expect(section).toBeVisible();
    // Two shapes and no third: the basis answered, with a computed date under
    // it, or the basis could not be read, which is a fault on our side rather
    // than a claim that it is empty. A section that said neither would be the
    // page guessing.
    const body = (await section.innerText()).trim();
    const readBasis = /Basis last computed/.test(body);
    const unreadBasis = /We could not load the estimate data/.test(body);
    expect(
      readBasis !== unreadBasis,
      `the basis section said neither that it was read nor that it could not be: ${body}`,
    ).toBe(true);
    if (readBasis) {
      // A modelled count is a claim about the shipped baselines table, so the
      // page says what it holds rather than that estimates exist.
      expect(body).toMatch(/(chain is|chains are|No chain is) modelled/);
      expect(body).toMatch(/(area is|areas are|No area is) modelled/);
    }
  });

  test("keeps the route on to the Pint Index, which is the strict end of it", async ({ page }) => {
    await page.goto(HOW_WE_ESTIMATE_HREF);

    const pintIndex = page.getByRole("link", { name: "The Pint Index" });
    await expect(pintIndex).toHaveAttribute("href", "/pint-index");
    await pintIndex.click();
    await expect(page).toHaveURL(/\/pint-index$/);
  });

  test(`reads on the narrowest phone with no sideways scroll @${PHONE.width}x${PHONE.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto(HOW_WE_ESTIMATE_HREF);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `the page scrolls sideways: ${overflow.scrollWidth} in ${overflow.clientWidth}`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // The way onward is an INLINE link in a sentence, which takes WCAG 2.5.8's
    // inline exception rather than the 44px floor a standalone control owes, so
    // what is measured is that it is on screen, reachable and owns its own
    // centre: a link under the page's own chrome is the method unreachable
    // again.
    const link = page.getByRole("link", { name: "The Pint Index" });
    // The link sits in the last section, so it is brought on screen before its
    // centre is probed: elementFromPoint answers nothing below the fold.
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
    const ownsCentre = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('a[href="/pint-index"]')),
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );
    expect(ownsCentre).toBe(true);
    await link.focus();
    await expect(link).toBeFocused();
  });

  test("is what the estimate pill's own method link points at", async ({ page }) => {
    // The label and the href are one pair in lib/priceTier.ts, spent by
    // components/ui/trust-pill.tsx beside every modelled figure. What a browser
    // can prove without a modelled pub on screen is that the pair still names
    // a page that answers, so the pill's link can never be a dead end.
    expect(HOW_WE_ESTIMATE_LABEL).toBe("How we estimate");
    const response = await page.goto(HOW_WE_ESTIMATE_HREF);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HOW_WE_ESTIMATE_LABEL);
  });
});

test.describe("/signin", () => {
  test("answers a redirect to /login rather than a document of its own", async ({ page }) => {
    // The alias exists so an old link and a spoken "sign in" land on one page
    // (app/signin/page.tsx). A redirect ON THE SERVER is the whole of it: a
    // rendered alias that bounced in the browser would cost a document nobody
    // keeps, which is the cost app/AGENTS.md's /onboarding rule is about.
    //
    // The alias carries no query onward, and nothing in the tree links to it
    // with one: `?from=` rides /login itself (lib/authRedirect.ts holds both
    // paths as sign-in pages a reader may not be returned to). A caller that
    // ever needs the return path through the alias has to make the redirect
    // carry it, and this is the spec that would go red for it.
    const hop = await page.request.get("/signin", { maxRedirects: 0 });
    expect(hop.status()).toBe(307);
    expect(hop.headers().location).toBe("/login");
  });

  test("lands the reader on /login with the door it submits", async ({ page }) => {
    const response = await page.goto("/signin");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login$/);
    expect(response?.request().redirectedFrom()?.url()).toMatch(/\/signin$/);

    // /login is a FORM SCREEN, so its one painted control is the form's own
    // submit beside the field it submits (components/AGENTS.md).
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const email = page.locator("input[type='email']").first();
    await expect(email).toBeVisible();
    await expect(page.locator("form").filter({ has: email })).toBeVisible();
  });
});
