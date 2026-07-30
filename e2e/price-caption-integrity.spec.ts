import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const DEAL_QUALIFIER =
  "Two pints for £12 before 7pm on Thursdays. Booking excludes match nights, bank holidays, and the terrace.";

type CaptionCase = {
  name: string;
  cssPath: string;
  selector: string;
  expected: string;
  markup: string;
  checkNextSibling?: boolean;
  checkNoOverlapSelector?: string;
  growingContainerSelector?: string;
  visibleAtPhone?: boolean;
};

const CAPTION_CASES: CaptionCase[] = [
  {
    name: "deal conditions",
    cssPath: "components/discovery/dealsTonightLane.css",
    selector: ".dealsTonightDetail",
    expected: DEAL_QUALIFIER,
    markup: `
      <section class="dealsTonight">
        <a class="dealsTonightCard" href="/map?sel=venue-xjf3n0">
          <div class="dealsTonightCardHead"><strong>Early round offer</strong></div>
          <span class="dealsTonightPlace">Arnos Arms, Arnos Grove</span>
          <span class="dealsTonightDetail">${DEAL_QUALIFIER}</span>
          <span class="dealsTonightSource">Venue listing · sourced</span>
        </a>
      </section>
    `,
    checkNextSibling: true,
  },
  {
    name: "city status",
    cssPath: "components/map/cityStatusBanner.css",
    selector: ".cityStatusBannerCopy",
    expected: "Central line suspended between White City and Ealing Broadway until the last train.",
    markup: `
      <div class="cityStatusBanner" data-severity="major">
        <span class="cityStatusBannerLink">
          <span class="cityStatusBannerCopy">Central line suspended between White City and Ealing Broadway until the last train.</span>
          <span class="cityStatusBannerMobileCopy">TfL live · 1</span>
        </span>
        <button class="cityStatusBannerDismiss">Close</button>
      </div>
    `,
    visibleAtPhone: false,
  },
  {
    name: "location condition",
    cssPath: "components/map/citySuggestBanner.css",
    selector: ".citySuggestBannerCopy",
    expected: "You appear to be near Manchester. Switch maps only if that is where tonight starts.",
    markup: `
      <div class="citySuggestBanner">
        <p class="citySuggestBannerCopy">You appear to be near Manchester. Switch maps only if that is where tonight starts.</p>
        <button class="citySuggestBannerSwitch">Switch</button>
      </div>
    `,
    visibleAtPhone: false,
  },
  {
    name: "search recovery status",
    cssPath: "components/map/mapToolbar.css",
    selector: ".mapToolbarSearchStatusCopy",
    expected: "Search is unavailable right now. Existing pubs remain on the map while it reconnects.",
    markup: `
      <div class="mapToolbar">
        <div class="mapToolbarSearchStatus">
          <span class="mapToolbarSearchStatusCopy">Search is unavailable right now. Existing pubs remain on the map while it reconnects.</span>
          <button class="mapToolbarSearchRecovery">Retry</button>
        </div>
      </div>
    `,
  },
  {
    name: "search price provenance",
    cssPath: "components/map/mapSearchSuggest.css",
    selector: ".mapSearchSuggestPriceProvenance",
    expected: "Observed 30 July · Community report",
    markup: `
      <div class="mapSearchSuggestRow">
        <span class="mapSearchSuggestRowMain"><span class="mapSearchSuggestRowName">Arnos Arms</span></span>
        <span class="mapSearchSuggestPrice">
          <span>Beer · £5.60</span>
          <small class="mapSearchSuggestPriceProvenance">Observed 30 July · Community report</small>
        </span>
      </div>
    `,
  },
  {
    name: "list price provenance",
    cssPath: "components/map/mapVenueList.css",
    selector: ".mapVenueListPriceProvenance",
    expected: "Observed 30 July · Community report",
    markup: `
      <div class="mapVenueListPanel">
        <button class="mapVenueListItem">
          <span class="mapVenueListItemName">Arnos Arms</span>
          <span class="mapVenueListItemMeta">
            <span class="mapVenueListCompactPrice">
              <span>Beer · £5.60</span>
              <small class="mapVenueListPriceProvenance">Observed 30 July · Community report</small>
            </span>
          </span>
        </button>
      </div>
    `,
  },
  {
    name: "tonight listing conditions",
    cssPath: "components/map/tonightLane.css",
    selector: ".tonightLaneCardTitle",
    expected: "Two pints for £12 before 7pm, except bank holidays and match nights.",
    markup: `
      <article class="tonightLaneCard">
        <p class="tonightLaneCardTitle">Two pints for £12 before 7pm, except bank holidays and match nights.</p>
        <p class="tonightLaneCardSource">via Venue listing checked 30 July</p>
      </article>
    `,
  },
  {
    name: "tonight source",
    cssPath: "components/map/tonightLane.css",
    selector: ".tonightLaneCardSource",
    expected: "via Venue listing checked 30 July",
    markup: `
      <article class="tonightLaneCard">
        <p class="tonightLaneCardTitle">Early round offer</p>
        <p class="tonightLaneCardSource">via Venue listing checked 30 July</p>
      </article>
    `,
  },
  {
    name: "tonight freshness",
    cssPath: "components/map/tonightLane.css",
    selector: ".tonightLaneCollapsedChecked",
    expected: "Checked 30 July from listed sources",
    markup: `
      <div class="tonightLaneCollapsed">
        <button class="tonightLaneCollapsedMain">
          <span class="tonightLaneCollapsedTitle">On tonight · 12</span>
          <span class="tonightLaneCollapsedChecked">Checked 30 July from listed sources</span>
        </button>
        <button class="tonightLaneOverlayToggle">Map</button>
      </div>
    `,
    checkNoOverlapSelector: ".tonightLaneOverlayToggle",
    growingContainerSelector: ".tonightLaneCollapsedMain",
  },
  {
    name: "tonight expanded freshness",
    cssPath: "components/map/tonightLane.css",
    selector: ".tonightLaneChecked",
    expected: "Checked 30 July from listed sources",
    markup: `
      <section class="tonightLane tonightLane--open tonightLane--sheet">
        <div class="tonightLaneHead">
          <div class="tonightLaneTitleRow">
            <div class="tonightLaneTitleMeta">
              <h2 class="tonightLaneTitle">On tonight</h2>
              <span class="tonightLaneChecked">Checked 30 July from listed sources</span>
            </div>
            <button class="tonightLaneClose">Close</button>
          </div>
        </div>
      </section>
    `,
    checkNoOverlapSelector: ".tonightLaneClose",
  },
  {
    name: "featured story claim",
    cssPath: "app/globals.css",
    selector: ".mapHeroCard p",
    expected: "The listed interior dates from 1898, while the current bar layout was recorded in a later survey.",
    markup: `
      <aside class="mapHeroCard">
        <strong>Featured pub</strong>
        <p>The listed interior dates from 1898, while the current bar layout was recorded in a later survey.</p>
      </aside>
    `,
    visibleAtPhone: false,
  },
  {
    name: "place story condition",
    cssPath: "app/globals.css",
    selector: ".bandOnboardingChip span",
    expected:
      "The riverside route uses listed venues only. Opening hours still vary, so check each pub before setting off.",
    markup: `
      <div class="bandOnboardingChip">
        <div>
          <strong>Riverside story</strong>
          <span>The riverside route uses listed venues only. Opening hours still vary, so check each pub before setting off.</span>
        </div>
        <button>Walk this story</button>
      </div>
    `,
  },
  {
    name: "historic source claim",
    cssPath: "app/historic/historic.css",
    selector: ".historicHook",
    expected:
      "The listed interior dates from 1898, while the present bar arrangement was recorded during a later survey and may have changed since.",
    markup: `
      <article>
        <p class="historicHook">The listed interior dates from 1898, while the present bar arrangement was recorded during a later survey and may have changed since.</p>
        <div class="historicProvenance">Historic England · checked 30 July</div>
      </article>
    `,
    checkNextSibling: true,
  },
  {
    name: "borough heritage claim",
    cssPath: "app/borough/[slug]/borough.css",
    selector: ".boroughHeritageHook",
    expected:
      "The tiled frontage was recorded in the 1980 survey, but the source does not establish whether the interior remains unchanged.",
    markup: `
      <article>
        <p class="boroughHeritageHook">The tiled frontage was recorded in the 1980 survey, but the source does not establish whether the interior remains unchanged.</p>
        <a class="boroughHeritageMapLink">Read cited record</a>
      </article>
    `,
    checkNextSibling: true,
  },
  {
    name: "quiet pint heritage claim",
    cssPath: "app/today/today.css",
    selector: ".quietPintHeritage",
    expected:
      "The listed fittings date from 1902. Opening hours and present-day access are not established by the historic source.",
    markup: `
      <article>
        <p class="quietPintHeritage">The listed fittings date from 1902. Opening hours and present-day access are not established by the historic source.</p>
        <div class="quietPintFoot">Historic England</div>
      </article>
    `,
    checkNextSibling: true,
  },
];

