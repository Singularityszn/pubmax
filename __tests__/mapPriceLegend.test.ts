import { describe, expect, it } from "vitest";

import { NO_ALCOHOL_LENS_PRICE_NOUN } from "@/lib/mapExperienceLens";
import { mapPriceLegend } from "@/lib/mapPriceLegend";

describe("mapPriceLegend", () => {
  it("keeps absolute pint thresholds for pub-only maps", () => {
    const legend = mapPriceLegend(false);
    expect(legend.rows.map((row) => row.label)).toEqual([
      "£5.50 or less",
      "Over £5.50, up to £7",
      "Over £7",
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
    const legend = mapPriceLegend(true);
    expect(legend.rows.map((row) => row.label)).toEqual([
      "£5.50 or less; low for its venue type",
      "Over £5.50, up to £7; middle for its venue type",
      "Over £7; high for its venue type",
      "No pint or venue price on the map",
    ]);
    expect(legend.ariaLabel).toContain("other venue types");
    expect(legend.hint).toContain("within its own type");
  });

  it("names selected drink and explains unknown prices", () => {
    const legend = mapPriceLegend(true, "Whisky");
    expect(legend.rows.map((row) => row.label)).toEqual([
      "£5.50 or less",
      "Over £5.50, up to £7",
      "Over £7",
      "No whisky price on the map",
    ]);
    expect(legend.ariaLabel).toContain("Whisky price");
    expect(legend.title).toBe("Whisky price bands");
    expect(legend.hint).toContain("unknown");
    expect(legend.hint).not.toContain("pint");
  });

  it("keeps the no-alcohol title while using a positive sentence noun", () => {
    const legend = mapPriceLegend(
      true,
      "No-alcohol",
      "ready",
      NO_ALCOHOL_LENS_PRICE_NOUN,
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
    const partial = mapPriceLegend(true, "Whisky", "partial");
    expect(partial.hint).toContain("trusted whisky prices");
    expect(partial.hint).toContain("part of the list");
    expect(partial.hint).not.toContain("could not");
  });

  it("never lets an unreadable index read as a city with no prices", () => {
    const degraded = mapPriceLegend(true, "Whisky", "degraded");
    expect(degraded.hint).toContain("could not read");
    expect(degraded.hint).not.toContain("trusted whisky prices");
    expect(degraded.hint).not.toBe(mapPriceLegend(true, "Whisky").hint);
    expect(degraded.hint).not.toBe(
      mapPriceLegend(true, "Whisky", "partial").hint,
    );
  });

  it("says a read is still running rather than settling it early", () => {
    expect(mapPriceLegend(true, "Whisky", "loading").hint).toContain(
      "Checking whisky prices",
    );
    expect(mapPriceLegend(true, "Whisky", "idle").hint).toContain(
      "Checking whisky prices",
    );
  });
});

describe("mapPriceLegend colour rows under a failed read", () => {
  it("keeps only the unknown band when no category price could be read", () => {
    const degraded = mapPriceLegend(true, "Whisky", "degraded");
    expect(degraded.rows.map((row) => row.tone)).toEqual(["grey"]);
    expect(degraded.title).toBe("Whisky prices unavailable");
    expect(degraded.ariaLabel).toContain("unavailable");
  });

  it("keeps the bands for every state that still colours pins", () => {
    for (const status of ["ready", "partial", "loading", "idle"] as const) {
      expect(mapPriceLegend(true, "Whisky", status).rows).toHaveLength(4);
    }
  });
});

describe("map key inventory", () => {
  it("names the cluster reading, every venue shape, and every map mark", () => {
    const legend = mapPriceLegend(false) as ReturnType<typeof mapPriceLegend> & {
      clusterNote?: string;
      shapes?: Array<{ id: string }>;
      marks?: Array<{ id: string; detail: string }>;
      routeMarks?: Array<{ id: string }>;
      noAlcoholNote?: string;
    };

    expect(legend.clusterNote).toContain("number is every pub");
    expect(legend.clusterNote).toContain("most common known price band");
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
      "pint-drop",
      "quiz",
      "sport",
      "deal",
      "music",
      "public-listing",
      "selected",
      "story-band",
    ]);
    expect(legend.marks?.[0]).toEqual({
      id: "your-location",
      label: "Blue centre with a pulse",
      detail: "Your approximate location.",
    });
    expect(legend.marks?.[1]?.detail).toBe(
      "One recent pint report. A second independent drinker agreeing can set the pin's band.",
    );
    expect(legend.routeMarks?.map((row) => row.id)).toEqual([
      "crawl-stop",
      "walking-route",
      "straight-route",
    ]);
    expect(legend.noAlcoholNote).toContain("no separate pin");
  });
});
