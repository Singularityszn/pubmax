import { describe, expect, it } from "vitest";

import {
  dedupeCityStatusSignals,
  filterNightShapingSignals,
  isAviationNoiseSignal,
  unlinkUngroundedEventSignals,
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

  it("keeps the highest severity either copy carried", () => {
    const rows = dedupeCityStatusSignals([
      { headline: "The Strokes concert at O2 Arena", severity: "major" },
      {
        headline: "The Strokes Concert at The O2 Arena",
        severity: "notable",
        sourceUrl: "https://www.timeout.com/london/news/the-strokes-o2",
      },
      { headline: "Holborn and St Pancras By-Election", severity: "notable", timeWindow: "07:00-22:00" },
      { headline: "Holborn and St Pancras by-election", severity: "info" },
    ]);
    expect(rows).toEqual([
      {
        headline: "The Strokes Concert at The O2 Arena",
        severity: "major",
        sourceUrl: "https://www.timeout.com/london/news/the-strokes-o2",
      },
      { headline: "Holborn and St Pancras By-Election", severity: "notable", timeWindow: "07:00-22:00" },
    ]);
  });

  it("keeps one-headline rows apart when they name different areas or times", () => {
    const rows = dedupeCityStatusSignals([
      { headline: "Roadworks", areas: ["Camden"] },
      { headline: "Roadworks", areas: ["Hackney"], timeWindow: "tonight" },
      { headline: "Tube strike", timeWindow: "Monday" },
      { headline: "Tube strike", timeWindow: "Tuesday" },
    ]);
    expect(rows).toEqual([
      { headline: "Roadworks", areas: ["Camden"] },
      { headline: "Roadworks", areas: ["Hackney"], timeWindow: "tonight" },
      { headline: "Tube strike", timeWindow: "Monday" },
      { headline: "Tube strike", timeWindow: "Tuesday" },
    ]);
  });

  it("still merges one story told twice in the same area, or with one copy silent on where", () => {
    const rows = dedupeCityStatusSignals([
      { headline: "Roadworks", areas: ["Camden", "Islington"] },
      { headline: "Roadworks", areas: ["camden"], timeWindow: "tonight" },
      { headline: "Tube strike" },
      { headline: "Tube strike", areas: ["Zone 1"], timeWindow: "Monday" },
    ]);
    expect(rows).toEqual([
      { headline: "Roadworks", areas: ["camden"], timeWindow: "tonight" },
      { headline: "Tube strike", areas: ["Zone 1"], timeWindow: "Monday" },
    ]);
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

describe("unlinkUngroundedEventSignals", () => {
  const byElection: CityStatusSignal = {
    kind: "event",
    headline: "Holborn and St Pancras By-Election",
    detail: "A by-election is taking place, with police warnings about protesters.",
    sourceUrl: "https://www.standard.co.uk/news/london/protests-london-met-police-palestine-israel-b1299320.html",
  };

  it("keeps an event whose readable source link shares no word with its headline, without the link (F14)", () => {
    const [row] = unlinkUngroundedEventSignals([byElection]);
    expect(row).toEqual({
      kind: "event",
      headline: "Holborn and St Pancras By-Election",
      detail: "A by-election is taking place, with police warnings about protesters.",
    });
    expect(row).not.toHaveProperty("sourceUrl");
    expect(byElection.sourceUrl).toContain("protests");
  });

  it("keeps a real event a listing page carries, without the listing's link", () => {
    const carnival: CityStatusSignal = {
      kind: "event",
      headline: "Notting Hill Carnival",
      sourceUrl: "https://www.timeout.com/london/things-to-do/things-to-do-in-london-this-weekend",
    };
    expect(unlinkUngroundedEventSignals([carnival])).toEqual([
      { kind: "event", headline: "Notting Hill Carnival" },
    ]);
  });

  it("keeps an event whose link only shares a publisher's section folder, without the link", () => {
    const jazz: CityStatusSignal = {
      kind: "event",
      headline: "Jazz music night at Ronnie Scott's",
      sourceUrl: "https://www.timeout.com/london/music/the-best-gigs-in-london-this-week",
    };
    expect(unlinkUngroundedEventSignals([jazz])).toEqual([
      { kind: "event", headline: "Jazz music night at Ronnie Scott's" },
    ]);
  });

  it("reads the slug past a trailing amp or index page, without the other story's link", () => {
    const amp: CityStatusSignal = {
      kind: "event",
      headline: "West End musical opening night",
      sourceUrl: "https://www.standard.co.uk/news/london/westminster-protest-arrests/amp",
    };
    const index: CityStatusSignal = {
      kind: "event",
      headline: "West End musical opening night",
      sourceUrl: "https://www.standard.co.uk/news/westminster-protest-arrests/index.html",
    };
    const numbered: CityStatusSignal = {
      kind: "event",
      headline: "Royal Albert Hall concert",
      sourceUrl: "https://www.timeout.com/london/music/concerts-this-autumn/123456",
    };
    expect(unlinkUngroundedEventSignals([amp, index, numbered])).toEqual([
      { kind: "event", headline: "West End musical opening night" },
      { kind: "event", headline: "West End musical opening night" },
      numbered,
    ]);
  });

  it("keeps the link when the slug names the story with a different ending", () => {
    const concert: CityStatusSignal = {
      kind: "event",
      headline: "Royal Albert Hall concert",
      sourceUrl: "https://www.timeout.com/london/music/concerts-this-autumn",
    };
    expect(unlinkUngroundedEventSignals([concert])).toEqual([concert]);
  });

  it("keeps an event whose link only shares the start of a longer word, without the link", () => {
    const musical: CityStatusSignal = {
      kind: "event",
      headline: "West End musical opening night",
      sourceUrl: "https://www.standard.co.uk/news/london/westminster-protest-arrests-b1299320.html",
    };
    const evensong: CityStatusSignal = {
      kind: "event",
      headline: "Westminster Abbey evensong",
      sourceUrl: "https://www.timeout.com/london/theatre/west-end-shows-tonight",
    };
    expect(unlinkUngroundedEventSignals([musical, evensong])).toEqual([
      { kind: "event", headline: "West End musical opening night" },
      { kind: "event", headline: "Westminster Abbey evensong" },
    ]);
  });

  it("keeps an event whose link names the story, an opaque id, no link, and non-events untouched", () => {
    const strokes: CityStatusSignal = {
      kind: "event",
      headline: "The Strokes Concert at The O2 Arena",
      sourceUrl: "https://www.timeout.com/london/news/the-strokes-o2-october-2026-timings-tickets",
    };
    const opaque: CityStatusSignal = {
      kind: "event",
      headline: "Kingston Market Place fire",
      sourceUrl: "https://www.bbc.co.uk/news/articles/cv4g17kkxwj3o",
    };
    const unsourced: CityStatusSignal = { kind: "event", headline: "A gig" };
    const alert: CityStatusSignal = { ...byElection, kind: "alert" };
    const kept = unlinkUngroundedEventSignals([strokes, opaque, unsourced, alert]);
    expect(kept).toEqual([strokes, opaque, unsourced, alert]);
  });
});

describe("dedupeCityStatusSignals complementary fields", () => {
  it("keeps the explanation and fetch time only the unsourced copy carried", () => {
    const [row] = dedupeCityStatusSignals([
      {
        headline: "Victoria line part closure",
        detail: "No service Brixton to Warren Street.",
        postcodes: ["SW9"],
        fetchedAt: "2026-10-06T19:00:00.000Z",
      },
      {
        headline: "Victoria line part closure",
        sourceUrl: "https://example.com/victoria-line-part-closure",
        timeWindow: "tonight",
      },
    ]);
    expect(row).toMatchObject({
      detail: "No service Brixton to Warren Street.",
      postcodes: ["SW9"],
      fetchedAt: "2026-10-06T19:00:00.000Z",
      sourceUrl: "https://example.com/victoria-line-part-closure",
      timeWindow: "tonight",
    });
  });
});
