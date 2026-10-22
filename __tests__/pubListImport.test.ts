import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { importPubList } from "@/lib/pubListImport.server";

describe("pub list import", () => {
  it("keeps the pasted order and an unknown pub through the import entry point", () => {
    const result = importPubList({ text: "1. The Harp, Covent Garden\n2. The Imaginary Teapot" }, {
      curated: [{ id: "harp", name: "The Harp", area: "Covent Garden" }],
      national: [],
    });

    expect(result.items).toEqual([
      {
        rawLine: "1. The Harp, Covent Garden",
        name: "The Harp",
        areaHint: "Covent Garden",
        state: "matched",
        venue: { id: "harp", name: "The Harp", area: "Covent Garden", layer: "curated" },
      },
      {
        rawLine: "2. The Imaginary Teapot",
        name: "The Imaginary Teapot",
        areaHint: "",
        state: "unmatched",
      },
    ]);
  });

  it("keeps The Crown ambiguous and uses an area or postcode district only to break ties", () => {
    const catalog = {
      curated: [
        { id: "crown-soho", name: "The Crown", area: "Soho", postcodeDistrict: "W1D" },
        { id: "crown-richmond", name: "The Crown", area: "Richmond", postcodeDistrict: "TW9" },
      ],
      national: [],
    };
    const { items } = importPubList({ text: "The Crown\nThe Crown, Richmond\nThe Crown (W1D)\nThe Crown, Camden" }, catalog);

    expect(items[0]).toMatchObject({ state: "ambiguous", candidates: [{ id: "crown-soho" }, { id: "crown-richmond" }] });
    expect(items[0]).not.toHaveProperty("venue");
    expect(items[1]).toMatchObject({ state: "matched", venue: { id: "crown-richmond" } });
    expect(items[2]).toMatchObject({ state: "matched", venue: { id: "crown-soho" } });
    expect(items[3]).toMatchObject({ state: "ambiguous" });
  });

  it("does not turn a partial postcode district into a tie breaker", () => {
    const { items } = importPubList({ text: "The Crown, W1" }, {
      curated: [
        { id: "crown-soho", name: "The Crown", area: "Soho", postcodeDistrict: "W1D" },
        { id: "crown-richmond", name: "The Crown", area: "Richmond", postcodeDistrict: "TW9" },
      ],
      national: [],
    });

    expect(items[0]).toMatchObject({ state: "ambiguous" });
  });

  it("limits ambiguous suggestions without resolving an overloaded name", () => {
    const { items } = importPubList({ text: "The Crown" }, {
      curated: ["Soho", "Richmond", "Camden", "Hackney", "Brixton"].map((area) => ({ id: area, name: "The Crown", area })),
      national: [],
    });

    expect(items[0]).toMatchObject({ state: "ambiguous", candidateCount: 5 });
    const item = items[0];
    if (item?.state !== "ambiguous") throw new Error("Expected an ambiguous pub.");
    expect(item.candidates).toHaveLength(4);
    expect(items[0]).not.toHaveProperty("venue");
  });

  it.each([
    "The Harp, Covent Garden\nThe Crown - Soho\nThe George (Southwark)",
    "1. The Harp, Covent Garden 2. The Crown - Soho 3. The George (Southwark)",
    "• The Harp, Covent Garden • The Crown - Soho • The George (Southwark)",
    "🍺 The Harp, Covent Garden 🍻 The Crown - Soho 📍 The George (Southwark)",
    "- The Harp, Covent Garden\r\n* The Crown - Soho\r\n▪ The George (Southwark)",
    "1️⃣ The Harp, Covent Garden\n2️⃣ The Crown - Soho\n3️⃣ The George (Southwark)",
  ])("extracts ordered names and area hints from a pasted list: %s", (text) => {
    const { items } = importPubList({ text }, { curated: [], national: [] });

    expect(items.map(({ name, areaHint }) => ({ name, areaHint }))).toEqual([
      { name: "The Harp", areaHint: "Covent Garden" },
      { name: "The Crown", areaHint: "Soho" },
      { name: "The George", areaHint: "Southwark" },
    ]);
    expect(items.every((item) => item.state === "unmatched")).toBe(true);
  });

  it("reports truncation rather than silently losing candidates past the 40 item limit", () => {
    const text = Array.from({ length: 41 }, (_, i) => `${i + 1}. Unknown pub ${i + 1}`).join("\n");
    const result = importPubList({ text }, { curated: [], national: [] });

    expect(result.items).toHaveLength(40);
    expect(result.items[39]?.name).toBe("Unknown pub 40");
    expect(result.truncated).toBe(true);
  });

  it.each(["", " \n\t", "🍺\n•\n-"])("refuses text without a candidate: %j", (text) => {
    expect(() => importPubList({ text }, { curated: [], national: [] })).toThrow("Paste at least one pub name.");
  });

  it("refuses overlong input without putting the pasted text into the error", () => {
    expect(() => importPubList({ text: "x".repeat(4001) }, { curated: [], national: [] }))
      .toThrow("The pub list must contain 4,000 characters or fewer.");
    expect(importPubList({ text: "x".repeat(4000) }, { curated: [], national: [] }).items).toHaveLength(1);
  });

  it("keeps national matches unpriced and does not copy extra catalog fields", () => {
    const nationalVenue = {
      id: "osm-york", name: "The Blue Bell", area: "York", cheapestPrice: 1, creatorClaim: "Open all night",
    };
    const { items } = importPubList({ text: "The Blue Bell, York" }, { curated: [], national: [nationalVenue] });

    expect(items[0]).toEqual({
      rawLine: "The Blue Bell, York", name: "The Blue Bell", areaHint: "York", state: "matched",
      venue: { id: "osm-york", name: "The Blue Bell", area: "York", layer: "national", price: null },
    });
  });

  it("marks closed pubs separately from matched pubs in either layer", () => {
    const { items } = importPubList({ text: "The Shut Door\nThe Closed Bell" }, {
      curated: [{ id: "shut", name: "The Shut Door", area: "Soho", closed: true }],
      national: [{ id: "closed", name: "The Closed Bell", area: "York", closed: true }],
    });

    expect(items.map((item) => item.state)).toEqual(["closed", "closed"]);
    expect(items[1]).toMatchObject({ venue: { layer: "national", price: null } });
  });

  it("exposes known closure on ambiguous candidates before the reader chooses", () => {
    const { items } = importPubList({ text: "The Crown" }, {
      curated: [
        { id: "open", name: "The Crown", area: "Soho" },
        { id: "closed", name: "The Crown", area: "Richmond", closed: true },
      ],
      national: [],
    });

    expect(items[0]).toMatchObject({ state: "ambiguous", candidates: [{ id: "open" }, { id: "closed", closed: true }] });
  });

  it("uses the curated layer first without treating its duplicate national record as another choice", () => {
    const { items } = importPubList({ text: "Harp" }, {
      curated: [{ id: "harp", name: "The Harp", area: "Covent Garden" }],
      national: [{ id: "osm-harp", name: "The Harp", area: "Covent Garden" }],
    });

    expect(items[0]).toMatchObject({ state: "matched", venue: { id: "harp", layer: "curated" } });
  });

  it("does not replace an ambiguous curated name with a unique national match", () => {
    const { items } = importPubList({ text: "Crown" }, {
      curated: [
        { id: "crown-soho", name: "The Crown", area: "Soho" },
        { id: "crown-richmond", name: "The Crown", area: "Richmond" },
      ],
      national: [{ id: "osm-crown", name: "The Crown", area: "York" }],
    });

    expect(items[0]).toMatchObject({ state: "ambiguous", candidateCount: 2 });
  });

  it.each([
    ["cheshire cheese", "Ye Olde Cheshire Cheese"],
    ["THE KING’S ARMS", "Kings Arms"],
    ["Coach & Horses", "The Coach and Horses"],
    ["St. John's", "St Johns"],
  ])("matches spelling variants %s and %s without fuzzy guesses", (text, name) => {
    const { items } = importPubList({ text }, { curated: [{ id: "pub", name, area: "London" }], national: [] });

    expect(items[0]).toMatchObject({ state: "matched", venue: { id: "pub" } });
  });

  it("retains duplicate pasted items while deduplicating repeated catalog identities", () => {
    const venue = { id: "harp", name: "The Harp", area: "Covent Garden" };
    const { items } = importPubList({ text: "The Harp\nThe Harp" }, { curated: [venue, venue], national: [] });

    expect(items.map((item) => item.state)).toEqual(["matched", "matched"]);
  });
});
