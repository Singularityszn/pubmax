// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import SpoonsValueLensControl from "@/components/map/SpoonsValueLensControl";
import SpoonsValueTable from "@/app/spoons-value/SpoonsValueTable";
import SpoonsValuePage, { metadata } from "@/app/spoons-value/page";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { readSpoonsValue } from "@/lib/spoonsValue.server";
import { slimVenueToPin } from "@/lib/slimPins";
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

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

function rendered(html: string): HTMLDivElement {
  const view = document.createElement("div");
  view.innerHTML = html;
  return view;
}

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
      postcode: "TQ14 8EN",
      checkedAt: "2026-08-30",
      lines: [{ name: "Sandford Orchards The General", servingLabel: "Pint", quantity: 3, glasses: 3, linePricePence: 996, lineMilliunits: 15_739 }],
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
      postcode: "AB1 2CD",
      checkedAt: "2026-08-30",
      lines: [{ name: "something dear", servingLabel: "Pint", quantity: 2, glasses: 2, linePricePence: 999, lineMilliunits: 4_057 }],
      venueId: null,
    },
  ];

  it("links a pub the map can place and leaves the rest as plain text", () => {
    const html = renderToStaticMarkup(
      createElement(SpoonsValueTable, {
        rows,
        cuts: spoonsValueCuts(rows),
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

  it("prints every figure with its unit and its round beside it", () => {
    const html = renderToStaticMarkup(
      createElement(SpoonsValueTable, {
        rows,
        cuts: spoonsValueCuts(rows),
      }),
    );
    expect(html).toContain("15.7 units");
    // Units are not a price, so the figure wears no price band (taste plan,
    // 18 Oct 2026): a green "15.7 units" read as a cheap pint.
    expect(html).not.toContain("priceBand-");
    expect(html).toContain("£9.96");
    expect(html).toContain("3 pints of Sandford Orchards The General");
    expect(html).toContain("Round costs");
  });

  it("says a rank does not move when a reader narrows the list", () => {
    const html = renderToStaticMarkup(
      createElement(SpoonsValueTable, {
        rows,
        cuts: spoonsValueCuts(rows),
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

  let page: HTMLDivElement;

  beforeAll(async () => {
    page = rendered(renderToStaticMarkup(await SpoonsValuePage()));
  });

  it("carries the Spoons lens on every rendered map link", () => {
    const primary = page.querySelector<HTMLAnchorElement>("[data-primary-action] a");
    expect(primary?.textContent).toBe("See it on the map");
    expect(primary?.getAttribute("href")).toBe("/map?lens=spoons");
    const links = Array.from(page.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((link) => new URL(link.href, "https://pubmaxxing.com"))
      .filter((url) => url.pathname === "/map");
    expect(links.length).toBeGreaterThan(1);
    for (const url of links) expect(url.searchParams.get("lens")).toBe("spoons");
  });

  it("credits Oliver Clegg and links SpoonMe without adopting its headline", () => {
    const credit = page.querySelector('[aria-label="Where these figures come from"]');
    const link = credit?.querySelector("a");
    expect(link?.textContent).toBe("Ranking method after SpoonMe by Oliver Clegg");
    expect(link?.getAttribute("href")).toBe("https://spoonme.vercel.app/report");
    expect(credit?.textContent).toContain("published 2026-08-30");
    expect(page.textContent).not.toMatch(/most drunk|get you drunk|drink more|hammered/i);
    for (const state of [
      SPOONS_VALUE_LENS_OFF,
      { status: "loading", modalMilliunits: null },
      { status: "ready", modalMilliunits: 12_785 },
      { status: "empty", modalMilliunits: null },
      { status: "unavailable", modalMilliunits: null },
    ] as const) {
      const lens = rendered(renderLens({ on: state.status !== "off", state, onChange: vi.fn() }));
      expect(lens.textContent).not.toMatch(/most drunk|get you drunk|drink more|hammered/i);
    }
  });

  it("puts the table before the actions without an extra header introduction", () => {
    const table = page.querySelector("table");
    const actions = page.querySelector("[data-primary-action]");
    expect(table).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(table!.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const introduction = page.querySelector(".screenHead")!;
    expect(Array.from(introduction.querySelectorAll("p"), (paragraph) => paragraph.textContent?.trim()))
      .toEqual(["Wetherspoons, everywhere"]);
  });
});

describe("Spoons figures in the real venue sheets", () => {
  const venueId = "synthetic-spoons-pub";
  const noop = () => {};
  const communityPrices: CommunityPricesState = {
    byVenueId: new Map(),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    venuePriceStatus: new Map([[venueId, "ready"]]),
    noAlcoholIndexStatus: "idle",
    loadNoAlcoholIndex: noop,
    loadDrinkCategoryIndex: noop,
    drinkCategoryIndexStatus: new Map(),
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: noop,
    loadVenue: noop,
    submit: async () => ({ ok: false, error: "Not submitted", reason: "rejected" }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["curated", "base"])("renders the credited round through the %s sheet", async (kind) => {
    const { pack } = await readSpoonsValue();
    expect(pack).not.toBeNull();
    const row = { ...defined(pack!.rows[0]), venueId };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === `/api/spoons-value?venueId=${venueId}`) {
        return Response.json({
          spoonsValue: { row, modalMilliunits: 12_785, rankedCount: 805, credit: pack!.provenance },
        });
      }
      return new Response("{}", { status: 404 });
    });
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", fetchMock);
    const props = {
      venue: slimVenueToPin({ id: venueId, name: "Synthetic Spoons", lat: 51.5, lng: -0.1, borough: "Camden", cheapestPrice: null, kind: "pub" }),
      tab: "overview",
      cityId: "london",
      latestContributorPrice: null,
      dropReadStatus: "ready",
      communityPrices,
      experienceLens: "all",
      presenceState: "idle",
      markPresenceHere: noop,
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: noop,
      onClearLocation: noop,
      onLogTonightPrice: noop,
      onOpenVisitReports: noop,
      priceEntryAllowed: false,
      priceSignInRequested: false,
      priceAuthLoading: false,
      priceFocusRequest: 0,
    } satisfies ComponentProps<typeof VenueOverviewTab>;
    const view = document.body.appendChild(document.createElement("div"));
    const root = createRoot(view);
    try {
      await act(async () => root.render(kind === "curated"
        ? createElement(VenueOverviewTab, props)
        : createElement(UnverifiedPubSheet, {
          pub: { id: venueId, name: "Synthetic Spoons", address: "1 Test Street", lat: 51.5, lng: -0.1, curatedVenueId: "", kind: "pub" },
          communityPrices,
        })));
      await act(async () => { vi.advanceTimersByTime(1_500); });
      const round = view.querySelector('[aria-label="Best value round"]');
      expect(round).not.toBeNull();
      expect(round!.textContent).toContain("15.7 units");
      expect(round!.textContent).toContain("£9.96");
      expect(round!.textContent).toContain("Sandford Orchards The General");
      const credit = round!.querySelector<HTMLAnchorElement>('a[href="https://spoonme.vercel.app/report"]');
      expect(credit?.textContent).toBe("Ranking method after SpoonMe by Oliver Clegg");
      expect(round!.textContent).not.toMatch(/most drunk|get you drunk|drink more|hammered/i);
      expect(round!.querySelector('a[href="/spoons-value"]')?.textContent).toBe("See the whole ranking");
      const requests = fetchMock.mock.calls.map(([url]) => String(url));
      expect(requests.filter((url) => url.startsWith("/api/spoons-value"))).toEqual([
        `/api/spoons-value?venueId=${venueId}`,
      ]);
      expect(requests.map((url) => new URL(url, "https://pubmaxxing.com").pathname))
        .not.toContain("/data/spoonme/rows.json");
    } finally {
      act(() => root.unmount());
      view.remove();
    }
  });

  it("loads and caches the slim map lane without fetching the full edition", async () => {
    vi.resetModules();
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      pubs: [["synthetic-spoons-pub", 15_739, 996, 1]],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { loadSpoonsValueLane } = await import("@/lib/spoonsValueLane");
    const lane = await loadSpoonsValueLane();
    expect(lane.status).toBe("ready");
    expect(lane.byVenueId.get("synthetic-spoons-pub")).toEqual({
      venueId: "synthetic-spoons-pub", milliunits: 15_739, pence: 996, rankNumber: 1,
    });
    await loadSpoonsValueLane();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/data/spoonme/map.json"]);
  });
});
