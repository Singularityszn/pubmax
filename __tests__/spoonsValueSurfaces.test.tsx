import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SpoonsValueLensControl from "@/components/map/SpoonsValueLensControl";
import SpoonsValueTable from "@/app/spoons-value/SpoonsValueTable";
import { metadata } from "@/app/spoons-value/page";
import {
  SPOONS_VALUE_LENS_OFF,
  SPOONS_VALUE_MAP_HREF,
  SPOONS_VALUE_RESPONSIBLE_LINE,
  spoonsValueCuts,
  spoonsValueLensRequested,
  spoonsValueMapHref,
  type SpoonsValueTableRow,
} from "@/lib/spoonsValue";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

function renderLens(props: Parameters<typeof SpoonsValueLensControl>[0]) {
  return renderToStaticMarkup(createElement(SpoonsValueLensControl, props));
}

describe("the lens control", () => {
  it("is off by default and offers the ranking either way", () => {
    const html = renderLens({
      on: false,
      state: SPOONS_VALUE_LENS_OFF,
      onChange: vi.fn(),
    });
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Spoons value");
    expect(html).toContain("/spoons-value");
    // Nothing is claimed about the map while the lens is off.
    expect(html).not.toContain("More than most");
  });

  it("prints the number each band was cut at, not only the colours", () => {
    const html = renderLens({
      on: true,
      state: { status: "ready", modalMilliunits: 12_785 },
      onChange: vi.fn(),
    });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("More than most");
    expect(html).toContain("More than 12.8");
    expect(html).toContain("priceBand-cheap");
    expect(html).toContain("priceBand-expensive");
    expect(html).toContain("Most pubs pour 12.8");
  });

  it("says what it is for, and never pushes anybody to drink more", () => {
    const html = renderLens({
      on: true,
      state: { status: "ready", modalMilliunits: 12_785 },
      onChange: vi.fn(),
    });
    expect(html).toContain(SPOONS_VALUE_RESPONSIBLE_LINE);
    expect(SPOONS_VALUE_RESPONSIBLE_LINE).toMatch(/not what to drink/i);
  });

  it("tells a read it could not run apart from a country with nothing in it", () => {
    const failed = renderLens({
      on: true,
      state: { status: "unavailable", modalMilliunits: null },
      onChange: vi.fn(),
    });
    const empty = renderLens({
      on: true,
      state: { status: "empty", modalMilliunits: null },
      onChange: vi.fn(),
    });
    expect(failed).toContain("would not load");
    expect(empty).toContain("Nothing is ranked here yet");
    expect(failed).not.toContain("Nothing is ranked here yet");
  });

  it("waits rather than claiming an empty map while the lane is still reading", () => {
    const html = renderLens({
      on: true,
      state: { status: "loading", modalMilliunits: null },
      onChange: vi.fn(),
    });
    expect(html).toContain("Reading the ranking");
    expect(html).not.toContain("Nothing is ranked here yet");
  });
});

describe("the ranking table", () => {
  const rows: SpoonsValueTableRow[] = [
    {
      id: "1",
      rank: 1,
      name: "The Best Value",
      town: "Teignmouth",
      county: "Devon",
      country: "England",
      airport: false,
      londonZ12: false,
      milliunits: 15_739,
      pence: 996,
      round: "3 pints of Sandford Orchards The General",
      venueId: "venue-uk-n1",
    },
    {
      id: "2",
      rank: 805,
      name: "The Airport One",
      town: "Alicante",
      county: "Alicante",
      country: "England",
      airport: true,
      londonZ12: false,
      milliunits: 4_057,
      pence: 999,
      round: "2 pints of something dear",
      venueId: null,
    },
  ];

  it("links a pub the map can place and leaves the rest as plain text", () => {
    const html = renderToStaticMarkup(
      createElement(SpoonsValueTable, {
        rows,
        cuts: spoonsValueCuts(rows),
        modalMilliunits: 12_785,
      }),
    );
    expect(html).toContain('href="/map?sel=venue-uk-n1&amp;lens=spoons"');
    expect(html).toContain("The Airport One");
    expect(html).not.toContain('href="/map?sel=null"');
  });

  // Astra's live walk (7 Sep 2026, finding B5a): every door off this page landed
  // on the ordinary pint map. The page is entirely about the units lens and
  // nothing on it could switch the lens on.
  it("carries the units lens through every door onto the map", () => {
    expect(spoonsValueMapHref(defined(rows[0]))).toBe("/map?sel=venue-uk-n1&lens=spoons");
    expect(spoonsValueMapHref(defined(rows[1]))).toBeNull();
    expect(SPOONS_VALUE_MAP_HREF).toBe("/map?lens=spoons");

    for (const href of [SPOONS_VALUE_MAP_HREF, spoonsValueMapHref(defined(rows[0])) ?? ""]) {
      expect(spoonsValueLensRequested(new URL(href, "https://x").search)).toBe(true);
    }
  });

  it("reads the lens off an arrival, and only when it is asked for", () => {
    expect(spoonsValueLensRequested("?lens=spoons")).toBe(true);
    expect(spoonsValueLensRequested("?sel=venue-uk-n1&lens=spoons")).toBe(true);
    expect(spoonsValueLensRequested("")).toBe(false);
    expect(spoonsValueLensRequested("?sel=venue-uk-n1")).toBe(false);
    expect(spoonsValueLensRequested("?lens=no-alcohol")).toBe(false);
  });

  it("is the page's own primary door", () => {
    const page = readFileSync(join(ROOT, "app/spoons-value/page.tsx"), "utf8");
    expect(page).toContain("SPOONS_VALUE_MAP_HREF");
    expect(page).not.toMatch(/href="\/map"/);
  });

  it("prints every figure with its unit and its round beside it", () => {
    const html = renderToStaticMarkup(
      createElement(SpoonsValueTable, {
        rows,
        cuts: spoonsValueCuts(rows),
        modalMilliunits: 12_785,
      }),
    );
    expect(html).toContain("15.7 units");
    expect(html).toContain("£9.96");
    expect(html).toContain("3 pints of Sandford Orchards The General");
  });

  it("says a rank does not move when a reader narrows the list", () => {
    const html = renderToStaticMarkup(
      createElement(SpoonsValueTable, {
        rows,
        cuts: spoonsValueCuts(rows),
        modalMilliunits: 12_785,
      }),
    );
    expect(html).toContain("Rank is national");
  });
});

