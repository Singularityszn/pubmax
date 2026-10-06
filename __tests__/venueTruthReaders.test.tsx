// The readers, held to the contract they print.
//
// Two surfaces used to publish a claim the data does not carry: the venue
// sheet's amenity row, which drew a grey chip for a blank column and read as a
// stated No, and the /today pints card, which files every row under the area
// heading whether the pub is in that area or only near it.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TodayPintsCard from "@/app/today/TodayPintsCard";
import { Amenity } from "@/components/map/venueInspectorBits";
import {
  buildTodayPintsForPatch,
  todayPintsHeading,
  type TodayPintsIndex,
} from "@/app/today/todayPints";
import { CENTRAL_PATCH } from "@/lib/nightPatches";
import { AREA_NEARBY_ROW_TAG } from "@/lib/venueTruth";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

function priceRow(over: Partial<VenuePrice>): VenuePrice {
  return {
    app_price_id: "row",
    pub_name: "Pub",
    pint_name: "Lager",
    price_gbp: 4.8,
    price_text: "£4.80",
    address: "1 Test Street, London",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "Westminster",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Westminster",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "test",
    source_row_count: 1,
    has_visible_borough_row: true,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...over,
  };
}

describe("the amenity chip", () => {
  it("draws nothing at all for an unknown", () => {
    expect(renderToStaticMarkup(createElement(Amenity, { status: "unknown", label: "Beer garden" })))
      .toBe("");
  });

  it("draws the fact for a stated presence, and wears no hue of its own", () => {
    const html = renderToStaticMarkup(
      createElement(Amenity, { status: "known-true", label: "Beer garden" }),
    );
    expect(html).toContain("Beer garden");
    // No `active` modifier: only stated facts render here now, so a green chip
    // would encode nothing and would collide with the cheap price band, which
    // is the ONE thing green may mean on a venue sheet.
    expect(html).not.toContain("active");
    expect(html).toContain('class="amenity"');
  });

  it("words a stated absence as one rather than as a greyed fact", () => {
    const html = renderToStaticMarkup(
      createElement(Amenity, { status: "known-false", label: "Beer garden" }),
    );
    expect(html).toContain("No beer garden");
    expect(html).toContain("amenity--absent");
  });
});

describe("the /today pints card and its area heading", () => {
  const AREA_NAME = "Piccadilly & Soho";

  function render(index: TodayPintsIndex): string {
    return renderToStaticMarkup(createElement(TodayPintsCard, { index }));
  }

  it("marks a row that only sits NEAR the area the heading names", () => {
    const html = render({
      [CENTRAL_PATCH.id]: {
        patchId: CENTRAL_PATCH.id,
        areaName: AREA_NAME,
        rows: [
          {
            id: "inside-pub",
            name: "The Inside Arms",
            price: 4.8,
            priceLabel: "£4.80",
            mapHref: "/map?sel=inside-pub",
            areaRelation: "inside",
          },
          {
            id: "nearby-pub",
            name: "The Three Tuns",
            price: 4.5,
            priceLabel: "£4.50",
            mapHref: "/map?sel=nearby-pub",
            areaRelation: "nearby",
          },
        ],
      },
    });
    // One row of two is outside, so the majority is not, and the stronger word
    // stands.
    expect(html).toContain("The cheap ones in Piccadilly &amp; Soho");
    // Exactly one qualifier, on the row that earned it.
    expect(html.split(`>${AREA_NEARBY_ROW_TAG}<`)).toHaveLength(2);
    const nearbyRow = html.slice(html.indexOf("The Three Tuns"));
    expect(nearbyRow).toContain(AREA_NEARBY_ROW_TAG);
  });

  it("says nothing extra about a row that really is in the area", () => {
    const html = render({
      [CENTRAL_PATCH.id]: {
        patchId: CENTRAL_PATCH.id,
        areaName: AREA_NAME,
        rows: [
          {
            id: "inside-pub",
            name: "The Inside Arms",
            price: 4.8,
            priceLabel: "£4.80",
            mapHref: "/map?sel=inside-pub",
            areaRelation: "inside",
          },
        ],
      },
    });
    expect(html).not.toContain(AREA_NEARBY_ROW_TAG);
  });
});

describe("buildTodayPintsForPatch stamps the relation it measured", () => {
  it("calls a pub at the patch centre inside and a pub at the rim near", () => {
    // CENTRAL_PATCH resolves to Piccadilly & Soho, centre 51.511 / -0.134,
    // radius 1.4 km. One pub on that centre, one 1.25 km north of it: inside
    // the disc, outside the core.
    const areaCentre = { lat: 51.511, lng: -0.134 };
    const venues = groupVenuePrices([
      priceRow({
        app_price_id: "centre",
        pub_name: "Centre Arms",
        latitude: areaCentre.lat,
        longitude: areaCentre.lng,
        price_gbp: 4,
      }),
      priceRow({
        app_price_id: "rim",
        pub_name: "Rim Arms",
        latitude: areaCentre.lat + 1.25 / 110.574,
        longitude: areaCentre.lng,
        price_gbp: 5,
      }),
    ]);
    const built = buildTodayPintsForPatch(CENTRAL_PATCH, venues);
    expect(built).not.toBeNull();
    const relations = new Map(built!.rows.map((row) => [row.name, row.areaRelation]));
    expect(relations.get("Centre Arms")).toBe("inside");
    expect(relations.get("Rim Arms")).toBe("nearby");
  });
});

describe("todayPintsHeading", () => {
  const row = (relation: "inside" | "nearby" | "unplaced", id: string) => ({
    id,
    name: id,
    price: 4.8,
    priceLabel: "£4.80",
    mapHref: `/map?sel=${id}` as const,
    areaRelation: relation,
  });

  const CASES: Array<[label: string, relations: Array<"inside" | "nearby" | "unplaced">, word: string]> = [
    ["every row inside", ["inside", "inside", "inside"], "in"],
    ["a minority outside", ["inside", "inside", "nearby"], "in"],
    ["an even split keeps the stronger word", ["inside", "nearby"], "in"],
    ["a majority outside", ["inside", "nearby", "nearby"], "around"],
    ["THE MEASURED CARD: four of five outside", ["inside", "nearby", "nearby", "nearby", "nearby"], "around"],
    ["every row outside", ["nearby", "nearby"], "around"],
    ["an unplaced row is not inside either", ["unplaced", "unplaced"], "around"],
    ["no rows at all", [], "in"],
  ];

  it.each(CASES)("%s heads the card with %s", (_label, relations, word) => {
    const heading = todayPintsHeading({
      areaName: "Piccadilly & Soho",
      rows: relations.map((relation, index) => row(relation, `pub-${index}`)),
    });
    expect(heading).toBe(`The cheap ones ${word} Piccadilly & Soho.`);
  });

  it("says the same thing the rows say", () => {
    // A heading that says "in" over rows that say "just outside" argues with
    // itself, which is the whole of this rule.
    const rows = [row("nearby", "a"), row("nearby", "b"), row("inside", "c")];
    expect(todayPintsHeading({ areaName: "Soho", rows })).toContain("around");
    expect(todayPintsHeading({ areaName: "Soho", rows })).not.toContain(" in ");
  });
});
