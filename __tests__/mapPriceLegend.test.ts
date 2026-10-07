import { describe, expect, it } from "vitest";
import { priceBandLegendLabel } from "@/lib/priceBand";

import {
  drinkLensPriceNoun,
  NO_ALCOHOL_LENS_PRICE_NOUN,
} from "@/lib/mapExperienceLens";
import { mapPriceLegend } from "@/lib/mapPriceLegend";
import { SPOONS_VALUE_RESPONSIBLE_LINE } from "@/lib/spoonsValue";

const ALL_RENDERED_STATE = {
  priceBands: [
    { meaning: "pint", bucket: 0 },
    { meaning: "pint", bucket: 1 },
    { meaning: "pint", bucket: 2 },
    { meaning: "pint", bucket: 3 },
  ] as const,
  storyColour: null,
  clusterPrices: false,
};

const UNKNOWN_RENDERED_STATE = {
  priceBands: [{ meaning: "pint", bucket: 3 }] as const,
  storyColour: null,
  clusterPrices: false,
};

describe("mapPriceLegend", () => {
  it("takes default price meaning from rendered scene state", () => {
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: {
        priceBands: [
          { meaning: "pint", bucket: 0 },
          { meaning: "pint", bucket: 1 },
          { meaning: "pint", bucket: 2 },
          { meaning: "pint", bucket: 3 },
          { meaning: "type-relative", bucket: 0 },
          { meaning: "type-relative", bucket: 1 },
          { meaning: "type-relative", bucket: 2 },
          { meaning: "type-relative", bucket: 3 },
        ],
        storyColour: null,
        clusterPrices: false,
      },
    });

    expect(legend.ariaLabel).toContain("other venue types");
    expect(legend.hint).toContain("within its own type");
  });

  it("keeps absolute pint thresholds for pub-only maps", () => {
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: ALL_RENDERED_STATE,
    });
    expect(legend.rows.map((row) => row.label)).toEqual([
      priceBandLegendLabel("cheap"),
      priceBandLegendLabel("average"),
      priceBandLegendLabel("expensive"),
      "No pint price on the map",
    ]);
    expect(legend.rows.map((row) => row.symbol)).toEqual([
      "£",
      "££",
      "£££",
      "?",
    ]);
    expect(legend.ariaLabel).toContain("Pint price");
  });

  it("explains shared colours as type-relative for bars and late food", () => {
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: {
        priceBands: [
          ...ALL_RENDERED_STATE.priceBands,
          { meaning: "type-relative", bucket: 0 },
          { meaning: "type-relative", bucket: 1 },
          { meaning: "type-relative", bucket: 2 },
          { meaning: "type-relative", bucket: 3 },
        ],
        storyColour: null,
        clusterPrices: false,
      },
    });
    expect(legend.rows.map((row) => row.label)).toEqual([
      `${priceBandLegendLabel("cheap")}; low for its venue type`,
      `${priceBandLegendLabel("average")}; middle for its venue type`,
      `${priceBandLegendLabel("expensive")}; high for its venue type`,
      "No pint or venue price on the map",
    ]);
    expect(legend.ariaLabel).toContain("other venue types");
    expect(legend.hint).toContain("within its own type");
  });

  it("does not assign a type-relative bucket to pint copy", () => {
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: {
        priceBands: [
          { meaning: "pint", bucket: 3 },
          { meaning: "type-relative", bucket: 0 },
        ],
        storyColour: null,
        clusterPrices: false,
      },
    });

    expect(legend.rows.map((row) => row.label)).toEqual([
      "Low for its venue type",
      "No pint price on the map",
    ]);
  });

  it("uses only type-relative copy when the scene has no pubs", () => {
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: {
        priceBands: [
          { meaning: "type-relative", bucket: 0 },
          { meaning: "type-relative", bucket: 1 },
          { meaning: "type-relative", bucket: 2 },
          { meaning: "type-relative", bucket: 3 },
        ],
        storyColour: null,
        clusterPrices: false,
      },
    });

    expect(legend.rows.map((row) => row.label)).toEqual([
      "Low for its venue type",
      "Middle for its venue type",
      "High for its venue type",
      "No venue price on the map",
    ]);
    expect(legend.hint).not.toContain("Pub");
    expect(legend.hint).not.toContain("pint");
  });

  it("names selected drink and explains unknown prices", () => {
    const legend = mapPriceLegend({
      kind: "drink",
      label: "Whisky",
      noun: "Whisky",
      status: "ready",
      renderedState: ALL_RENDERED_STATE,
    });
    expect(legend.rows.map((row) => row.label)).toEqual([
      priceBandLegendLabel("cheap"),
      priceBandLegendLabel("average"),
      priceBandLegendLabel("expensive"),
      "No whisky price on the map",
    ]);
    expect(legend.ariaLabel).toContain("Whisky price");
    expect(legend.title).toBe("Whisky price bands");
    expect(legend.hint).toContain("unknown");
    expect(legend.hint).not.toContain("pint");
  });

  it("names coffee empty bands without pint or no-alcohol wording", () => {
    const noun = drinkLensPriceNoun("coffee");
    const legend = mapPriceLegend({
      kind: "drink",
      label: "Coffee",
      noun,
      status: "ready",
      renderedState: ALL_RENDERED_STATE,
    });
    expect(noun).toBe("coffee");
    expect(legend.title).toBe("Coffee price bands");
    expect(legend.rows.at(-1)?.label).toBe("No coffee price on the map");
    expect(legend.hint).toContain("trusted coffee prices");
    expect(legend.hint).not.toContain("pint");
    expect(JSON.stringify(legend)).not.toContain(NO_ALCOHOL_LENS_PRICE_NOUN);
  });

  it("keeps the no-alcohol title while using a positive sentence noun", () => {
    const legend = mapPriceLegend(
      {
        kind: "drink",
        label: "No-alcohol",
        noun: NO_ALCOHOL_LENS_PRICE_NOUN,
        status: "ready",
        renderedState: ALL_RENDERED_STATE,
      },
    );

    expect(legend.title).toBe("No-alcohol price bands");
    expect(legend.rows.at(-1)?.label).toBe(
      "No alcohol-free or soft drink price on the map",
    );
    expect(legend.hint).toContain("alcohol-free or soft drink prices");
    expect(legend.rows.at(-1)?.label).not.toContain("No no-alcohol");
  });

  it("keeps a truncated read painting trusted prices, saying so", () => {
    // A partial scan ANSWERED and its figures are already on the pins, so it
    // keeps the trusted-price sentence rather than borrowing the failure one.
    const partial = mapPriceLegend({
      kind: "drink",
      label: "Whisky",
      noun: "Whisky",
      status: "partial",
      renderedState: ALL_RENDERED_STATE,
    });
    expect(partial.hint).toContain("trusted whisky prices");
    expect(partial.hint).toContain("part of the list");
    expect(partial.hint).not.toContain("could not");
  });

  it("never lets an unreadable index read as a city with no prices", () => {
    const degraded = mapPriceLegend({
      kind: "drink",
      label: "Whisky",
      noun: "Whisky",
      status: "degraded",
      renderedState: UNKNOWN_RENDERED_STATE,
    });
    expect(degraded.hint).toContain("could not read");
    expect(degraded.hint).not.toContain("trusted whisky prices");
    expect(degraded.cluster?.note).toBe(
      "Clusters stay grey because whisky prices could not be read just now. The number is every venue in the cluster.",
    );
    expect(degraded.cluster?.note).not.toContain("none has");
    expect(degraded.hint).not.toBe(
      mapPriceLegend({
        kind: "drink",
        label: "Whisky",
        noun: "Whisky",
        status: "ready",
        renderedState: ALL_RENDERED_STATE,
      }).hint,
    );
    expect(degraded.hint).not.toBe(
      mapPriceLegend({
        kind: "drink",
        label: "Whisky",
        noun: "Whisky",
        status: "partial",
        renderedState: ALL_RENDERED_STATE,
      }).hint,
    );
  });

  it("says a read is still running rather than settling it early", () => {
    for (const status of ["loading", "idle"] as const) {
      expect(
        mapPriceLegend({
          kind: "drink",
          label: "Whisky",
          noun: "Whisky",
          status,
          renderedState: ALL_RENDERED_STATE,
        }).hint,
      ).toContain("Checking");
    }
  });

  it("shows only the grey state food pins and clusters can render", () => {
    const legend = mapPriceLegend({
      kind: "food",
      renderedState: UNKNOWN_RENDERED_STATE,
    });

    expect(legend.title).toBe("Food view");
    expect(legend.rows).toEqual([
      {
        label: "Food pins and clusters stay grey",
        symbol: "?",
        tone: "grey",
      },
    ]);
    expect(legend.hint).toContain("sourced menu prices stay on venue cards");
    expect(legend.hint).not.toContain(priceBandLegendLabel("cheap", { city: "london" }));
    expect(legend.hint).not.toContain("trusted food prices");
    expect(legend.cluster?.note).toBe(
      "Food clusters stay grey because food prices do not colour this map. The number is every venue in the cluster.",
    );
    expect(legend.cluster?.note).not.toContain("price band");
    expect(legend.noAlcoholNote).toBeNull();
  });
});

