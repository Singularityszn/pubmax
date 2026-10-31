import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parsePriceHistory, type PriceHistoryObservation } from "@/lib/priceHistory";
import {
  buildTimeMachine,
  resolveTimeMachineYear,
  rowsForYear,
  timeMachineExampleLine,
  timeMachinePath,
  timeMachineShareText,
  type TimeMachineVenueRef,
} from "@/lib/priceTimeMachine";

// The time machine invents nothing (lib/priceTimeMachine.ts). A pub lights
// only in a year it holds a dated record for, with the price that record
// states, and a year between two records is not filled in.

function obs(venueId: string, priceGbp: number, observedOn: string, venueName = venueId): PriceHistoryObservation {
  return {
    venueId,
    venueName,
    priceGbp,
    observedOn,
    source: { label: "beerintheevening.com", url: `https://example.org/${venueId}/${observedOn}`, licence: "quoted" },
  };
}

const PLACES: Record<string, TimeMachineVenueRef> = {
  "venue-a": { name: "The Anchor", lat: 51.5, lng: -0.1 },
  "venue-b": { name: "The Bell", lat: 51.51, lng: -0.12 },
  "venue-c": { name: "The Crown", lat: 51.52, lng: -0.13 },
};
const lookup = (id: string) => PLACES[id] ?? null;

const ROWS = [
  obs("venue-a", 3.1, "2013-06-02"),
  obs("venue-a", 4.2, "2016-03-10"),
  obs("venue-b", 3.6, "2013-11-20"),
  obs("venue-b", 3.4, "2013-02-01"),
  obs("venue-c", 5.0, "2019-06-14"),
  obs("venue-ghost", 4.0, "2016-08-01", "The Ghost"),
];

describe("buildTimeMachine", () => {
  const data = buildTimeMachine(ROWS, lookup)!;

  it("takes its bounds from the oldest and newest dated record", () => {
    expect(data.minYear).toBe(2013);
    expect(data.maxYear).toBe(2019);
  });

  it("lights each pub in a year with the record it holds for that year", () => {
    const rows2013 = rowsForYear(data, 2013);
    expect(rows2013.map((row) => [row.venueId, row.priceGbp, row.monthLabel])).toEqual([
      ["venue-a", 3.1, "June 2013"],
      ["venue-b", 3.4, "February 2013"],
    ]);
  });

  it("shows the earlier of two records one pub holds in one year, never their mean", () => {
    const bell = rowsForYear(data, 2013).find((row) => row.venueId === "venue-b");
    expect(bell?.priceGbp).toBe(3.4);
    expect(bell?.observedOn).toBe("2013-02-01");
  });

  it("does not light a pub in a year it has no record for, even between two records", () => {
    for (const year of [2014, 2015]) {
      expect(rowsForYear(data, year)).toEqual([]);
    }
    const in2016 = rowsForYear(data, 2016).map((row) => row.venueId);
    expect(in2016).toContain("venue-a");
    expect(in2016).not.toContain("venue-b");
    expect(in2016).not.toContain("venue-c");
  });

  it("interpolates no price: every lit figure is a figure in the file", () => {
    const filed = new Set(ROWS.map((row) => `${row.venueId}|${row.priceGbp}|${row.observedOn}`));
    for (let year = data.minYear; year <= data.maxYear; year += 1) {
      for (const row of rowsForYear(data, year)) {
        expect(filed.has(`${row.venueId}|${row.priceGbp}|${row.observedOn}`)).toBe(true);
        expect(row.observedOn.startsWith(String(year))).toBe(true);
      }
    }
  });

  it("names a pub from the venue index, and lists but never pins a pub the index cannot place", () => {
    expect(data.venues.map((venue) => venue.venueId)).toEqual(["venue-a", "venue-b", "venue-c"]);
    const ghost = rowsForYear(data, 2016).find((row) => row.venueId === "venue-ghost");
    expect(ghost).toMatchObject({ name: "The Ghost", placed: false });
    expect(rowsForYear(data, 2016).find((row) => row.venueId === "venue-a")?.name).toBe("The Anchor");
  });

  it("answers null for a file with no dated row", () => {
    expect(buildTimeMachine([], lookup)).toBeNull();
  });
});

describe("the year a link asks for", () => {
  const data = buildTimeMachine(ROWS, lookup)!;

  it("opens the asked year inside the bounds, and the newest year otherwise", () => {
    expect(resolveTimeMachineYear(data, "2014")).toBe(2014);
    expect(resolveTimeMachineYear(data, ["2016", "2013"])).toBe(2016);
    for (const raw of [undefined, "", "2009", "2031", "20x4", "2013.5", 2013]) {
      expect(resolveTimeMachineYear(data, raw)).toBe(2019);
    }
  });

  it("writes the share text and path word for word", () => {
    expect(timeMachineShareText(2013, 2)).toBe("Pints in 2013: 2 pubs with a dated record");
    expect(timeMachineShareText(2019, 1)).toBe("Pints in 2019: 1 pub with a dated record");
    expect(timeMachinePath(2013)).toBe("/time-machine?year=2013");
    expect(timeMachineExampleLine(rowsForYear(data, 2019)[0]!)).toBe("The Crown, £5.00 in June 2019");
  });
});

describe("the shipped history file", () => {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "public/data/price_history/london.json"), "utf8"),
  ) as { observations: Array<{ observedOn: string }> };
  const shipped = parsePriceHistory(raw);

  it("spans the file's own years and lights every shipped row exactly once", () => {
    const data = buildTimeMachine(shipped, () => null)!;
    const years = shipped.map((row) => Number(row.observedOn.slice(0, 4)));
    expect(data.minYear).toBe(Math.min(...years));
    expect(data.maxYear).toBe(Math.max(...years));
    const venueYears = new Set(shipped.map((row) => `${row.venueId}|${row.observedOn.slice(0, 4)}`));
    let lit = 0;
    for (let year = data.minYear; year <= data.maxYear; year += 1) lit += rowsForYear(data, year).length;
    expect(lit).toBe(venueYears.size);
  });
});
