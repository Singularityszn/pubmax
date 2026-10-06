import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/uk-base/[id]/route";
import { parseUkBaseRestoreResponse } from "@/components/map/pubmap/useUkBaseStreaming";
import { __resetMemorySavedPubs, memorySavedPubsStore } from "@/lib/savedPubsStore";
import { lookupUkBasePub, resetUkBaseIndexForTests } from "@/lib/ukBaseIndex";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { resolveStoredVenue } from "@/lib/venueIndex";
import { resolveWritableVenueId } from "@/lib/venueWriteTarget.server";
import {
  recordUkBaseVenueIdAliases,
  ukBaseIdDepartures,
} from "../scripts/lib/ukBaseVenueIdAliases.mjs";

// A `venue-uk-*` id is the pub's OSM ref, so the 6 October OpenStreetMap
// refresh dropped the ids of pubs OSM redrew as new objects and of pubs that
// left OSM. Pint drops, saved lists and crawl stories store the id they were
// written under, so every one of them must still land on the same pub, or on
// a record that says the pub may have closed.

const THE_BELL = { old: "venue-uk-n2245308130", current: "venue-uk-w1565157826" };
const CROSS_KEYS = "venue-uk-n1377230368";

function row(ref: string, name: string, lat: number, lng: number, address = ""): unknown[] {
  return [ref, name, address, lat, lng, ""];
}

describe("ukBaseIdDepartures", () => {
  it("follows a pub OSM redrew as a new object under its name within 50 m", () => {
    const node = row("n1", "The Bell", 51.5, -0.1);
    const way = row("w2", "The Bell", 51.5003, -0.1);
    expect(ukBaseIdDepartures([node], [way])).toMatchObject([
      { from: "venue-uk-n1", to: "venue-uk-w2" },
    ]);
  });

  it("names no successor for a same-named pub over 50 m away, or a different pub next door", () => {
    const node = row("n1", "The Bell", 51.5, -0.1);
    const far = row("w2", "The Bell", 51.5006, -0.1);
    const neighbour = row("w3", "The Crown", 51.5001, -0.1);
    expect(ukBaseIdDepartures([node], [far, neighbour])).toMatchObject([
      { from: "venue-uk-n1", to: null },
    ]);
  });

  it("records nothing for an id the next rows still serve, as a pub or as a bar", () => {
    const pub = row("n1", "abode", 55.96, -3.17);
    const bar = [...row("n1", "Leith Wine Bar", 55.96, -3.17), "bar"];
    expect(ukBaseIdDepartures([pub], [bar])).toEqual([]);
  });
});

describe("recordUkBaseVenueIdAliases", () => {
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
    await recordUkBaseVenueIdAliases(root, [bellNode, crossKeys, joes], [bellWay]);
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
    await recordUkBaseVenueIdAliases(root, [bellNode], [bellWay]);
    await recordUkBaseVenueIdAliases(root, [bellWay], [bellRelation]);
    expect(aliasDoc(root).aliases).toEqual({
      "venue-uk-n1": "venue-uk-r3",
      "venue-uk-w2": "venue-uk-r3",
    });
  });

  it("drops the alias and the tombstone of an id that comes back to OSM", async () => {
    const root = aliasRoot();
    await recordUkBaseVenueIdAliases(root, [bellNode, crossKeys], [bellWay]);
    await recordUkBaseVenueIdAliases(root, [bellWay], [bellWay, bellNode, crossKeys]);
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
