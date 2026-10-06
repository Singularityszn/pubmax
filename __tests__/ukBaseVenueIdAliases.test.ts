import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/uk-base/[id]/route";
import { parseUkBaseRestoreResponse } from "@/components/map/pubmap/useUkBaseStreaming";
import {
  __resetCommunityPrices,
  countCorroboratedCommunityCategories,
  findCommunityPriceObservation,
  listCommunityPriceObservations,
  readCommunityPriceCategoryIndex,
  readCommunityPricesWithStatus,
  readCommunityVenueSignalsWithStatus,
  readProvisionalCommunityPriceVenueIds,
  submitCommunityPrice,
  submitCommunityVenueSignal,
} from "@/lib/communityPriceStore";
import { __resetMemoryPriceTrustEvents, priceTrustEventStore } from "@/lib/priceTrustEventStore";
import { __resetMemorySavedPubs, memorySavedPubsStore } from "@/lib/savedPubsStore";
import { lookupUkBasePub, resetUkBaseIndexForTests } from "@/lib/ukBaseIndex";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { resolveStoredVenue } from "@/lib/venueIndex";
import { resolveWritableVenueId } from "@/lib/venueWriteTarget.server";
import {
  planUkBaseVenueIdAliases,
  writeUkBaseVenueIdAliases,
  ukBaseIdDepartures,
} from "../scripts/lib/ukBaseVenueIdAliases.mjs";

// A `venue-uk-*` id is the pub's OSM ref, so the 6 October OpenStreetMap
// refresh dropped the ids of pubs OSM redrew as new objects and of pubs that
// left OSM. Pint drops, saved lists and crawl stories store the id they were
// written under, so every one of them must still land on the same pub, or on
// a record that says the pub may have closed.

const THE_BELL = { old: "venue-uk-n2245308130", current: "venue-uk-w1565157826" };
const CROSS_KEYS = "venue-uk-n1377230368";
const THE_SPORTSMAN = { base: "venue-uk-n269255191", curated: "venue-sy8k64" };
const NO_CURATED = new Set<string>();

function row(
  ref: string,
  name: string,
  lat: number,
  lng: number,
  address = "",
  curatedVenueId = "",
): unknown[] {
  return [ref, name, address, lat, lng, curatedVenueId];
}

describe("ukBaseIdDepartures", () => {
  it("follows a pub OSM redrew as a new object under its name within 50 m", () => {
    const node = row("n1", "The Bell", 51.5, -0.1);
    const way = row("w2", "The Bell", 51.5003, -0.1);
    expect(ukBaseIdDepartures([node], [way], NO_CURATED)).toMatchObject([
      { from: "venue-uk-n1", to: "venue-uk-w2" },
    ]);
  });

  it("names no successor for a same-named pub over 50 m away, or a different pub next door", () => {
    const node = row("n1", "The Bell", 51.5, -0.1);
    const far = row("w2", "The Bell", 51.5006, -0.1);
    const neighbour = row("w3", "The Crown", 51.5001, -0.1);
    expect(ukBaseIdDepartures([node], [far, neighbour], NO_CURATED)).toMatchObject([
      { from: "venue-uk-n1", to: null },
    ]);
  });

  it("sends a row a still-listed curated venue owned to that venue, and only while it is listed", () => {
    const owned = row("n1", "The Sportsman", 51.54, 0.0, "", "venue-sy8k64");
    expect(ukBaseIdDepartures([owned], [], new Set(["venue-sy8k64"]))).toMatchObject([
      { from: "venue-uk-n1", to: "venue-sy8k64" },
    ]);
    expect(ukBaseIdDepartures([owned], [], NO_CURATED)).toMatchObject([
      { from: "venue-uk-n1", to: null },
    ]);
  });

  it("records nothing for an id the next rows still serve, as a pub or as a bar", () => {
    const pub = row("n1", "abode", 55.96, -3.17);
    const bar = [...row("n1", "Leith Wine Bar", 55.96, -3.17), "bar"];
    expect(ukBaseIdDepartures([pub], [bar], NO_CURATED)).toEqual([]);
  });
});

async function recordUkBaseVenueIdAliases(
  root: string,
  previousRows: unknown[][],
  nextRows: unknown[][],
  liveCuratedIds: ReadonlySet<string>,
): Promise<void> {
  const plan = await planUkBaseVenueIdAliases(root, previousRows, nextRows, liveCuratedIds);
  if (plan.doc) await writeUkBaseVenueIdAliases(root, plan.doc);
}

