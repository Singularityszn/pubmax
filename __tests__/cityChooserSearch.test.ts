import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CITIES, listEnabledCities } from "@/lib/cities";
import {
  buildCityChooserSearchResults,
} from "@/lib/cityChooserSearch";
import { ukPlaceMapUrl, type UkPlace } from "@/lib/ukPlaceSearch";

const PLACES: UkPlace[] = [
  { name: "Sheffield", lat: 53.3800941, lng: -1.4789213, kind: "city", context: "S" },
  { name: "Bath", lat: 51.38, lng: -2.36, kind: "city", context: "BA" },
  { name: "Bathford", lat: 51.4, lng: -2.3, kind: "village", context: "BA" },
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
    });
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
