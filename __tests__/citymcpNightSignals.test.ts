import { describe, expect, it } from "vitest";

import {
  dedupeCityStatusSignals,
  filterNightShapingSignals,
  isAviationNoiseSignal,
  type CityStatusSignal,
} from "@/lib/citymcp/client";

const signal = (headline: string, detail?: string): CityStatusSignal => ({
  headline,
  ...(detail ? { detail } : {}),
});

describe("isAviationNoiseSignal", () => {
  it("drops the EasyJet Gatwick airline story (the owner's reported noise)", () => {
    expect(
      isAviationNoiseSignal(signal("EasyJet cancels flights at Gatwick", "Passengers stranded after crew shortage")),
    ).toBe(true);
  });

  it("drops assorted flight-side aviation items", () => {
    expect(isAviationNoiseSignal(signal("Ryanair strike hits departures"))).toBe(true);
    expect(isAviationNoiseSignal(signal("Heathrow baggage system down"))).toBe(true);
    expect(isAviationNoiseSignal(signal("British Airways cabin crew walkout"))).toBe(true);
    expect(isAviationNoiseSignal(signal("Runway closure at Stansted"))).toBe(true);
  });

  it("keeps genuine night-shaping ground transport, incl. rail links to airports", () => {
    expect(isAviationNoiseSignal(signal("Victoria line part closure", "No service Brixton to Warren Street"))).toBe(false);
    expect(isAviationNoiseSignal(signal("Gatwick Express suspended", "Rail engineering works overnight"))).toBe(false);
    expect(isAviationNoiseSignal(signal("Heathrow: Piccadilly line trains not stopping", "Use the Elizabeth line instead"))).toBe(false);
    expect(isAviationNoiseSignal(signal("Night bus N29 diversion", "Roadworks near Wood Green"))).toBe(false);
  });

  it("keeps non-transport signals (events, weather, safety) — filter is aviation-only", () => {
    expect(isAviationNoiseSignal(signal("Thunderstorm warning tonight"))).toBe(false);
    expect(isAviationNoiseSignal(signal("Soho street festival until late"))).toBe(false);
    expect(isAviationNoiseSignal(signal(""))).toBe(false);
  });
});

describe("filterNightShapingSignals", () => {
  it("removes only aviation noise, preserving order of the rest", () => {
    const input: CityStatusSignal[] = [
      signal("Victoria line minor delays"),
      signal("EasyJet cancels flights at Gatwick"),
      signal("Soho street festival until late"),
      signal("Ryanair check-in desk queues"),
      signal("Gatwick Express suspended", "rail works"),
    ];
    const out = filterNightShapingSignals(input);
    expect(out.map((s) => s.headline)).toEqual([
      "Victoria line minor delays",
      "Soho street festival until late",
      "Gatwick Express suspended",
    ]);
  });

  it("is pure: does not mutate its input and tolerates undefined", () => {
    const input: CityStatusSignal[] = [signal("Flights grounded")];
    const snapshot = [...input];
    filterNightShapingSignals(input);
    expect(input).toEqual(snapshot);
    expect(filterNightShapingSignals(undefined)).toEqual([]);
  });
});

describe("dedupeCityStatusSignals", () => {
  it("collapses headlines that differ only in case, punctuation and filler words", () => {
    const rows = dedupeCityStatusSignals([
      signal("The Strokes Concert at The O2 Arena"),
      signal("The Strokes concert at O2 Arena"),
      signal("Holborn and St Pancras By-Election"),
      signal("Holborn and St Pancras by-election"),
    ]);
    expect(rows.map((row) => row.headline)).toEqual([
      "The Strokes Concert at The O2 Arena",
      "Holborn and St Pancras By-Election",
    ]);
  });

  it("keeps the row that says the most, in the place the story first appeared", () => {
    const rows = dedupeCityStatusSignals([
      { headline: "The Strokes concert at O2 Arena" },
      { headline: "Victoria line part closure" },
      {
        headline: "The Strokes Concert at The O2 Arena",
        sourceUrl: "https://www.timeout.com/london/news/the-strokes-o2",
        timeWindow: "18:30-22:45",
      },
    ]);
    expect(rows.map((row) => row.headline)).toEqual([
      "The Strokes Concert at The O2 Arena",
      "Victoria line part closure",
    ]);
    expect(rows[0]?.sourceUrl).toContain("timeout.com");
  });

  it("keeps two different stories that share a few words", () => {
    const rows = dedupeCityStatusSignals([
      signal("Victoria line part closure"),
      signal("Victoria line delayed"),
      signal("Tube strike Monday"),
      signal("Tube strike Tuesday"),
    ]);
    expect(rows).toHaveLength(4);
  });

  it("never merges rows with no headline words and does not mutate its input", () => {
    const input = [signal(""), signal("")];
    const copy = [...input];
    expect(dedupeCityStatusSignals(input)).toHaveLength(2);
    expect(input).toEqual(copy);
    expect(dedupeCityStatusSignals(undefined)).toEqual([]);
  });
});
