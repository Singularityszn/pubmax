import { describe, expect, it } from "vitest";
import { nearbyStationPubs, stationFromSlug } from "@/lib/stationPages";
import type { Venue } from "@/lib/venues";

const station = { name: "Example", lat: 51.5, lng: -0.1, zone: 1 };
function pub(id: string, price: number | null, lat: number, source = "Menu"): Venue {
  return { id, name: id, latitude: lat, longitude: -0.1, kind: "pub", cheapestPrice: price,
    priceSource: source, priceObservedAt: "2026-01-01", cheapestPint: "Lager" } as Venue;
}

describe("station pages", () => {
  it("resolves a station and rejects an unknown slug", () => {
    expect(stationFromSlug("liverpool-street")?.name).toBe("Liverpool Street");
    expect(stationFromSlug("not-a-real-station")).toBeNull();
  });

  it.each([
    ["oxford-circus", "Oxford Circus"],
    ["barking-riverside", "Barking Riverside"],
    ["battersea-park", "Battersea Park"],
    ["bethnal-green-rail", "Bethnal Green Rail"],
    ["abbey-wood", "Abbey Wood"],
    ["woolwich-arsenal", "Woolwich Arsenal"],
    ["hammersmith-met", "Hammersmith (Met.)"],
    ["hammersmith-district", "Hammersmith (District)"],
  ])("keeps the supported network station %s", (slug, name) => {
    expect(stationFromSlug(slug)?.name).toBe(name);
  });

  it.each(["addington-village", "birkbeck", "beckenham-junction", "albany-park", "city-thameslink", "kings-cross"])("rejects the tram or National Rail-only station %s", (slug) => {
    expect(stationFromSlug(slug)).toBeNull();
  });

  it("sorts comparable nearby pints first and keeps unknown prices last", () => {
    const rows = nearbyStationPubs(station, [pub("unknown", null, 51.501), pub("expensive", 6, 51.501), pub("cheap", 4, 51.502), pub("far", 3, 51.6), pub("undated", 2, 51.501, "")]);
    expect(rows.map((row) => row.venue.id)).toEqual(["cheap", "expensive", "undated", "unknown"]);
    expect(rows[0]?.distanceMetres).toBeGreaterThan(0);
    expect(rows[0]?.street).toBe(false);
  });

  it("does not list restaurants as pubs", () => {
    const restaurant = { ...pub("restaurant", 3, 51.501), kind: "restaurant" } as Venue;
    expect(nearbyStationPubs(station, [restaurant])).toEqual([]);
  });

  it.each(["pub", undefined, "bar"] as const)("excludes restricted venues with kind %s before ranking", (kind) => {
    const restricted = ["The Three Tuns - LSE Student Union", "Finchley United Services Club Ltd", "Members Only Bar"]
      .map((name, index) => ({ ...pub(`restricted-${index}`, 2.95, 51.501), name, kind, legacyOsmBar: true }));
    const publicPub = { ...pub("public", 5, 51.501), name: "The Union", kind, legacyOsmBar: true };
    expect(nearbyStationPubs(station, [...restricted, publicPub]).map((row) => row.venue.id)).toEqual(["public"]);
  });
});
