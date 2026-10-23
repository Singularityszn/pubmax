import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  addCuratedLondonWebsiteHosts,
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

  describe("curated London websites as candidate hosts", () => {
    const curated = (pubName: string, website: string, latitude = 51.5424525, longitude = -0.0076175) => ({
      pub_name: pubName,
      address: `${pubName} Road, London`,
      latitude,
      longitude,
      website,
    });

    it("adds a curated venue's own website, attached to its curated id and position", () => {
      const hosts: Array<{ host: string; pubs: Array<Record<string, unknown>>; seedPages?: string[] }> = [];
      const counts = addCuratedLondonWebsiteHosts(hosts, {
        datasetRows: [
          curated("The Bat and Ball", "https://www.thebatandball.com/"),
          curated("Joyau", "https://joyau.co/london", 51.5554908, 0.0188248),
        ],
        isHarvestableOperatorUrl,
      });
      expect(counts).toMatchObject({ added: 2, hostsAdded: 2, refused: 0, alreadyCandidate: 0 });
      const bat = defined(hosts.find((entry) => entry.host === "thebatandball.com"));
      const pub = defined(bat.pubs[0]);
      expect(pub.venueId).toMatch(/^venue-[0-9a-z]+$/);
      expect(pub.venueId).not.toMatch(/^venue-uk-/);
      expect(pub).toMatchObject({ name: "The Bat and Ball", lat: 51.5424525, lng: -0.0076175, osmId: null });
      expect(bat.seedPages).toEqual([]);
      // A website naming one page on a host is opened first.
      expect(defined(hosts.find((entry) => entry.host === "joyau.co")).seedPages).toEqual(["https://joyau.co/london"]);
    });

    it("refuses an aggregator, a social page, a source-table estate host and a policy-refused host", () => {
      const hosts: Array<{ host: string; pubs: unknown[] }> = [];
      const counts = addCuratedLondonWebsiteHosts(hosts, {
        datasetRows: [
          curated("Aggregated", "https://www.pint-prices.com/pub/aggregated"),
          curated("Social", "https://www.facebook.com/somepub"),
          curated("Goldengrove", "https://www.jdwetherspoon.com/pubs/all-pubs/england/london/goldengrove-stratford"),
          curated("Api Spoons", "https://api.jdwetherspoon.com/pub/1"),
          curated("Nicholson's", "https://www.nicholsonspubs.co.uk/restaurants/london/somepub"),
        ],
        isHarvestableOperatorUrl,
        sourceTableHosts: ["jdwetherspoon.com"],
      });
      expect(counts).toMatchObject({ added: 0, refused: 5 });
      expect(hosts).toEqual([]);
    });

    it("does not duplicate a host the snapshot already carries, and ignores pubs outside London", () => {
      const hosts = [{ host: "thebatandball.com", origin: "https://thebatandball.com", pubs: [{ name: "The Bat and Ball" }] }];
      const counts = addCuratedLondonWebsiteHosts(hosts, {
        datasetRows: [
          curated("The Bat and Ball", "https://www.thebatandball.com/"),
          curated("Northern", "https://northernpub.co.uk/", 53.48, -2.24),
        ],
        isHarvestableOperatorUrl,
      });
      expect(counts).toMatchObject({ considered: 1, added: 0, alreadyCandidate: 1 });
      expect(hosts).toHaveLength(1);
      expect(defined(hosts[0]).pubs).toHaveLength(1);
    });

    it("attaches a venue once however many price rows the dataset holds for it", () => {
      const hosts: Array<{ host: string; pubs: unknown[] }> = [];
      const row = curated("Roof East", "https://www.roofeast.com/", 51.5418322, -0.0011827);
      const counts = addCuratedLondonWebsiteHosts(hosts, { datasetRows: [row, { ...row }], isHarvestableOperatorUrl });
      expect(counts.added).toBe(1);
      expect(defined(hosts[0]).pubs).toHaveLength(1);
    });
  });
});
