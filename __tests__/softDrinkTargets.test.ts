import { describe, expect, it } from "vitest";

import {
  buildCuratedSoftDrinkTargets,
  selectCuratedSoftDrinkTargets,
} from "@/scripts/lib/softDrinkTargets.mjs";
import { defined } from "@/__tests__/helpers/defined";

const indexes = {
  idToKey: new Map([
    ["venue-london", "key-london"],
    ["venue-outside", "key-outside"],
    ["venue-duplicate", "key-duplicate"],
  ]),
  rowsByKey: new Map([
    ["key-london", { pub_name: "Canonical London Pub", latitude: 51.5, longitude: -0.1, primary_borough: "Camden" }],
    ["key-outside", { pub_name: "Bristol City Pub", latitude: 51.45, longitude: -2.6, primary_borough: "Bristol" }],
    ["key-duplicate", { pub_name: "Second Pub", latitude: 51.51, longitude: -0.11, primary_borough: "Camden" }],
  ]),
};

describe("curated soft-drink targets", () => {
  it("joins source records to canonical London venues, never page headings", () => {
    const targets = buildCuratedSoftDrinkTargets({
      chain: "youngs",
      indexes,
      inGreaterLondon: ({ lat, lng }: { lat: number; lng: number }) => lat > 51.4 && lng > -0.8 && lng < 0.4,
      enrichment: {
        venues: {
          "venue-london": { source: "youngs.co.uk", menuUrl: "https://www.canonicalpub.co.uk" },
          "venue-outside": { source: "youngs.co.uk", menuUrl: "https://www.bristolpub.co.uk" },
          "venue-duplicate": { source: "other-chain.co.uk", menuUrl: "https://www.otherpub.co.uk" },
        },
      },
    });
    expect(targets).toEqual([
      expect.objectContaining({
        url: "https://www.canonicalpub.co.uk/",
        pubName: "Canonical London Pub",
        venueId: "venue-london",
        venueKey: "key-london",
      }),
    ]);
  });

  it("drops ambiguous duplicate URL-to-venue joins", () => {
    const targets = buildCuratedSoftDrinkTargets({
      chain: "youngs",
      indexes: {
        ...indexes,
        idToKey: new Map([
          ["venue-london", "key-london"],
          ["venue-duplicate", "key-duplicate"],
        ]),
      },
      inGreaterLondon: () => true,
      enrichment: {
        venues: {
          "venue-london": { source: "youngs.co.uk", menuUrl: "https://www.samehost.co.uk" },
          "venue-duplicate": { source: "youngs.co.uk", menuUrl: "https://www.samehost.co.uk/home" },
        },
      },
    });
    expect(targets).toHaveLength(0);
  });

  it("lets an explicit URL file select only exact curated targets", () => {
    const targets = [{
      url: "https://www.canonicalpub.co.uk/",
      pubName: "Canonical Pub",
      venueId: "venue-london",
      venueKey: "key-london",
      locality: "Camden",
      host: "canonicalpub.co.uk",
    }];
    expect(
      selectCuratedSoftDrinkTargets(targets, {
        urlsFileText: `${defined(targets[0]).url}\n`,
        limit: 1,
      }),
    ).toEqual(targets);
    expect(() =>
      selectCuratedSoftDrinkTargets(targets, {
        urlsFileText: "https://other-chain.example/menus/soho.pdf",
      }),
    ).toThrow(/no exact curated London venue binding/);
  });

  it("refuses malformed override entries and invalid limits", () => {
    expect(() => selectCuratedSoftDrinkTargets([], { urlsFileText: "ftp://example.com/menu" })).toThrow(
      /invalid --urls-file URL/,
    );
    expect(() => selectCuratedSoftDrinkTargets([], { limit: 0 })).toThrow(/positive integer/);
  });
});
