// /today is the daytime page (launch review 2.1 and design V1, 30 Oct 2026):
// work spots, coffee, lunch at a pub, a quiet pint, the weather and the last
// train, with the pub of the day at the foot. It repeats none of Tonight's
// picks, every row names its source and date, and an empty row disappears
// rather than printing zero.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));

import TodayClient from "@/app/today/TodayClient";
import {
  buildTodayCoffee,
  buildTodayLunchIndex,
  buildTodayWorkSpotsIndex,
  type TodayCoffeeModule,
  type TodayLunchIndex,
  type TodayWorkSpotsIndex,
} from "@/app/today/todayDaytime";
import { loadTodayCoffeePilot, loadTodayDeskPack } from "@/app/today/todayDaytime.server";
import { buildDayGreeting } from "@/lib/dayGreeting";
import type { DeskPoint } from "@/lib/nearDesk";
import type { PubOfTheDayCard } from "@/lib/pubOfTheDay";
import type { Venue } from "@/lib/venues";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-10-30T11:00:00.000Z");

function renderToday(input: {
  workSpots?: TodayWorkSpotsIndex;
  lunch?: TodayLunchIndex;
  coffee?: TodayCoffeeModule | null;
  fact?: PubOfTheDayCard | null;
}): string {
  return renderToStaticMarkup(
    createElement(TodayClient, {
      dateLabel: "Friday 30 October",
      nowIso: NOW.toISOString(),
      greeting: buildDayGreeting({ now: NOW, weather: null, dateLabel: "Friday 30 October", name: null }),
      weather: null,
      weatherByArea: {},
      fact: input.fact ?? null,
      pintsIndex: {},
      quietPint: null,
      workSpots: input.workSpots,
      lunch: input.lunch,
      coffee: input.coffee ?? null,
    }),
  );
}

const DESK: DeskPoint = {
  id: "venue-osm-n1",
  name: "Soho Library",
  lat: 51.5130,
  lng: -0.1300,
  kind: "library",
  wifi: "yes",
  laptop: "unknown",
  openingHours: null,
};

function lunchVenue(): Venue {
  return {
    id: "venue-lunch",
    name: "The Lunch Arms",
    latitude: 51.5131,
    longitude: -0.1301,
    cheapestPrice: 5.1,
    prices: [{ price_gbp: 5.1, scraped_at_values: "2026-10-02T09:00:00Z" }],
    amenities: { food: true },
  } as unknown as Venue;
}

describe("Today renders no row with zero items", () => {
  it("draws no daytime section, no picks and no zero when every module is empty", () => {
    const html = renderToday({ workSpots: {}, lunch: {}, coffee: null });
    for (const id of ["today-work-spots", "today-coffee", "today-lunch", "today-picks", "today-fact"]) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
    expect(html).not.toMatch(/>0</);
    expect(html).not.toContain("Top picks for tonight");
    expect(html).toContain('href="/tonight"');
  });

  it("draws each module that has rows, with its source and its date", () => {
    const workSpots = buildTodayWorkSpotsIndex([DESK], "2026-10-04T23:58:31.421Z", NOW);
    const coffee = buildTodayCoffee(loadTodayCoffeePilot(), "Shoreditch");
    const html = renderToday({
      workSpots,
      coffee,
      lunch: {
        central: {
          patchId: "central",
          areaLabel: "central London",
          rows: [{
            id: "venue-lunch",
            name: "The Lunch Arms",
            mapHref: "/map?sel=venue-lunch",
            menuUrl: "https://www.youngs.co.uk/menu",
            menuSource: "youngs.co.uk",
            readLine: "Records from 2 October 2026",
          }],
        },
      },
    });
    expect(html).toContain('data-testid="today-work-spots"');
    expect(html).toContain("Soho Library");
    expect(html).toContain("OpenStreetMap");
    expect(html).toContain('data-testid="today-coffee"');
    expect(html).toContain("Listed on");
    expect(html).toContain('data-testid="today-lunch"');
    expect(html).toContain("Menu on youngs.co.uk");
    expect(html).toContain("Records from 2 October 2026");
  });

  it("puts the pub of the day at the foot, after every daytime section", () => {
    const fact = {
      pubName: "The Fixture",
      reason: "Built in 1720.",
      mapHref: "/map?sel=venue-fixture",
      provenance: "wikipedia",
      provenanceLabel: "Wikipedia",
      sourceLabel: "Wikipedia",
      sourceRef: null,
    } as unknown as PubOfTheDayCard;
    const html = renderToday({ fact, workSpots: buildTodayWorkSpotsIndex([DESK], "2026-10-04T23:58:31.421Z", NOW) });
    expect(html.indexOf('data-testid="today-fact"')).toBeGreaterThan(html.indexOf('data-testid="today-get-there"'));
    expect(html.indexOf('data-testid="today-fact"')).toBeGreaterThan(html.indexOf('data-testid="today-work-spots"'));
  });
});

describe("the daytime builders invent nothing", () => {
  it("lists a lunch pub only with food, a menu link and a read date", () => {
    const venue = lunchVenue();
    const menus = new Map([["venue-lunch", { menuUrl: "https://www.youngs.co.uk/menu", source: "youngs.co.uk" }]]);
    const index = buildTodayLunchIndex([venue], menus);
    expect(index.central?.rows[0]?.menuSource).toBe("youngs.co.uk");
    expect(buildTodayLunchIndex([venue], new Map())).toEqual({});
    const noFood = { ...venue, amenities: { food: false } } as unknown as Venue;
    expect(buildTodayLunchIndex([noFood], menus)).toEqual({});
  });

  it("compares one named coffee and dates every row", () => {
    const coffee = buildTodayCoffee(loadTodayCoffeePilot(), "Shoreditch");
    expect(coffee?.rows.length).toBeGreaterThan(0);
    expect(coffee?.rows.every((row) => row.drinkLabel === "Flat white")).toBe(true);
    expect(coffee?.rows.every((row) => /, \d{1,2} \w+ \d{4}$/.test(row.sourceLine))).toBe(true);
    expect(buildTodayCoffee([], "Shoreditch")).toBeNull();
  });

  it("reads the Work spots pack and leaves a patch out when nothing is within a walk", () => {
    const pack = loadTodayDeskPack();
    expect(pack.status).toBe("ready");
    expect(pack.observedAt).toBeTruthy();
    expect(buildTodayWorkSpotsIndex([DESK], null, NOW)).toEqual({});
    const index = buildTodayWorkSpotsIndex([DESK], "2026-10-04T23:58:31.421Z", NOW);
    expect(Object.keys(index)).toContain("central");
    expect(index.brixton).toBeUndefined();
  });
});
