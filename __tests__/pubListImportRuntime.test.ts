import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({ read: vi.fn(), readSync: vi.fn() }));

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    promises: { ...actual.promises, readFile: files.read },
    readFileSync: files.readSync,
  };
});
vi.mock("@/data/places_verification/closed_pubs.json", () => ({
  default: { osmRefs: ["n3"], curatedVenueIds: ["venue-closed"] },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  files.read.mockResolvedValue(JSON.stringify({ rows: [
    {
      id: "venue-harp", name: "The Harp", borough: "Westminster", locality: "Covent Garden",
      lat: 51.509, lng: -0.126, cheapestPrice: 6,
      filterHints: { searchText: "The Harp, London WC2N 4HS" },
    },
  ] }));
  files.readSync.mockReturnValue(JSON.stringify({ pubs: [
    ["n1", "The Harp", "York, YO1 1AA", 53.96, -1.08],
    ["n2", "The Blue Bell", "York, YO1 1AA", 53.96, -1.08],
  ] }));
});

afterEach(() => vi.restoreAllMocks());

describe("pub list import with runtime venue data", () => {
  it("loads London first and keeps a national match unpriced without fetching", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed."));
    try {
      const { importPubList } = await import("@/lib/pubListImport.server");
      const { items } = await importPubList({ text: "The Harp\nThe Blue Bell\nThe Invented Arms" });

      expect(items).toMatchObject([
        { state: "matched", venue: { id: "venue-harp", area: "Covent Garden", layer: "curated" } },
        { state: "matched", venue: { id: "venue-uk-n2", layer: "national", price: null } },
        { state: "unmatched", name: "The Invented Arms" },
      ]);
      expect(fetch).not.toHaveBeenCalled();
      expect(files.read).toHaveBeenCalledTimes(1);
      expect(files.read.mock.calls[0]?.[0]).toMatch(/public\/data\/venues_slim\.json$/);
    } finally {
      fetch.mockRestore();
    }
  });

  it("keeps national ambiguity until an area or postcode selects one of all matches", async () => {
    files.readSync.mockReturnValue(JSON.stringify({ pubs: [
      ["n1", "The Blue Bell", "York, YO1 1AA", 53.96, -1.08],
      ["n2", "The Blue Bell", "Hull, HU1 1AA", 53.74, -0.33],
      ["n3", "The Blue Bell", "Leeds, LS1 1AA", 53.8, -1.55],
      ["n4", "The Blue Bell", "Durham, DH1 1AA", 54.78, -1.57],
      ["n5", "The Blue Bell", "Bath, BA1 1AA", 51.38, -2.36],
    ] }));
    const { importPubList } = await import("@/lib/pubListImport.server");
    const { items } = await importPubList({ text: "The Blue Bell\nThe Blue Bell, Bath\nThe Blue Bell, HU1" });

    expect(items).toMatchObject([
      { state: "ambiguous", candidateCount: 5 },
      { state: "matched", venue: { id: "venue-uk-n5", price: null } },
      { state: "matched", venue: { id: "venue-uk-n2", price: null } },
    ]);
    expect(items[0]?.state === "ambiguous" && items[0].candidates).toHaveLength(4);
  });

  it("marks verified closed curated and national pubs instead of hiding them", async () => {
    files.read.mockResolvedValue(JSON.stringify({ rows: [
      { id: "venue-closed", name: "The Closed Arms", borough: "Hackney", lat: 51.54, lng: -0.05 },
    ] }));
    files.readSync.mockReturnValue(JSON.stringify({ pubs: [
      ["n3", "The Closed Bell", "York, YO1 1AA", 53.96, -1.08],
    ] }));
    const { importPubList } = await import("@/lib/pubListImport.server");
    const { items } = await importPubList({ text: "The Closed Arms\nThe Closed Bell" });

    expect(items).toMatchObject([
      { state: "closed", venue: { id: "venue-closed", closed: true, layer: "curated" } },
      { state: "closed", venue: { id: "venue-uk-n3", closed: true, layer: "national", price: null } },
    ]);
  });

  it("uses curated locality, borough and postcode to resolve duplicate names", async () => {
    files.read.mockResolvedValue(JSON.stringify({ rows: [
      {
        id: "venue-soho", name: "The Crown", borough: "Westminster", locality: "Soho",
        lat: 51.51, lng: -0.13, filterHints: { searchText: "The Crown, W1D 1AA" },
      },
      { id: "venue-richmond", name: "The Crown", borough: "Richmond", lat: 51.46, lng: -0.3 },
    ] }));
    const { importPubList } = await import("@/lib/pubListImport.server");
    const { items } = await importPubList({ text: "The Crown\nThe Crown, Soho\nThe Crown, Westminster\nThe Crown, W1D" });

    expect(items).toMatchObject([
      { state: "ambiguous", candidateCount: 2 },
      { state: "matched", venue: { id: "venue-soho" } },
      { state: "matched", venue: { id: "venue-soho" } },
      { state: "matched", venue: { id: "venue-soho" } },
    ]);
  });

  it("cleans national operator suffixes without changing the pub identity", async () => {
    files.readSync.mockReturnValue(JSON.stringify({ pubs: [
      ["w9", "The Moon on the Hill - JD Wetherspoon", "Harrow, HA1 1AA", 51.58, -0.33],
    ] }));
    const { importPubList } = await import("@/lib/pubListImport.server");
    const { items } = await importPubList({ text: "Moon on the Hill\nInvented Arms" });

    expect(items[0]).toMatchObject({
      state: "matched", venue: { id: "venue-uk-w9", name: "The Moon on the Hill", price: null },
    });
  });

  it.each([{ rows: [] }, { rows: [{ id: "broken", name: "Missing position" }] }])(
    "refuses a curated catalogue with no usable venues: %j", async ({ rows }) => {
      files.read.mockResolvedValue(JSON.stringify({ rows }));
      const { importPubList } = await import("@/lib/pubListImport.server");

      await expect(importPubList({ text: "The Harp\nThe Blue Bell" }))
        .rejects.toThrow("The pub catalogue is unavailable. Try again.");
    },
  );

  it("retries an unavailable London catalogue without choosing a distant namesake", async () => {
    files.read.mockRejectedValueOnce(new Error("File unavailable."));
    const { importPubList } = await import("@/lib/pubListImport.server");

    await expect(importPubList({ text: "The Harp\nThe Blue Bell" }))
      .rejects.toThrow("The pub catalogue is unavailable. Try again.");
    expect((await importPubList({ text: "The Harp\nThe Blue Bell" })).items[0])
      .toMatchObject({ state: "matched", venue: { id: "venue-harp", layer: "curated" } });
  });

  it.each(["not json", JSON.stringify({ pubs: [] }), JSON.stringify({ pubs: [["n1", "The Harp"]] })])(
    "refuses an unusable national catalogue and retries its read: %s", async (payload) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      files.readSync.mockReturnValueOnce(payload);
      const { importPubList } = await import("@/lib/pubListImport.server");

      await expect(importPubList({ text: "The Harp\nThe Blue Bell" }))
        .rejects.toThrow("The pub catalogue is unavailable. Try again.");
      expect((await importPubList({ text: "The Harp\nThe Blue Bell" })).items[1])
        .toMatchObject({ state: "matched", venue: { id: "venue-uk-n2", price: null } });
    },
  );

  it("rejects invalid pasted input before reading either catalogue", async () => {
    const { importPubList } = await import("@/lib/pubListImport.server");

    await expect(importPubList({ text: "x".repeat(4001) })).rejects.toThrow(RangeError);
    await expect(importPubList({ text: "" })).rejects.toThrow(RangeError);
    await expect(importPubList({ text: "The Harp", sourceUrl: "http://localhost" })).rejects.toThrow(RangeError);
    expect(files.read).not.toHaveBeenCalled();
    expect(files.readSync).not.toHaveBeenCalled();
  });
});