describe("mapPriceLegend colour rows under a failed read", () => {
  it("describes cached bands the scene still renders after a failed refresh", () => {
    const degraded = mapPriceLegend({
      kind: "drink",
      label: "Whisky",
      noun: "Whisky",
      status: "degraded",
      renderedState: {
        priceBands: [
          { meaning: "pint", bucket: 1 },
          { meaning: "pint", bucket: 3 },
        ],
        storyColour: null,
        clusterPrices: false,
      },
    });

    expect(degraded.rows.map((row) => row.tone)).toEqual(["amber", "grey"]);
    expect(degraded.hint).toContain("already loaded");
    expect(degraded.hint).not.toContain("no pub is coloured");
    expect(degraded.cluster?.note).toContain("most common known one");
    // A drink view prints no pint figure on a disc, so its note never claims one.
    expect(degraded.cluster?.note).not.toContain("cheapest");
  });

  it("keeps only the unknown band when no category price could be read", () => {
    const degraded = mapPriceLegend({
      kind: "drink",
      label: "Whisky",
      noun: "Whisky",
      status: "degraded",
      renderedState: UNKNOWN_RENDERED_STATE,
    });
    expect(degraded.rows.map((row) => row.tone)).toEqual(["grey"]);
    expect(degraded.title).toBe("Whisky prices unavailable");
    expect(degraded.ariaLabel).toContain("unavailable");
  });

  it("keeps the bands for every state that still colours pins", () => {
    for (const status of ["ready", "partial", "loading", "idle"] as const) {
      expect(
        mapPriceLegend({
          kind: "drink",
          label: "Whisky",
          noun: "Whisky",
          status,
          renderedState: ALL_RENDERED_STATE,
        }).rows,
      ).toHaveLength(4);
    }
  });
});

