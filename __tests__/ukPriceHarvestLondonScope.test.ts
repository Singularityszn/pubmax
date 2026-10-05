import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyMenuEnrichmentSeeds,
  filterHostEntriesToGreaterLondon,
} from "../scripts/harvest/uk-prices/londonScope.mjs";
import { isHarvestableOperatorUrl } from "@/lib/harvest/sourcePolicy";
import { defined } from "@/__tests__/helpers/defined";

describe("uk price harvest London scope", () => {
  it("keeps only pubs inside Greater London on each host", () => {
    const filtered = filterHostEntriesToGreaterLondon([
      {
        host: "example.com",
        origin: "https://example.com",
        pubs: [
          { lat: 51.5, lng: -0.12, name: "Central" },
          { lat: 53.48, lng: -2.24, name: "Manchester" },
        ],
      },
      {
        host: "north.com",
        origin: "https://north.com",
        pubs: [{ lat: 55.95, lng: -3.19, name: "Edinburgh" }],
      },
    ]);
    expect(filtered).toHaveLength(1);
    expect(defined(filtered[0]).pubs).toHaveLength(1);
    expect(defined(defined(filtered[0]).pubs[0]).name).toBe("Central");
  });

  it("seeds enrichment drink pages onto matching London hosts", () => {
    const hosts = [
      {
        host: "theeaglew12.co.uk",
        origin: "https://www.theeaglew12.co.uk",
        pubs: [{ lat: 51.5, lng: -0.24, name: "The Eagle" }],
        seedPages: [],
      },
    ];
    const coords = new Map([["venue-london", { lat: 51.5, lng: -0.24 }]]);
    const enrichmentPath = join(
      fileURLToPath(new URL("..", import.meta.url)),
      "public/data/venue_menu_enrichment.json",
    );
    const { seeded } = applyMenuEnrichmentSeeds(hosts, {
      enrichmentPath,
      coordsByVenueId: new Map([
        ...coords,
        ["venue-1hz0avt", { lat: 51.5, lng: -0.24 }],
      ]),
      isHarvestableOperatorUrl,
    });
    expect(seeded).toBeGreaterThan(0);
    expect(defined(hosts[0]).seedPages?.length).toBeGreaterThan(0);
  });
});