describe("planUkBaseVenueIdAliases and writeUkBaseVenueIdAliases", () => {
  function aliasRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), "uk-base-aliases-"));
    mkdirSync(path.join(root, "public", "data"), { recursive: true });
    writeFileSync(
      path.join(root, "public", "data", "uk_base_venue_id_aliases.json"),
      JSON.stringify({ version: 1, aliases: {}, retired: {} }),
    );
    return root;
  }

  function aliasDoc(root: string): { aliases: Record<string, string>; retired: Record<string, unknown> } {
    return JSON.parse(
      readFileSync(path.join(root, "public", "data", "uk_base_venue_id_aliases.json"), "utf8"),
    );
  }

  const bellNode = row("n1", "The Bell", 51.5, -0.1);
  const bellWay = row("w2", "The Bell", 51.5003, -0.1);
  const bellRelation = row("r3", "The Bell", 51.5002, -0.1);
  const crossKeys = row("n9", "Cross Keys", 51.36, -2.03, "High Street, SN10 2PN");
  const joes = row("n8", "Joe's Bar", 54.9, -6.9);

  it("aliases a re-mapped pub and tombstones a pub that left OSM", async () => {
    const root = aliasRoot();
    await recordUkBaseVenueIdAliases(root, [bellNode, crossKeys, joes], [bellWay], NO_CURATED);
    expect(aliasDoc(root)).toMatchObject({
      aliases: { "venue-uk-n1": "venue-uk-w2" },
      retired: {
        "venue-uk-n9": { name: "Cross Keys", area: "High Street, SN10 2PN", lat: 51.36, lng: -2.03 },
        "venue-uk-n8": { name: "Joe's Bar", area: "United Kingdom", lat: 54.9, lng: -6.9 },
      },
    });
  });

  it("re-points an alias whose target is itself re-mapped, so no reader follows a chain", async () => {
    const root = aliasRoot();
    await recordUkBaseVenueIdAliases(root, [bellNode], [bellWay], NO_CURATED);
    await recordUkBaseVenueIdAliases(root, [bellWay], [bellRelation], NO_CURATED);
    expect(aliasDoc(root).aliases).toEqual({
      "venue-uk-n1": "venue-uk-r3",
      "venue-uk-w2": "venue-uk-r3",
    });
  });

  it("drops the alias and the tombstone of an id that comes back to OSM", async () => {
    const root = aliasRoot();
    await recordUkBaseVenueIdAliases(root, [bellNode, crossKeys], [bellWay], NO_CURATED);
    await recordUkBaseVenueIdAliases(root, [bellWay], [bellWay, bellNode, crossKeys], NO_CURATED);
    expect(aliasDoc(root)).toMatchObject({ aliases: {}, retired: {} });
  });

  it("moves a retired id that gains an alias out of the retired records", async () => {
    const root = aliasRoot();
    await recordUkBaseVenueIdAliases(root, [bellNode], [], NO_CURATED);
    await recordUkBaseVenueIdAliases(root, [bellNode], [bellWay], NO_CURATED);
    expect(aliasDoc(root)).toEqual(
      expect.objectContaining({ aliases: { "venue-uk-n1": "venue-uk-w2" }, retired: {} }),
    );
  });

  it("plans the record without writing it, so a build can fail before it publishes", async () => {
    const root = aliasRoot();
    const plan = await planUkBaseVenueIdAliases(root, [bellNode], [bellWay], NO_CURATED);
    expect(plan.doc).toMatchObject({ aliases: { "venue-uk-n1": "venue-uk-w2" } });
    expect(aliasDoc(root)).toMatchObject({ aliases: {}, retired: {} });
  });

  it("fails on an alias file it cannot read, before anything is written", async () => {
    const root = aliasRoot();
    writeFileSync(path.join(root, "public", "data", "uk_base_venue_id_aliases.json"), "<<<<<<<");
    await expect(
      planUkBaseVenueIdAliases(root, [bellNode], [bellWay], NO_CURATED),
    ).rejects.toThrow();
  });

  it("fails, writing nothing, when a dropped id would resolve to nothing", async () => {
    const root = aliasRoot();
    const unnamed = row("n7", "", 51.5, -0.1);
    await expect(
      recordUkBaseVenueIdAliases(root, [unnamed, bellNode], [bellWay], NO_CURATED),
    ).rejects.toThrow("venue-uk-n7");
    expect(aliasDoc(root)).toMatchObject({ aliases: {}, retired: {} });
  });
});

