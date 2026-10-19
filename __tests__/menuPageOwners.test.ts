import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MENU_OWNER_MAX_METRES,
  buildMenuPageOwners,
  menuOwnerVerdict,
  menuPageKey,
  readMenuPageOwners,
  venueKeyPoint,
} from "@/scripts/lib/menuPageOwners.mjs";

const ST_JAMES_MENU = "https://www.greeneking.co.uk/pubs/greater-london/golden-lion-st-james-s/menu";
const DEAN_STREET = { lat: 51.5125, lng: -0.13157 };
const KING_STREET = { lat: 51.5063153, lng: -0.1374883 };

const owners = buildMenuPageOwners({
  osmPubs: [
    {
      osmId: "node/675803384",
      name: "The Golden Lion",
      ...KING_STREET,
      website: "https://www.greeneking.co.uk/pubs/greater-london/golden-lion-st-james-s",
    },
    { osmId: "way/338696812", name: "Coach and Horses", lat: 51.5099, lng: -0.1449, website: null },
  ],
  placesVenues: [
    {
      venueId: "venue-osm-w338696812",
      websiteUri: {
        value: "https://www.greeneking.co.uk/pubs/greater-london/coach-and-horses?utm_source=g_places",
      },
    },
  ],
});

describe("menu page owners", () => {
  it("keys a page by host and path, without www, query, /menu or a trailing slash", () => {
    expect(menuPageKey(`${ST_JAMES_MENU}/?utm_source=x`)).toBe(
      "greeneking.co.uk/pubs/greater-london/golden-lion-st-james-s",
    );
    expect(menuPageKey("not a url")).toBeNull();
  });

  it("reads the point a venue key carries", () => {
    expect(venueKeyPoint("golden lion (soho)|51 dean street, w1d 5bh|51.51250|-0.13157")).toEqual(DEAN_STREET);
    expect(venueKeyPoint("no point here")).toBeNull();
  });

  it("calls the St James's menu another pub's menu at the Dean Street Golden Lion", () => {
    const verdict = menuOwnerVerdict(ST_JAMES_MENU, DEAN_STREET, owners);
    expect(verdict).toMatchObject({ verdict: "other-pub", owner: { name: "The Golden Lion", source: "osm" } });
    expect(verdict.verdict !== "owner-unknown" && verdict.metres).toBeGreaterThan(MENU_OWNER_MAX_METRES);
    expect(menuOwnerVerdict(ST_JAMES_MENU, KING_STREET, owners).verdict).toBe("same-pub");
  });

  it("places a Google Places website by the OSM point of the same pub", () => {
    const menu = "https://www.greeneking.co.uk/pubs/greater-london/coach-and-horses/menu";
    expect(menuOwnerVerdict(menu, { lat: 51.5149, lng: -0.13743 }, owners)).toMatchObject({
      verdict: "other-pub",
      owner: { source: "google-places" },
    });
  });

  it("says nothing about a page no pub states as its own", () => {
    expect(menuOwnerVerdict("https://example.org/menu", DEAN_STREET, owners)).toEqual({ verdict: "owner-unknown" });
    expect(menuOwnerVerdict(ST_JAMES_MENU, null, owners)).toEqual({ verdict: "owner-unknown" });
  });

  it("holds no published drink price row on a pub the menu does not belong to", () => {
    const committed = readMenuPageOwners(process.cwd());
    const { updates } = JSON.parse(
      readFileSync("public/data/drink_price_updates/latest.json", "utf8"),
    ) as { updates: Array<{ venueKey: string; source?: { url?: string } }> };
    const wrongPub = updates.filter(
      (row) => menuOwnerVerdict(row.source?.url, venueKeyPoint(row.venueKey), committed).verdict === "other-pub",
    );
    expect(wrongPub.map((row) => `${row.venueKey} <- ${row.source?.url}`)).toEqual([]);
  });
});