async function prepareCaptionCase(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  captionCase: CaptionCase,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const css = readFileSync(captionCase.cssPath, "utf8");
  await page.setContent(`
    <style>
      :root {
        --ink: #24221f;
        --ink-soft: #67625b;
        --line: #d8d0c7;
        --brass: #b04b31;
        --panel-raised: #fffaf4;
      }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; }
      ${css}
    </style>
    <main>${captionCase.markup}</main>
  `);
}

async function expectUnclippedCaption(locator: Locator, expected: string): Promise<void> {
  await expect(locator).toHaveText(expected);
  const state = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      text: element.textContent,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      lineClamp: style.getPropertyValue("-webkit-line-clamp"),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });

  expect(state.text).toBe(expected);
  expect(state.textOverflow).not.toBe("ellipsis");
  expect(state.whiteSpace).not.toBe("nowrap");
  expect(state.lineClamp).toBe("none");
  expect(state.clientHeight).toBe(state.scrollHeight);
}

for (const viewport of VIEWPORTS) {
  for (const captionCase of CAPTION_CASES) {
    test(`${captionCase.name} stays readable at ${viewport.width}px`, async ({ page }) => {
      await prepareCaptionCase(page, viewport, captionCase);

      const qualifier = page.locator(captionCase.selector);
      if (captionCase.visibleAtPhone !== false) {
        await expect(qualifier).toBeVisible();
      }
      await expectUnclippedCaption(qualifier, captionCase.expected);

      if (captionCase.checkNextSibling) {
        const qualifierBox = await qualifier.boundingBox();
        const next = qualifier.locator("xpath=following-sibling::*[1]");
        await expect(next).toBeVisible();
        const nextBox = await next.boundingBox();
        expect(qualifierBox).not.toBeNull();
        expect(nextBox).not.toBeNull();
        expect(nextBox!.y).toBeGreaterThanOrEqual(qualifierBox!.y + qualifierBox!.height);
      }

      if (captionCase.checkNoOverlapSelector) {
        const qualifierBox = await qualifier.boundingBox();
        const peer = page.locator(captionCase.checkNoOverlapSelector);
        await expect(peer).toBeVisible();
        const peerBox = await peer.boundingBox();
        expect(qualifierBox).not.toBeNull();
        expect(peerBox).not.toBeNull();
        const overlaps =
          qualifierBox!.x < peerBox!.x + peerBox!.width &&
          qualifierBox!.x + qualifierBox!.width > peerBox!.x &&
          qualifierBox!.y < peerBox!.y + peerBox!.height &&
          qualifierBox!.y + qualifierBox!.height > peerBox!.y;
        expect(overlaps).toBe(false);
      }

      if (captionCase.growingContainerSelector) {
        const container = page.locator(captionCase.growingContainerSelector);
        const containerBox = await container.boundingBox();
        const qualifierBox = await qualifier.boundingBox();
        expect(containerBox).not.toBeNull();
        expect(qualifierBox).not.toBeNull();
        expect(containerBox!.height).toBeGreaterThanOrEqual(44);
        if (viewport.width === 390) {
          expect(containerBox!.height).toBeGreaterThan(44);
        }
        expect(qualifierBox!.y).toBeGreaterThanOrEqual(containerBox!.y);
        expect(qualifierBox!.y + qualifierBox!.height).toBeLessThanOrEqual(
          containerBox!.y + containerBox!.height,
        );
      }

      const documentOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(documentOverflow).toBeLessThanOrEqual(1);
    });
  }
}
