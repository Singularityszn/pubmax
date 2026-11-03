import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FSA_HYGIENE_PACK_TRACING_INCLUDE, OSM_FHRS_LINKS_TRACING_INCLUDE } from "@/lib/fsaHygienePackFile.mjs";
import { VENUE_RECORD_COPY_TRACING_INCLUDE } from "@/lib/venueRecordCopyFile.mjs";
import { VENUE_SITE_FACTS_TRACING_INCLUDE } from "@/lib/venueSiteFactsFile.mjs";
import { OSM_WIKIDATA_LINKS_TRACING_INCLUDE, WIKIDATA_HISTORY_PACK_TRACING_INCLUDE } from "@/lib/wikidataHistoryFile.mjs";
import type { Venue } from "@/lib/venues";

const read = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ readFile: read }));

beforeEach(() => {
  vi.resetModules();
  read.mockReset().mockRejectedValue(new Error("ENOENT"));
});

describe("server pack file contracts", () => {
  it("opens exactly the declared artifacts and fails closed when they are absent", async () => {
    const { packHygieneForVenue, linkedFhrsIdForVenue } = await import("@/lib/fsaHygienePack.server");
    const { packWikidataHistoryForVenue } = await import("@/lib/wikidataHistory.server");
    const { siteFactsForVenue } = await import("@/lib/venueSiteFacts.server");
    const { enrichVenueWithRecordCopy } = await import("@/lib/venueRecordCopy.server");
    const venue = { id: "venue-missing" } as Venue;
    expect(await packHygieneForVenue(venue.id)).toBeNull();
    expect(await linkedFhrsIdForVenue(venue.id)).toBeNull();
    expect(await packWikidataHistoryForVenue(venue.id)).toEqual([]);
    expect(await siteFactsForVenue(venue.id)).toBeNull();
    expect(await enrichVenueWithRecordCopy(venue)).toBe(venue);
    const expected = [OSM_FHRS_LINKS_TRACING_INCLUDE, FSA_HYGIENE_PACK_TRACING_INCLUDE,
      OSM_WIKIDATA_LINKS_TRACING_INCLUDE, WIKIDATA_HISTORY_PACK_TRACING_INCLUDE,
      VENUE_SITE_FACTS_TRACING_INCLUDE, VENUE_RECORD_COPY_TRACING_INCLUDE];
    expect(read.mock.calls).toEqual(expected.map((file) => [path.join(process.cwd(), file), "utf8"]));
  });
});
