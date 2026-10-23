import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { parseUkBaseRestoreResponse } from "@/components/map/pubmap/useUkBaseStreaming";
import { buildUkBasePubListModel } from "@/lib/mapVenueList";
import {
  UNNAMED_PUB_LABEL,
  parseUkBaseShard,
  parseUkBaseShardForEntry,
  ukBasePubFromFeature,
  ukBasePubsToGeoJSON,
} from "@/lib/ukBasePubs";
import type { UkBasePub } from "@/lib/ukBasePubs";
import { searchUkBasePubsByName } from "@/lib/ukBasePubSearch";
import { normalizeUnnamedOsmPubElement } from "../scripts/lib/osmPubNormalizer.mjs";
import { normalizeElements, normalizeUnnamedElements } from "../scripts/lib/ukOsmSeed.mjs";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "signed-in-drinker" },
    handle: "night_owl",
    identityResolved: true,
    loading: false,
    configured: true,
  }),
}));

const SHARD = {
  version: 1,
  cell: "c",
  pubs: [
    ["n1", "The Anchor", "1 Dock Road", 51.42, -0.18, ""],
    ["w2", "", "", 51.44, -0.12, ""],
    ["n3", "", "4 High Street, SW1A 1AA", 51.45, -0.05, "venue-owner"],
  ],
};

function unnamedPub(overrides: Partial<UkBasePub> = {}): UkBasePub {
  return {
    id: "venue-uk-w2",
    name: UNNAMED_PUB_LABEL,
    unnamed: true,
    address: "",
    lat: 51.44,
    lng: -0.12,
    curatedVenueId: "",
    kind: "pub",
    ...overrides,
  };
}

describe("a shard row with no name", () => {
  it("parses as an unnamed pub called Pub, with its stable id", () => {
    const pubs = parseUkBaseShard(SHARD);
    expect(pubs.map((pub) => pub.id)).toEqual(["venue-uk-n1", "venue-uk-w2", "venue-uk-n3"]);
    const bare = defined(pubs[1]);
    expect(bare).toMatchObject({ name: "Pub", unnamed: true, kind: "pub" });
    // A named pub's record is untouched: it carries no `unnamed` key at all.
    expect("unnamed" in defined(pubs[0])).toBe(false);
  });

  it("counts toward the manifest count, so a cell is not read as partial", () => {
    const entry = { id: "c", core: false, count: 3, url: "/data/uk_base/c.json", bbox: [-1, 51, 0, 52] as [number, number, number, number] };
    expect(parseUkBaseShardForEntry(SHARD, entry)).toHaveLength(3);
  });

  it("keeps an owner and an address on an unnamed pub", () => {
    const pub = defined(parseUkBaseShard(SHARD)[2]);
    expect(pub).toMatchObject({ curatedVenueId: "venue-owner", address: "4 High Street, SW1A 1AA" });
  });

  it("still refuses a bar with no name", () => {
    expect(parseUkBaseShard({ pubs: [["n9", "", "", 51.4, -0.1, "", "bar"]] })).toEqual([]);
  });
});

describe("the unnamed pub on the map and the restore route", () => {
  it("rides the map feature as `unnamed: true` and comes back out of it", () => {
    const pub = unnamedPub();
    const collection = ukBasePubsToGeoJSON([pub]);
    const feature = defined(collection.features[0]);
    expect(feature.properties).toMatchObject({ id: pub.id, name: "Pub", unnamed: true });
    expect(ukBasePubFromFeature(feature)).toEqual(pub);
  });

  it("leaves a named pub's feature with no `unnamed` property", () => {
    const named = { ...unnamedPub(), name: "The Anchor" } as UkBasePub;
    delete (named as { unnamed?: true }).unnamed;
    const feature = defined(ukBasePubsToGeoJSON([named]).features[0]);
    expect(feature.properties).not.toHaveProperty("unnamed");
  });

  it("survives the cold-restore route, so a saved unnamed pub reopens", () => {
    const pub = unnamedPub();
    expect(parseUkBaseRestoreResponse({ pub }, pub.id)).toEqual(pub);
  });
});

describe("an unnamed pub stays out of name surfaces", () => {
  it("is never a search result, even for the query `pub`", () => {
    const pubs = [unnamedPub(), { ...unnamedPub({ id: "venue-uk-n5" }), name: "The Pub Next Door", unnamed: undefined } as UkBasePub];
    for (const query of ["pub", "pu", "the pub"]) {
      const hits = searchUkBasePubsByName({
        pubs,
        query,
        userLocation: null,
        mapCenter: [-0.12, 51.44],
      });
      expect(hits.map((hit) => hit.id)).not.toContain("venue-uk-w2");
    }
  });

  it("is not a row in the unverified list, and does not count in its total", () => {
    const named: UkBasePub = { ...unnamedPub({ id: "venue-uk-n1" }), name: "The Anchor" };
    delete (named as { unnamed?: true }).unnamed;
    const model = buildUkBasePubListModel([unnamedPub(), named], [-0.12, 51.44]);
    expect(model.rows.map((row) => row.id)).toEqual(["venue-uk-n1"]);
    expect(model.total).toBe(1);
    expect(model.truncated).toBe(false);
  });
});