describe("map key inventory", () => {
  it("names the cluster reading, every venue shape, and every map mark", () => {
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: {
        priceBands: ALL_RENDERED_STATE.priceBands,
        storyColour: "#d99f45",
        clusterPrices: true,
      },
    });

    // The default view's disc prints the cheapest listed price, with the venue
    // count as the small number on its rim.
    expect(legend.cluster?.note).toContain("When a pub in it lists a pint price, the figure is the cheapest one");
    expect(legend.cluster?.note).toContain("small number is how many venues");
    // A coloured disc with no listed pint prints its count too, so the count is
    // never tied to a grey ring.
    expect(legend.cluster?.note).toContain("Otherwise the figure is the venue count.");
    expect(legend.cluster?.note).not.toMatch(/Grey[^.]*venue count/);
    expect(legend.cluster?.note).toContain("most common known one");
    expect(legend.shapes?.map((row) => row.id)).toEqual([
      "pub-drink",
      "bar",
      "late-food",
      "restaurant",
      "base-pub",
      "landmark",
    ]);
    expect(legend.marks?.map((row) => row.id)).toEqual([
      "your-location",
      "provisional",
      "tonight-opportunity",
      "pint-drop",
      "quiz",
      "sport",
      "deal",
      "music",
      "public-listing",
      "base-selected",
      "selected",
      "story-band",
    ]);
    expect(legend.marks?.[0]).toEqual({
      id: "your-location",
      label: "Blue centre with a pulse",
      detail: "Your approximate location.",
    });
    expect(legend.marks?.[1]?.detail).toBe(
      "A recent pint report. On a listed pub in the standard pint view, a second independent drinker reporting a similar price can set the pin's band. A UK base pub keeps only the dot.",
    );
    expect(legend.routeMarks?.map((row) => row.id)).toEqual([
      "crawl-stop",
      "walking-route",
      "straight-route",
      "story-corridor",
    ]);
    expect(legend.routeMarks.at(-1)?.detail).toContain("place story");
    expect(legend.routeMarks.find((row) => row.id === "walking-route")?.colour).toBe(
      "var(--route-line)",
    );
    expect(legend.routeMarks.find((row) => row.id === "straight-route")?.colour).toBe(
      "var(--route-line)",
    );
    expect(legend.routeMarks.find((row) => row.id === "story-corridor")?.colour).toBe(
      "#d99f45",
    );
    expect(legend.noAlcoholNote).toContain("no separate pin");
  });

  it("does not declare inactive story marks", () => {
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: ALL_RENDERED_STATE,
    });

    expect(legend.marks.map((row) => row.id)).not.toContain("story-band");
    expect(legend.routeMarks.map((row) => row.id)).not.toContain(
      "story-corridor",
    );
  });

  it("keeps pint reports outside selected lens and base-pin authority", () => {
    const drink = mapPriceLegend({
      kind: "drink",
      label: "No-alcohol",
      noun: NO_ALCOHOL_LENS_PRICE_NOUN,
      status: "ready",
      renderedState: ALL_RENDERED_STATE,
    });
    const food = mapPriceLegend({
      kind: "food",
      renderedState: UNKNOWN_RENDERED_STATE,
    });

    expect(
      drink.marks.find((row) => row.id === "provisional")?.detail,
    ).toBe(
      "A recent pint report. It doesn't set the selected drink band. A UK base pub keeps only the dot.",
    );
    expect(
      food.marks.find((row) => row.id === "provisional")?.detail,
    ).toBe(
      "A recent pint report. It doesn't set a food pin's colour. A UK base pub keeps only the dot.",
    );
  });

  it("answers the Spoons value lens in its own words, and no pound figure", () => {
    const legend = mapPriceLegend({
      kind: "spoons",
      modalMilliunits: 12_785,
      renderedState: {
        priceBands: [
          { meaning: "spoons", bucket: 0 },
          { meaning: "spoons", bucket: 1 },
          { meaning: "spoons", bucket: 2 },
          { meaning: "spoons", bucket: 3 },
        ],
        storyColour: null,
        clusterPrices: false,
      },
    });
    expect(legend.title).toBe("Spoons value key");
    expect(legend.rows).toEqual([
      { label: "More than 12.8 units", symbol: "More", tone: "green" },
      { label: "12.8 units", symbol: "Usual", tone: "amber" },
      { label: "Less than 12.8 units", symbol: "Less", tone: "red" },
      { label: "Not in the ranking", symbol: "?", tone: "grey" },
    ]);
    expect(legend.hint).toContain("not a pint price");
    expect(legend.hint).toContain(SPOONS_VALUE_RESPONSIBLE_LINE);
    expect(legend.cluster?.note).toContain("value bands");
    expect(legend.priceCapFilter).toBe(false);
    expect(legend.noAlcoholNote).toBeNull();
    expect(
      legend.marks.find((row) => row.id === "provisional")?.detail,
    ).toBe(
      "A recent pint report. It doesn't set a pin's value band. A UK base pub keeps only the dot.",
    );
  });

  it("prints only the Spoons bands the map is drawing", () => {
    const legend = mapPriceLegend({
      kind: "spoons",
      modalMilliunits: 12_785,
      renderedState: {
        priceBands: [{ meaning: "spoons", bucket: 3 }],
        storyColour: null,
        clusterPrices: false,
      },
    });
    expect(legend.rows).toEqual([
      { label: "Not in the ranking", symbol: "?", tone: "grey" },
    ]);
    expect(legend.cluster?.note).toBe(
      "Clusters stay grey because no pub in view is in the ranking. The number is every venue in the cluster.",
    );
  });
});
