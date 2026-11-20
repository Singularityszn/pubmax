import { describe, expect, it } from "vitest";
import { buildGuinnessIndex } from "@/lib/guinnessIndex";

const row = (venueId: string, priceGbp: number, borough = "Camden") => ({
  venueId, venueName: venueId, borough, priceGbp,
  publisher: { label: "Example", url: "https://example.com" },
  observedAt: "2026-01-01",
});

describe("Guinness index", () => {
  it("counts each pub once and withholds thin borough medians", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(String(i), i + 1));
    const index = buildGuinnessIndex([...rows, row("0", 9), row("other", 20, "Brent")]);
    expect(index.count).toBe(11);
    expect(index.medianGbp).toBe(6);
    expect(index.cheapest?.priceGbp).toBe(1);
    expect(index.dearest?.priceGbp).toBe(20);
    expect(index.boroughs.find((area) => area.name === "Camden")).toMatchObject({ count: 10, medianGbp: 5.5 });
    expect(index.boroughs.find((area) => area.name === "Brent")).toMatchObject({ count: 1, medianGbp: null });
  });
  it("withholds the London median when the sample is thin", () => {
    expect(buildGuinnessIndex([row("one", 5)])).toMatchObject({ count: 1, medianGbp: null });
  });
  it("does not invent an answer when no prices exist", () => {
    expect(buildGuinnessIndex([])).toMatchObject({ count: 0, medianGbp: null, cheapest: null, dearest: null });
  });
});