describe("the ranking page", () => {
  it("is canonical, has its own card, and never says most drunk", () => {
    expect(metadata.alternates?.canonical).toBe("/spoons-value");
    expect(metadata.openGraph?.title).toBe("What a tenner buys in a Wetherspoon");
    expect(metadata.twitter).toBeTruthy();
    const copy = `${metadata.title} ${metadata.description} ${metadata.openGraph?.title}`;
    expect(copy).not.toMatch(/most drunk|get you drunk|hammered|smashed/i);
  });

  it("carries no copy that makes getting drunk the goal", () => {
    // The source report's own headline does. Ours may not: the figure is what
    // a tenner buys, and every surface says it that way.
    //
    // COMMENTS ARE NOT COPY, the same allowance the em-dash law makes: a note
    // explaining why a phrase is banned is not the phrase reaching a reader.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    for (const file of [
      "app/spoons-value/page.tsx",
      "app/spoons-value/SpoonsValueTable.tsx",
      "components/map/SpoonsValueLensControl.tsx",
      "components/map/inspector/VenueSpoonsValueRow.tsx",
      "lib/spoonsValue.ts",
    ]) {
      const source = stripComments(readFileSync(join(ROOT, file), "utf8"));
      expect(source, file).not.toMatch(/most drunk|get you drunk|drink more|hammered/i);
    }
  });

  it("credits the author rather than repeating the source's own headline", () => {
    // The report is titled with a claim we do not make. We name the publisher
    // and the author and link the original; the headline stays theirs.
    for (const file of [
      "app/spoons-value/page.tsx",
      "components/map/inspector/VenueSpoonsValueRow.tsx",
    ]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).not.toContain("provenance.title");
      expect(source, file).not.toContain("credit.title");
    }
  });

  it("puts the doors after the answer, so a phone meets the table first", () => {
    const page = readFileSync(join(ROOT, "app", "spoons-value", "page.tsx"), "utf8");
    expect(page).toContain("actionsAfterContent");
  });

  // The two stylesheet regexes that used to stand here (a scroll box on the
  // table, a 44px box on each cut chip) are gone. RENDERED geometry proves a
  // layout claim and a regex over a stylesheet does not, and
  // `e2e/spoons-value.spec.ts` measures the real thing: no sideways page scroll
  // at 320, and at 390 every cut chip's own box clears the 44px tap floor on
  // one row. Two locks on one implementation of an answer already proved is how
  // a stylesheet becomes un-editable.

  it("puts no lede in front of the answer", () => {
    // The Screen lede plus an opening paragraph left a phone meeting no table
    // row at all. One short paragraph is the whole ration.
    const page = readFileSync(join(ROOT, "app", "spoons-value", "page.tsx"), "utf8");
    expect(page).not.toContain("lede={");
  });
});

describe("the lens costs a cold map nothing", () => {
  it("is fetched only once a reader switches it on", () => {
    const pubMap = readFileSync(join(ROOT, "components", "PubMap.tsx"), "utf8");
    // The effect returns before the fetch whenever the lens is off, so nothing
    // asks for the lane on a cold open.
    expect(pubMap).toMatch(
      /if \(!spoonsValueOn\) return;[\s\S]{0,200}?loadSpoonsValueLane\(\)/,
    );
    // The lens itself starting off is the other half, and it is not assertable
    // here: `components/PubMap.tsx` holds 18 `useState(false)` calls, so that
    // assertion could not fail. The effect's own guard above is the fence, and
    // `e2e/spoons-value.spec.ts` opens a cold map and watches for the request.
  });

  it("answers both sheets from one route, so one row cannot drift into two", () => {
    // 676 of the 788 pubs this lane joins are national base pins, which open a
    // different sheet from a curated venue. Both mount the same row.
    for (const file of [
      "components/map/inspector/VenueOverviewTab.tsx",
      "components/map/UnverifiedPubSheet.tsx",
    ]) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).toContain(
        "<VenueSpoonsValueRow",
      );
    }
    // What the row asks, and when, is held by venueSheetStaggeredPanels.test.tsx.
  });

  it("reads the slim lane and never the whole edition in a browser", () => {
    const lane = readFileSync(join(ROOT, "lib", "spoonsValueLane.ts"), "utf8");
    expect(lane).toContain("SPOONS_VALUE_MAP_LANE_URL");
    expect(lane).not.toContain("/data/spoonme/rows.json");
    // The server pack must never be imported by a browser module.
    const control = readFileSync(
      join(ROOT, "components", "map", "SpoonsValueLensControl.tsx"),
      "utf8",
    );
    expect(control).not.toContain("spoonsValue.server");
  });
});
