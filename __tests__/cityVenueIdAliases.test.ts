import { beforeEach, describe, expect, it } from "vitest";

import { cityVenueIdForPub } from "@/lib/cityVenueId.mjs";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import type { PintDrop } from "@/lib/pintDropShared";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
import { __resetMemorySavedPubs, memorySavedPubsStore } from "@/lib/savedPubsStore";
import { spoonsValueRowFor } from "@/lib/spoonsValue.server";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import {
  mergeCityVenueIdAliases,
  supersededCityVenueIds,
} from "../scripts/lib/cityVenueIdAliases.mjs";

// A city venue id is a hash of the pub's name, address and point, so the
// 2 October OpenStreetMap refresh gave 27 Birmingham pubs and 2 Leeds pubs new
// ids. Pint drops, saved lists and crawl stories store the id they were written
// under, and the price lanes pin the id the pub carried when they were built.
// Every one of them must still land on the same pub.

const HARE_AND_HOUNDS = { old: "venue-bhm-3jmhdr", current: "venue-bhm-qvyo46" };
const CHEMIC_TAVERN = { old: "venue-lds-rpafnw", current: "venue-lds-tn7nip" };
const ELIZABETH_OF_YORK = { old: "venue-bhm-275a21", current: "venue-bhm-1whwlul" };

function pub(overrides: Record<string, unknown>) {
  return {
    osmId: "node/1",
    name: "The Crown",
    address: "",
    lat: 52.48,
    lng: -1.9,
    ...overrides,
  };
}

describe("supersededCityVenueIds", () => {
  it("follows the same OSM object to the id its edited address gives it", () => {
    const before = pub({ osmId: "node/11371732533", name: "Hare & Hounds" });
    const after = pub({ osmId: "node/11371732533", name: "Hare & Hounds", address: "106, High Street, Birmingham" });
    expect(supersededCityVenueIds("birmingham", [before], [after])).toEqual([
      {
        from: cityVenueIdForPub("birmingham", before),
        to: cityVenueIdForPub("birmingham", after),
      },
    ]);
  });

  it("follows a pub OSM redrew as a new object under its name, close by", () => {
    const node = pub({ osmId: "node/127960333", name: "The Chemic Tavern", lat: 53.8145142, lng: -1.552881 });
    const way = pub({ osmId: "way/469777916", name: "The Chemic Tavern", lat: 53.81452, lng: -1.55289 });
    expect(supersededCityVenueIds("leeds", [node], [way])).toEqual([
      { from: cityVenueIdForPub("leeds", node), to: cityVenueIdForPub("leeds", way) },
    ]);
  });

  it("names no successor for a pub that left OSM, or for a different pub next door", () => {
    const closed = pub({ osmId: "node/2526028748", name: "Henman & Cooper" });
    const neighbour = pub({ osmId: "node/7879853757", name: "The Colmore", lat: 52.48016 });
    expect(supersededCityVenueIds("birmingham", [closed], [neighbour])).toEqual([]);
  });

  it("records nothing when the id did not move", () => {
    const same = pub({ name: "The Crown" });
    expect(supersededCityVenueIds("birmingham", [same], [{ ...same }])).toEqual([]);
  });
});

describe("mergeCityVenueIdAliases", () => {
  it("re-points an alias whose target is itself superseded, so no reader follows a chain", () => {
    expect(
      mergeCityVenueIdAliases({ "venue-bhm-a": "venue-bhm-b" }, [{ from: "venue-bhm-b", to: "venue-bhm-c" }]),
    ).toEqual({ "venue-bhm-a": "venue-bhm-c", "venue-bhm-b": "venue-bhm-c" });
  });
});

describe("a superseded city id still names the same pub", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __resetPintDrops();
    __resetMemorySavedPubs();
  });

  it("resolves through the venue lookup every stored reference is read by", async () => {
    for (const [ids, name] of [
      [HARE_AND_HOUNDS, "Hare & Hounds"],
      [CHEMIC_TAVERN, "The Chemic Tavern"],
      [ELIZABETH_OF_YORK, "The Elizabeth of York"],
    ] as const) {
      const lookup = await lookupCanonicalVenue(ids.old);
      expect(lookup.status).toBe("found");
      expect(lookup.canonicalId).toBe(ids.current);
      expect(lookup.status === "found" ? lookup.venue.name : null).toBe(name);
    }
  });

  it("finds a pint drop stored under the old id from the pub's current id, public and legacy", async () => {
    const stored: PintDrop = {
      id: "drop-before-refresh",
      venueId: CHEMIC_TAVERN.old,
      handle: "loiner",
      drink: "John Smith's",
      priceGbp: 3.8,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      visibility: "public",
      createdAt: "2026-09-20T20:00:00.000Z",
    };
    addPintDrop(stored);
    addPintDrop({ ...stored, id: "legacy-before-refresh", visibility: "legacy" });

    const visible = await memoryPintDropStore.listVisible(CHEMIC_TAVERN.current);
    expect(visible.map((drop) => drop.id)).toContain("drop-before-refresh");
    const legacy = await memoryPintDropStore.listLegacyForVenue(CHEMIC_TAVERN.current);
    expect(legacy.map((drop) => drop.id)).toEqual(["legacy-before-refresh"]);
  });

  it("names and links a saved pub stored under the old id as the same pub", async () => {
    await memorySavedPubsStore.toggleSaved({
      handle: "brummie",
      venueId: HARE_AND_HOUNDS.old,
      listType: "Want to Visit",
    });
    const read = await memorySavedPubsStore.readSaved({ handle: "brummie" });
    expect(read).toMatchObject({ status: "ready" });
    expect(read.status === "ready" ? read.rows : []).toMatchObject([
      {
        // The stored identity, which is what a toggle removes the save by.
        venueId: HARE_AND_HOUNDS.old,
        venueName: "Hare & Hounds",
        venueMapUrl: expect.stringContaining(HARE_AND_HOUNDS.current),
      },
    ]);
  });
});

describe("the price lanes pin the refreshed ids", () => {
  it("serves The Chemic Tavern's own listed prices on its current Leeds id", async () => {
    const current = await ukPriceBundleRowsFor(CHEMIC_TAVERN.current);
    expect(current.status).toBe("ready");
    expect(
      current.rows
        .filter((row) => row.lane === "site-harvest")
        .map((row) => [row.category, row.priceGbp, row.sourceUrl]),
    ).toEqual([
      ["beer", 3.8, "https://chemictavern.co.uk/drinks/"],
      ["shot", 3.3, "https://chemictavern.co.uk/drinks/"],
    ]);
    expect((await ukPriceBundleRowsFor(CHEMIC_TAVERN.old)).rows).toEqual([]);
  });

  it("serves The Elizabeth of York's SpoonMe value on its current Birmingham id", async () => {
    const current = await spoonsValueRowFor(ELIZABETH_OF_YORK.current);
    expect(current.row?.name).toBe("The Elizabeth of York");
    expect((await spoonsValueRowFor(ELIZABETH_OF_YORK.old)).row).toBeNull();
    // The pin moved; the day SpoonMe was read did not.
    expect(current.credit?.retrievedAt).toBe("2026-09-06T21:31:45.000Z");
  });
});