describe("the committed UK base aliases", () => {
  beforeEach(() => {
    resetUkBaseIndexForTests();
    resetVenueAliasesForTests();
    __resetMemorySavedPubs();
  });

  it("opens an old id's shared link as the same pub under its current id", async () => {
    const lookup = await lookupUkBasePub(THE_BELL.old);
    expect(lookup.status === "ready" ? [lookup.pub.id, lookup.pub.name] : lookup).toEqual([
      THE_BELL.current,
      "The Bell",
    ]);

    const res = await GET(new Request(`http://localhost/api/uk-base/${THE_BELL.old}`), {
      params: Promise.resolve({ id: THE_BELL.old }),
    });
    expect(res.status).toBe(200);
    expect(parseUkBaseRestoreResponse(await res.json(), THE_BELL.old)).toMatchObject({
      id: THE_BELL.current,
      name: "The Bell",
    });
  });

  it("writes a price sent under an old id to the pub's current id", async () => {
    expect(await resolveWritableVenueId(THE_BELL.old, { pubsOnly: true })).toEqual({
      ok: true,
      venueId: THE_BELL.current,
    });
  });

  it("answers a saved pub stored under an old id under the pub's current id", async () => {
    await memorySavedPubsStore.toggleSaved({
      handle: "walker",
      venueId: THE_BELL.old,
      listType: "Want to Visit",
    });
    const read = await memorySavedPubsStore.readSaved({ handle: "walker" });
    expect(read.status === "ready" ? read.rows : []).toMatchObject([
      { venueId: THE_BELL.current, venueMapUrl: expect.stringContaining(THE_BELL.current) },
    ]);
  });

  it("names a retired pub's stored reference as that pub, noted as possibly closed", async () => {
    expect(await resolveStoredVenue(CROSS_KEYS)).toMatchObject({
      id: CROSS_KEYS,
      name: "Cross Keys",
      retired: true,
    });
    await memorySavedPubsStore.toggleSaved({
      handle: "walker",
      venueId: CROSS_KEYS,
      listType: "Want to Visit",
    });
    const read = await memorySavedPubsStore.readSaved({ handle: "walker" });
    expect(read.status === "ready" ? read.rows.map((saved) => saved.venueName) : []).toEqual([
      "Cross Keys (may have closed)",
    ]);
  });

  it("answers a curated-owned base id as its still-listed curated venue, open, and writable", async () => {
    expect(await resolveStoredVenue(THE_SPORTSMAN.base)).toMatchObject({
      id: THE_SPORTSMAN.curated,
      name: "The Sportsman",
    });
    expect((await resolveStoredVenue(THE_SPORTSMAN.base))?.retired).toBeUndefined();
    expect(await resolveWritableVenueId(THE_SPORTSMAN.base, { pubsOnly: true })).toEqual({
      ok: true,
      venueId: THE_SPORTSMAN.curated,
    });
  });

  it("lands no write and no map pin on a retired pub", async () => {
    expect((await lookupUkBasePub(CROSS_KEYS)).status).toBe("missing");
    expect((await resolveWritableVenueId(CROSS_KEYS)).ok).toBe(false);
  });
});

describe("parseUkBaseRestoreResponse", () => {
  const current = {
    id: THE_BELL.current,
    name: "The Bell",
    address: "",
    lat: 51.5,
    lng: -0.1,
    curatedVenueId: "",
  };

  it("accepts the successor only when the answer names the requested id as its former id", () => {
    expect(
      parseUkBaseRestoreResponse({ pub: current, formerId: THE_BELL.old }, THE_BELL.old),
    ).toMatchObject({ id: THE_BELL.current });
    expect(parseUkBaseRestoreResponse({ pub: current }, THE_BELL.old)).toBeNull();
    expect(
      parseUkBaseRestoreResponse({ pub: current, formerId: "venue-uk-n1" }, THE_BELL.old),
    ).toBeNull();
  });
});

