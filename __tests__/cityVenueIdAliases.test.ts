import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as POST_CRAWL } from "@/app/api/crawls/route";
import { cityVenueIdForPub } from "@/lib/cityVenueId.mjs";
import { __resetCrawlStories } from "@/lib/crawlStoryStore";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import type { PintDrop } from "@/lib/pintDropShared";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
import { canonicalizeSaved, type SavedPub } from "@/lib/savedPubs";
import { __resetMemorySavedPubs, memorySavedPubsStore } from "@/lib/savedPubsStore";
import { spoonsValueRowFor } from "@/lib/spoonsValue.server";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import { resetVenueAliasesForTests, setVenueAliasesPathForTests } from "@/lib/venueAliases";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { lookupCanonicalVenue, resolveVenue } from "@/lib/venueIndex";
import {
  mergeCityVenueIdAliases,
  mergeRetiredCityVenues,
  recordCityVenueIdAliases,
  retiredCityVenues,
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

describe("retiredCityVenues", () => {
  it("keeps a pub that left OSM with no successor under its own name, area and last point", () => {
    const closed = pub({ osmId: "node/307020647", name: "The Duck", lat: 52.471534, lng: -1.9396181 });
    const moved = pub({ osmId: "node/11371732533", name: "Hare & Hounds" });
    const movedOn = { ...moved, address: "106, High Street, Birmingham" };
    expect(
      retiredCityVenues({ id: "birmingham", displayName: "Birmingham" }, [closed, moved], [movedOn]),
    ).toEqual([
      {
        id: cityVenueIdForPub("birmingham", closed),
        name: "The Duck",
        area: "Birmingham",
        lat: 52.471534,
        lng: -1.9396181,
      },
    ]);
  });

  it("lets a retired pub that comes back to OSM leave the records", () => {
    const record = { name: "The Duck", area: "Birmingham", lat: 52.47, lng: -1.94 };
    expect(mergeRetiredCityVenues({ "venue-bhm-a": record }, [], new Set(["venue-bhm-a"]))).toEqual({});
  });
});

describe("recordCityVenueIdAliases", () => {
  const BIRMINGHAM = { id: "birmingham", displayName: "Birmingham" };
  const duck = pub({ osmId: "node/307020647", name: "The Duck", lat: 52.471534, lng: -1.9396181 });
  const crown = pub({ osmId: "node/2", name: "The Crown", lat: 52.49, lng: -1.88 });

  function aliasRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), "city-aliases-"));
    const dir = path.join(root, "public", "data", "cities");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "venue_id_aliases.json"), JSON.stringify({ version: 1, aliases: {} }));
    return root;
  }

  function retiredIn(root: string): Record<string, unknown> {
    return JSON.parse(
      readFileSync(path.join(root, "public", "data", "cities", "venue_id_aliases.json"), "utf8"),
    ).retired;
  }

  it("tombstones a pub that leaves OSM, and drops the tombstone when the same id returns", async () => {
    const root = aliasRoot();
    const duckId = String(cityVenueIdForPub("birmingham", duck));

    await recordCityVenueIdAliases(root, BIRMINGHAM, [duck, crown], [crown]);
    expect(retiredIn(root)).toEqual({
      [duckId]: { name: "The Duck", area: "Birmingham", lat: 52.471534, lng: -1.9396181 },
    });

    await recordCityVenueIdAliases(root, BIRMINGHAM, [crown], [duck, crown]);
    expect(retiredIn(root)).toEqual({});
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

  // A save written before the refresh, when no alias named the old id yet.
  async function saveBeforeTheRefresh(venueId: string): Promise<void> {
    const dir = mkdtempSync(path.join(tmpdir(), "no-aliases-"));
    const file = path.join(dir, "venue_id_aliases.json");
    writeFileSync(file, JSON.stringify({ aliases: {} }));
    setVenueAliasesPathForTests(file);
    await memorySavedPubsStore.toggleSaved({ handle: "brummie", venueId, listType: "Want to Visit" });
    resetVenueAliasesForTests();
  }

  afterEach(() => resetVenueAliasesForTests());

  it("answers a saved pub stored under the old id as the same pub under its current id", async () => {
    await saveBeforeTheRefresh(HARE_AND_HOUNDS.old);
    const read = await memorySavedPubsStore.readSaved({ handle: "brummie" });
    expect(read.status === "ready" ? read.rows : []).toMatchObject([
      {
        venueId: HARE_AND_HOUNDS.current,
        venueName: "Hare & Hounds",
        venueMapUrl: expect.stringContaining(HARE_AND_HOUNDS.current),
      },
    ]);
  });

  it("never saves the pub a second time from its current id, and unsaves the old save", async () => {
    await saveBeforeTheRefresh(HARE_AND_HOUNDS.old);
    expect(
      await memorySavedPubsStore.ensureSaved({
        handle: "brummie",
        profileId: "profile-brummie",
        venueId: HARE_AND_HOUNDS.current,
        listType: "Want to Visit",
      }),
    ).toEqual({ outcome: "already_saved" });
    const afterToggle = await memorySavedPubsStore.toggleSaved({
      handle: "brummie",
      venueId: HARE_AND_HOUNDS.current,
      listType: "Want to Visit",
    });
    expect(afterToggle).toEqual([]);
  });

  it("rewrites this device's saves under the current id, one save per list", () => {
    const saved: SavedPub[] = [
      { venueId: HARE_AND_HOUNDS.old, listType: "Want to Visit", savedAt: "2026-09-01T20:00:00.000Z" },
      { venueId: HARE_AND_HOUNDS.current, listType: "Want to Visit", savedAt: "2026-10-02T20:00:00.000Z" },
      { venueId: CHEMIC_TAVERN.old, listType: "Cheap Pint", savedAt: "2026-09-02T20:00:00.000Z" },
    ];
    const aliases = new Map([
      [HARE_AND_HOUNDS.old, HARE_AND_HOUNDS.current],
      [CHEMIC_TAVERN.old, CHEMIC_TAVERN.current],
    ]);
    expect(canonicalizeSaved(saved, (id) => aliases.get(id) ?? id)).toEqual([
      { venueId: HARE_AND_HOUNDS.current, listType: "Want to Visit", savedAt: "2026-09-01T20:00:00.000Z" },
      { venueId: CHEMIC_TAVERN.current, listType: "Cheap Pint", savedAt: "2026-09-02T20:00:00.000Z" },
    ]);
  });
});

