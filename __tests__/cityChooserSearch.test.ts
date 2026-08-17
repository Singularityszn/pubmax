import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CITIES, listEnabledCities } from "@/lib/cities";
import {
  buildCityChooserSearchResults,
  cityGuideCountWord,
  cityGuideMembershipLine,
  cityGuidesHavePricesLine,
  cityGuidesSearchUnavailableLine,
} from "@/lib/cityChooserSearch";
import {
  normaliseUkPlaceQuery,
  ukPlaceMapUrl,
  type UkPlace,
} from "@/lib/ukPlaceSearch";

const place = (row: Omit<UkPlace, "search">): UkPlace => ({
  ...row,
  search: normaliseUkPlaceQuery(row.name),
});

const PLACES: UkPlace[] = [
  place({ name: "Sheffield", lat: 53.3800941, lng: -1.4789213, kind: "city", context: "S" }),
  place({ name: "Bath", lat: 51.38, lng: -2.36, kind: "city", context: "BA" }),
  place({ name: "Bathford", lat: 51.4, lng: -2.3, kind: "village", context: "BA" }),
  place({ name: "Camden", lat: 51.5389171, lng: -0.1418712, kind: "suburb", context: "NW" }),
  place({ name: "Didsbury", lat: 53.4181794, lng: -2.23144, kind: "suburb", context: "M" }),
];

describe("city chooser search model", () => {
  it("keeps a matching curated city first-class and on its existing route", () => {
    const results = buildCityChooserSearchResults(
      "bath",
      listEnabledCities(),
      PLACES,
    );

    expect(results[0]).toEqual({
      kind: "curated",
      name: "Bath",
      description: CITIES.bath.tagline,
      href: "/map/bath",
      cityId: "bath",
      lat: CITIES.bath.mapView.center[1],
      lng: CITIES.bath.mapView.center[0],
    });
    expect(results.map((result) => result.name)).toEqual(["Bath", "Bathford"]);
  });

  it("opens an uncovered place at its real base-map coordinates with honest copy", () => {
    const [result] = buildCityChooserSearchResults(
      "Sheffield",
      listEnabledCities(),
      PLACES,
    );

    expect(result).toEqual({
      kind: "uncovered",
      name: "Sheffield",
      description:
        "No prices logged here yet. Open the pub map and you could be first.",
      href: "/map?place=Sheffield&lat=53.3800941&lng=-1.4789213",
      context: "S",
      lat: 53.3800941,
      lng: -1.4789213,
    });
  });

  it("routes a place inside a curated city to that city guide, never to uncovered copy", () => {
    const [camden, ...rest] = buildCityChooserSearchResults(
      "Camden",
      listEnabledCities(),
      PLACES,
    );

    expect(camden).toEqual({
      kind: "curated",
      name: "Camden",
      description:
        "Part of the London city guide, with prices and crawls.",
      href: "/map",
      cityId: "london",
      lat: 51.5389171,
      lng: -0.1418712,
    });
    expect(rest).toEqual([]);

    const [didsbury] = buildCityChooserSearchResults(
      "Didsbury",
      listEnabledCities(),
      PLACES,
    );
    expect(didsbury).toMatchObject({ kind: "curated", cityId: "manchester" });
  });

  it("promises a curated city only what that city actually ships", () => {
    // London has both. Manchester has reviewed crawls and no collected prices.
    // A map-only pack promises neither, because a tap through to nothing is a
    // broken destination rather than a welcome.
    expect(cityGuideMembershipLine(CITIES.london)).toBe(
      "Part of the London city guide, with prices and crawls.",
    );
    expect(cityGuideMembershipLine(CITIES.manchester)).toBe(
      "Part of the Manchester city guide, with crawls.",
    );
    expect(cityGuideMembershipLine(CITIES.llandudno)).toBe(
      "Part of the Llandudno city guide.",
    );
    expect(cityGuideMembershipLine(CITIES.bath)).toBe(
      "Part of the Bath city guide.",
    );
  });

  it("does not turn idle or one-letter input into a coverage claim", () => {
    expect(buildCityChooserSearchResults("", listEnabledCities(), PLACES)).toEqual([]);
    expect(buildCityChooserSearchResults("s", listEnabledCities(), PLACES)).toEqual([]);
  });

  it("encodes place names without changing their coordinates", () => {
    expect(
      ukPlaceMapUrl({
        name: "King's Lynn",
        lat: 52.7517,
        lng: 0.3952,
      }),
    ).toBe("/map?place=King%27s+Lynn&lat=52.7517&lng=0.3952");
  });
});

describe("city chooser search mobile contract", () => {
  const css = readFileSync(
    join(process.cwd(), "components/city/cityChooser.css"),
    "utf8",
  );

  it("keeps the search field and result links thumb-sized", () => {
    const input = css.match(/\.cityChooserSearchInput\s*{([^}]*)}/)?.[1] ?? "";
    const result = css.match(/\.cityChooserResultLink\s*{([^}]*)}/)?.[1] ?? "";
    expect(Number(input.match(/min-height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(44);
    expect(input).toMatch(/width:\s*100%/);
    expect(Number(result.match(/min-height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(56);
  });

  it("contains long place names inside a 390px single-column result list", () => {
    expect(css).toMatch(/\.cityChooserSearch\s*{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.cityChooserResultCopy\s*{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.cityChooserResultName\s*{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.cityChooserResults\s*{[^}]*grid-template-columns:\s*1fr/,
    );
  });
});

describe("city guide count copy", () => {
  it("derives the count from the enabled list, never a typed nine", () => {
    const count = listEnabledCities().length;
    const word = cityGuideCountWord(count);
    expect(count).toBeGreaterThan(0);
    expect(cityGuidesHavePricesLine(count)).toContain(`${word} city guides`);
    expect(cityGuidesSearchUnavailableLine(count)).toContain(`${word} city maps`);
    if (count !== 9) {
      expect(cityGuidesHavePricesLine(count)).not.toMatch(/\bnine city guides/);
      expect(cityGuidesSearchUnavailableLine(count)).not.toMatch(/\bnine city maps/);
    }
    expect(cityGuidesHavePricesLine(10)).toContain("ten city guides");
    expect(cityGuidesHavePricesLine(10)).not.toMatch(/\bnine city guides/);
  });
});