describe("community reads follow a venue's former ids", () => {
  const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
  const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetVenueAliasesForTests();
    __resetCommunityPrices();
    __resetMemoryPriceTrustEvents();
  });

  afterEach(() => {
    __resetCommunityPrices();
    __resetMemoryPriceTrustEvents();
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it("serves a price stored under a former id on the pub's current id", async () => {
    await submitCommunityPrice(
      { venueId: THE_BELL.old, drinkCategory: "beer", priceGbp: 5.4, actor: "a" },
      1_000,
    );
    const read = await readCommunityPricesWithStatus(THE_BELL.current, 2_000);
    expect(read.prices).toMatchObject([
      { venueId: THE_BELL.current, drinkCategory: "beer", priceGbp: 5.4 },
    ]);
  });

  it("serves a venue signal stored under a former id on the pub's current id", async () => {
    await submitCommunityVenueSignal(
      { venueId: THE_BELL.old, signalKey: "character", signalValue: "rough", actor: "a" },
      1_000,
    );
    const read = await readCommunityVenueSignalsWithStatus(THE_BELL.current, 2_000);
    expect(read.signals).toMatchObject([
      { venueId: THE_BELL.current, signalKey: "character", signalValue: "rough" },
    ]);
  });

  it("marks the current pin provisional from a beer price stored under a former id", async () => {
    await submitCommunityPrice(
      { venueId: THE_BELL.old, drinkCategory: "beer", priceGbp: 5.4, actor: "a" },
      1_000,
    );
    await expect(
      readProvisionalCommunityPriceVenueIds([THE_BELL.current], 10_000),
    ).resolves.toEqual({ venueIds: [THE_BELL.current], degraded: false });
  });

  it("counts two drinkers under the old and the current id as one pub's corroboration", async () => {
    await submitCommunityPrice(
      { venueId: THE_BELL.old, drinkCategory: "beer", priceGbp: 5.4, actor: "a" },
      1_000,
    );
    await submitCommunityPrice(
      { venueId: THE_BELL.current, drinkCategory: "beer", priceGbp: 5.4, actor: "b" },
      2_000,
    );
    const read = await readCommunityPricesWithStatus(THE_BELL.old, 3_000);
    expect(read.prices).toHaveLength(1);
    expect(read.prices[0]).toMatchObject({ venueId: THE_BELL.current, corroborations: 2 });
  });

  async function twoDrinkersAcrossTheRemap(): Promise<void> {
    await submitCommunityPrice(
      { venueId: THE_BELL.old, drinkCategory: "beer", priceGbp: 5.4, actor: "a" },
      1_000,
    );
    await submitCommunityPrice(
      { venueId: THE_BELL.current, drinkCategory: "beer", priceGbp: 5.4, actor: "b" },
      2_000,
    );
  }

  it("publishes the map lens row under the current id, corroborated across both ids", async () => {
    await twoDrinkersAcrossTheRemap();
    const index = await readCommunityPriceCategoryIndex(["beer"], 3_000);
    expect(index.prices).toHaveLength(1);
    expect(index.prices[0]).toMatchObject({ venueId: THE_BELL.current, corroborations: 2 });
  });

  it("counts the remapped pub once in the corroborated roll-up", async () => {
    await twoDrinkersAcrossTheRemap();
    expect(await countCorroboratedCommunityCategories(3_000)).toMatchObject({ count: 1 });
  });

  it("hands the trust sync every observation of the pub, under its current id", async () => {
    await twoDrinkersAcrossTheRemap();
    const listed = await listCommunityPriceObservations(THE_BELL.current, "beer");
    expect(listed.observations.map((row) => [row.actor, row.venueId]).sort()).toEqual([
      ["a", THE_BELL.current],
      ["b", THE_BELL.current],
    ]);
    const oldRow = listed.observations.find((row) => row.actor === "a");
    const found = await findCommunityPriceObservation(oldRow?.id ?? "");
    expect(found.observation?.venueId).toBe(THE_BELL.current);
  });

  it("finds a trust event recorded under a former id from the pub's current id", async () => {
    await priceTrustEventStore().recordUnlock({
      fingerprint: "bell-before-refresh",
      venueId: THE_BELL.old,
      category: "beer",
      observationIds: ["obs-a", "obs-b"],
      userIds: [],
      now: 1_000,
    });
    const live = await priceTrustEventStore().liveEventsFor(THE_BELL.current, "beer");
    expect(live.events.map((event) => event.evidenceFingerprint)).toEqual([
      "bell-before-refresh",
    ]);
  });
});