function stateFor(pub: UkBasePub): CommunityPricesState {
  return {
    byVenueId: new Map([[pub.id, []]]),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    noAlcoholIndexStatus: "idle",
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: () => {},
    loadVenue: () => {},
    venuePriceStatus: new Map([[pub.id, "ready"]]),
    loadNoAlcoholIndex: () => {},
    loadDrinkCategoryIndex: () => {},
    drinkCategoryIndexStatus: new Map(),
    submit: async () => ({ ok: true, attribution: { status: "anonymous" }, price: null, pintTrust: null, confirmationOutcome: null }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: () => {},
    reportedIds: new Set<string>(),
  };
}

describe("the unnamed pub's sheet", () => {
  const render = (pub: UkBasePub) =>
    renderToStaticMarkup(
      createElement(UnverifiedPubSheet, {
        pub,
        communityPrices: stateFor(pub),
        experienceLens: "all",
        drinkLensCategory: null,
      }),
    );

  it("says the name is not known yet, and still takes a price", () => {
    const html = render(unnamedPub());
    expect(html).toContain("unverifiedPubName");
    expect(html).toContain(">Pub</h2>");
    expect(html).toContain("We don’t know this pub’s name yet.");
    expect(html).toContain("Be the first");
  });

  it("says nothing of the sort on a named pub", () => {
    const named: UkBasePub = { ...unnamedPub(), name: "The Anchor" };
    delete (named as { unnamed?: true }).unnamed;
    expect(render(named)).not.toContain("name yet");
  });
});

describe("the nameless OSM pubs, from the raw elements", () => {
  const node = (id: number, tags: Record<string, string>, extra: Record<string, unknown> = {}) => ({
    type: "node",
    id,
    lat: 51.5,
    lon: -0.1,
    tags,
    ...extra,
  });

  it("keeps an amenity=pub with a position and no name, and nothing else of it", () => {
    expect(
      normalizeUnnamedOsmPubElement(node(7, { amenity: "pub", "addr:street": "High Street", "addr:postcode": "AB1 2CD" })),
    ).toEqual({
      osmId: "node/7",
      amenity: "pub",
      lat: 51.5,
      lng: -0.1,
      address: "High Street, AB1 2CD",
      postcode: "AB1 2CD",
    });
  });

  it("treats a blank name as no name, and a way's centre as its position", () => {
    const way = { type: "way", id: 9, center: { lat: 52, lon: -1 }, tags: { amenity: "pub", name: "  " } };
    expect(normalizeUnnamedOsmPubElement(way)).toMatchObject({ osmId: "way/9", lat: 52, lng: -1 });
  });

  it("refuses a named pub, a non-pub and a pub with no position", () => {
    expect(normalizeUnnamedOsmPubElement(node(1, { amenity: "pub", name: "The Anchor" }))).toBeNull();
    expect(normalizeUnnamedOsmPubElement(node(2, { amenity: "cafe" }))).toBeNull();
    expect(normalizeUnnamedOsmPubElement({ type: "node", id: 3, tags: { amenity: "pub" } })).toBeNull();
  });

  it("splits the pack cleanly: named stay in `pubs`, unnamed never do", () => {
    const elements = [
      node(1, { amenity: "pub", name: "The Anchor" }),
      node(2, { amenity: "pub" }),
      node(2, { amenity: "pub" }), // a shared chunk edge returns it twice
      node(3, { amenity: "pub", name: "" }),
    ];
    expect(normalizeElements(elements).map((pub) => pub.osmId)).toEqual(["node/1"]);
    expect(normalizeUnnamedElements(elements).map((pub) => pub.osmId)).toEqual(["node/2", "node/3"]);
  });
});

describe("the committed shards", () => {
  const root = path.resolve(__dirname, "..");
  const pack = JSON.parse(
    readFileSync(path.join(root, "data", "osm", "uk", "uk_osm_unnamed_pubs.json"), "utf8"),
  ) as { count: number; pubs: Array<Record<string, unknown>> };
  const manifest = JSON.parse(
    readFileSync(path.join(root, "public", "data", "uk_base", "manifest.json"), "utf8"),
  ) as { urlPrefix: string; generatedFrom: { unnamed: number }; shards: Array<{ id: string }> };
  const rows = manifest.shards.flatMap(
    (shard) =>
      (
        JSON.parse(
          readFileSync(path.join(root, "public", `${manifest.urlPrefix}${shard.id}.json`), "utf8"),
        ) as { pubs: unknown[][] }
      ).pubs,
  );
  const unnamedRows = rows.filter((row) => row[1] === "");

  it("holds a nameless pack that carries no name at all", () => {
    expect(pack.count).toBe(pack.pubs.length);
    expect(pack.count).toBeGreaterThan(250);
    for (const pub of pack.pubs) {
      expect(pub).not.toHaveProperty("name");
      expect(pub.amenity).toBe("pub");
    }
  });

  it("ships every pack pub as a stable venue-uk row, none of them in a name surface", () => {
    expect(manifest.generatedFrom.unnamed).toBe(pack.count);
    expect(unnamedRows).toHaveLength(pack.count);
    const shipped = new Set(unnamedRows.map((row) => `venue-uk-${row[0]}`));
    for (const pub of pack.pubs) {
      const [type, id] = String(pub.osmId).split("/");
      expect(shipped.has(`venue-uk-${String(type)[0]}${id}`)).toBe(true);
    }
    // Six elements, exactly as every other pub row: no reader learns a new shape.
    for (const row of unnamedRows) expect(row).toHaveLength(6);
  });
});
