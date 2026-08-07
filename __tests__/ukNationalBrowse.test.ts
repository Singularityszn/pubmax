import { describe, expect, it } from "vitest";

import {
  UK_CHOOSE_CITY_SEARCH_HREF,
  UK_NATIONAL_BROWSE_COPY,
  UK_NATIONAL_ENTRY_LABEL,
  UK_NATIONAL_MAP_HREF,
  UK_OUTSIDE_CITY_COPY,
  isUkNationalBrowse,
} from "@/lib/ukNationalBrowse";
import { resolveLocateMapDestination } from "@/lib/locateMapDestination";
import { nearestUkPlace } from "@/lib/nearestUkPlace";
import type { UkPlace } from "@/lib/ukPlaceSearch";
import { CITIES } from "@/lib/cities";

const places: UkPlace[] = [
  {
    name: "Sheffield",
    lat: 53.38,
    lng: -1.47,
    kind: "city",
    context: "",
    search: "sheffield",
  },
  {
    name: "Leeds",
    lat: 53.8,
    lng: -1.55,
    kind: "city",
    context: "",
    search: "leeds",
  },
];

describe("nearestUkPlace", () => {
  it("returns the closest place within the cap", () => {
    const hit = nearestUkPlace(53.4, -1.5, places);
    expect(hit?.name).toBe("Sheffield");
  });

  it("returns null when nothing is near enough", () => {
    expect(nearestUkPlace(50, 0, places, 5)).toBeNull();
  });
});

describe("resolveLocateMapDestination", () => {
  it("prefers a curated city when inside the near-city window", () => {
    const [lng, lat] = CITIES.manchester.mapView.center;
    const dest = resolveLocateMapDestination(lat, lng, places);
    expect(dest).toMatchObject({
      kind: "city",
      cityId: "manchester",
      label: "Manchester",
    });
  });

  it("opens an uncovered place when outside every curated city", () => {
    // South of Sheffield: outside the ~80km curated-city window but still
    // near enough for the place index to name Sheffield.
    const dest = resolveLocateMapDestination(53.0, -0.5, places);
    expect(dest.kind).toBe("place");
    if (dest.kind !== "place") return;
    expect(dest.arrival.name).toBe("Sheffield");
    expect(dest.arrival.lat).toBe(53.0);
    expect(dest.arrival.lng).toBe(-0.5);
    expect(dest.href).toContain("place=Sheffield");
    expect(dest.href).toContain("lat=53");
  });

  it("returns none when neither city nor place is near", () => {
    expect(resolveLocateMapDestination(0, -30, places)).toEqual({
      kind: "none",
    });
  });
});

describe("uk national browse", () => {
  it("detects the national intent param", () => {
    expect(isUkNationalBrowse("uk=1")).toBe(true);
    expect(isUkNationalBrowse("?uk=1&sel=x")).toBe(true);
    expect(isUkNationalBrowse("place=Leeds")).toBe(false);
    expect(UK_NATIONAL_MAP_HREF).toBe("/map?uk=1");
    expect(UK_CHOOSE_CITY_SEARCH_HREF).toBe("/choose-city?focus=search");
  });

  it("keeps national entry copy free of banned voice tells", () => {
    const blob = [
      UK_NATIONAL_BROWSE_COPY.title,
      UK_NATIONAL_BROWSE_COPY.body,
      UK_OUTSIDE_CITY_COPY.title,
      UK_OUTSIDE_CITY_COPY.body,
      UK_NATIONAL_ENTRY_LABEL,
    ].join(" ");
    expect(blob).not.toMatch(/!/);
    expect(blob).not.toMatch(/\u2014/);
    expect(blob).not.toMatch(/ curated /i);
    expect(blob).not.toMatch(/discover|seamless|elevate/i);
  });
});