describe("a pub that left OpenStreetMap is retired, never orphaned", () => {
  const HENMAN_AND_COOPER = "venue-bhm-y7p3wr";

  beforeEach(() => {
    __resetMemorySavedPubs();
  });

  it("resolves a tombstoned id to its own pub, in its own city, flagged as no longer listed", async () => {
    const venue = await resolveVenue(HENMAN_AND_COOPER);
    expect(venue).toMatchObject({
      id: HENMAN_AND_COOPER,
      name: "Henman & Cooper",
      borough: "Birmingham",
      retired: true,
    });
    expect(venue?.lat).toBeCloseTo(52.48057, 4);
    expect(venue?.lng).toBeCloseTo(-1.90132, 4);

    // A distinct status every reader treats as missing unless it opts in.
    const detail = await lookupVenueDetail(HENMAN_AND_COOPER);
    expect(detail.status === "retired" ? [detail.venue.name, detail.venue.retired] : null).toEqual([
      "Henman & Cooper",
      true,
    ]);
  });

  it("refuses to save a crawl naming it, like any id that is not a pub on the map", async () => {
    __resetCrawlStories();
    const stops = [HARE_AND_HOUNDS.current, HENMAN_AND_COOPER, CHEMIC_TAVERN.current];
    const saved = await POST_CRAWL(
      new Request("http://localhost/api/crawls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Brum and back",
          stops: stops.map((venueId) => ({ venueId, priceGbp: null })),
        }),
      }),
    );
    expect(saved.status).toBe(400);
  });

  it("answers reads only: no write can land on a pub the map no longer lists", async () => {
    expect((await lookupCanonicalVenue(HENMAN_AND_COOPER)).status).toBe("unknown");
  });

  it("names a save stored against it as that pub, noted once, never a London fallback", async () => {
    await memorySavedPubsStore.toggleSaved({
      handle: "brummie",
      venueId: HENMAN_AND_COOPER,
      listType: "Want to Visit",
    });
    const read = await memorySavedPubsStore.readSaved({ handle: "brummie" });
    expect(read.status === "ready" ? read.rows.map((row) => row.venueName) : []).toEqual([
      "Henman & Cooper (may have closed)",
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
