// A PAGE THAT NAMES ANOTHER BRANCH IS NOT THIS PUB'S PRICE.
//
// The crawl counted one pub on a host (`pubsOnHost: 1`) and gave that pub
// every page it read there. Found on 1 Nov 2026 while building the cheapest
// pint hunt: The Botanist Gas Street Basin (Birmingham) carried £4.95 read off
// the chain's Barnsley page, and Simmons in Camden carried prices read off the
// Shoreditch page. The ledger rows below are copied verbatim from
// data/uk_prices/site_harvest.jsonl, and the pub details are the OSM snapshot's
// own (data/osm/uk/uk_osm_pubs.json).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import {
  addSiteHarvestRows,
  osmPubIdentities,
  type SiteHarvestLaneReport,
} from "../scripts/build_uk_price_bundle.mjs";

const BOTANIST_BARNSLEY_PAGE = "https://thebotanist.uk.com/locations/barnsley/whats-on";
const SIMMONS_SHOREDITCH_PAGE = "https://www.simmonsbar.co.uk/venues/shoreditch-cocktail-bar/";

const BOTANIST = {
  host: "thebotanist.uk.com",
  venueId: "venue-uk-w118786967",
  osmId: "way/118786967",
  name: "The Botanist Gas Street Basin",
  postcode: "B1 2JR",
  lat: 52.4773823,
  lng: -1.9088528,
};

const SIMMONS = {
  host: "simmonsbar.co.uk",
  venueId: "venue-uk-w225442612",
  osmId: "way/225442612",
  name: "Simmons",
  postcode: "NW1 7JE",
  lat: 51.5347025,
  lng: -0.1392217,
};

/** The two wrong-branch cases, as the crawl wrote them. */
const WRONG_BRANCH_ROWS = [
  { ...BOTANIST, category: "beer", priceGbp: 4.95, sourceUrl: BOTANIST_BARNSLEY_PAGE, observedAt: "2026-09-04T13:57:40.885Z", pubsOnHost: 1, linesOnPage: 4, drinkLabel: "Pint of Pravha or Aspall Cyder" },
  { ...BOTANIST, category: "cocktail", priceGbp: 8.95, sourceUrl: BOTANIST_BARNSLEY_PAGE, observedAt: "2026-09-04T13:57:40.885Z", pubsOnHost: 1, linesOnPage: 4, drinkLabel: "Any classic cocktail for" },
  { ...SIMMONS, category: "beer", priceGbp: 4, sourceUrl: SIMMONS_SHOREDITCH_PAGE, observedAt: "2026-09-21T18:50:39.285Z", pubsOnHost: 1, linesOnPage: 4 },
  { ...SIMMONS, category: "cocktail", priceGbp: 18, sourceUrl: SIMMONS_SHOREDITCH_PAGE, observedAt: "2026-09-21T18:50:39.285Z", pubsOnHost: 1, linesOnPage: 4 },
  { ...SIMMONS, category: "wine", priceGbp: 3, sourceUrl: SIMMONS_SHOREDITCH_PAGE, observedAt: "2026-09-21T18:50:39.285Z", pubsOnHost: 1, linesOnPage: 4 },
];

/** Pages that are the pub's own, and must still publish. */
const OWN_PAGE_ROWS = [
  // Simmons' own home page names no branch.
  { ...SIMMONS, category: "wine", priceGbp: 3, sourceUrl: "https://www.simmonsbar.co.uk", observedAt: "2026-09-04T13:45:23.053Z", pubsOnHost: 1, linesOnPage: 4, drinkLabel: "Glasses of wine" },
  // The Botanist's own branch page, the one its OSM website tag states.
  { ...BOTANIST, category: "beer", priceGbp: 6.1, sourceUrl: "https://thebotanist.uk.com/locations/gas-street-basin-birmingham/drinks", observedAt: "2026-09-04T13:57:40.885Z", pubsOnHost: 1, linesOnPage: 4, drinkLabel: "Pint of Pravha" },
  // A chain path whose first segment is a county, then the pub.
  { host: "greeneking.co.uk", venueId: "venue-uk-n900001", osmId: "node/900001", name: "The Courthouse", postcode: null, lat: 51.5, lng: -3.5, category: "beer", priceGbp: 4.5, sourceUrl: "https://www.greeneking.co.uk/pubs/mid-glamorgan/court-house/menu", observedAt: "2026-09-21T10:00:00.000Z", pubsOnHost: 1, linesOnPage: 12, drinkLabel: "Greene King IPA" },
  // The snapshot renamed this pub after the crawl matched it; the name the
  // crawl matched still names the page.
  { host: "greeneking-pubs.co.uk", venueId: "venue-uk-n900002", osmId: "node/900002", name: "The Kings Arms", postcode: null, lat: 51.5, lng: -0.1, category: "beer", priceGbp: 6.2, sourceUrl: "https://www.greeneking-pubs.co.uk/pubs/surrey/kings-arms-mayfair/menu", observedAt: "2026-09-21T10:00:00.000Z", pubsOnHost: 1, linesOnPage: 12, drinkLabel: "Greene King IPA" },
];

const SNAPSHOT_PUBS = [
  { osmId: BOTANIST.osmId, name: BOTANIST.name, address: "12, Bridge Street, Birmingham, B1 2JR", locality: "Birmingham", postcode: BOTANIST.postcode, website: "https://thebotanist.uk.com/locations/gas-street-basin-birmingham" },
  { osmId: SIMMONS.osmId, name: SIMMONS.name, address: "7, Camden High Street, London, NW1 7JE", locality: "London", postcode: SIMMONS.postcode, website: "https://www.simmonsbar.co.uk/" },
  { osmId: "node/900002", name: "Three Jolly Butchers", address: null, locality: null, postcode: null, website: null },
];

function buildSiteHarvestLane(
  ledgerRows: ReadonlyArray<Record<string, unknown>>,
  pubIdentities?: ReturnType<typeof osmPubIdentities>,
) {
  const pushed: UkPriceBundleRow[] = [];
  const report: SiteHarvestLaneReport = { droppedRefusedHost: 0, droppedOtherBranch: 0, droppedUnresolvedVenue: 0 };
  addSiteHarvestRows(ledgerRows, {
    owners: new Map(),
    servedRefs: new Set(),
    push: (row) => pushed.push(row),
    report,
    ...(pubIdentities ? { pubIdentities } : {}),
  });
  return { pushed, report };
}

describe("the bundle builder's site-harvest lane, on a page that names another branch", () => {
  it("does not publish The Botanist Gas Street Basin's price off the Barnsley page", () => {
    const { pushed, report } = buildSiteHarvestLane(WRONG_BRANCH_ROWS.slice(0, 2), osmPubIdentities(SNAPSHOT_PUBS));
    expect(pushed.map((row) => row.sourceUrl)).not.toContain(BOTANIST_BARNSLEY_PAGE);
    expect(report.droppedOtherBranch).toBe(2);
  });

  it("does not publish Simmons Camden's prices off the Shoreditch page", () => {
    const { pushed, report } = buildSiteHarvestLane(WRONG_BRANCH_ROWS.slice(2), osmPubIdentities(SNAPSHOT_PUBS));
    expect(pushed.map((row) => row.sourceUrl)).not.toContain(SIMMONS_SHOREDITCH_PAGE);
    expect(report.droppedOtherBranch).toBe(3);
  });

  it("drops both cases on the row's own name when the snapshot does not hold the pub", () => {
    const { pushed, report } = buildSiteHarvestLane(WRONG_BRANCH_ROWS);
    expect(pushed).toEqual([]);
    expect(report.droppedOtherBranch).toBe(WRONG_BRANCH_ROWS.length);
  });

  it("still publishes a pub's own pages, its own branch page, a county-first chain path and a renamed pub's page", () => {
    const { pushed, report } = buildSiteHarvestLane(
      [...WRONG_BRANCH_ROWS, ...OWN_PAGE_ROWS],
      osmPubIdentities(SNAPSHOT_PUBS),
    );
    expect(pushed.map((row) => row.sourceUrl)).toEqual(OWN_PAGE_ROWS.map((row) => row.sourceUrl));
    expect(report).toEqual({ droppedRefusedHost: 0, droppedOtherBranch: WRONG_BRANCH_ROWS.length, droppedUnresolvedVenue: 0 });
  });
});

describe("the committed UK price bundle", () => {
  const rows = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as UkPriceBundleRow[];

  it("carries no price read off another branch's page for either known case", () => {
    const wrong = rows.filter(
      (row) => row.sourceUrl === BOTANIST_BARNSLEY_PAGE || row.sourceUrl === SIMMONS_SHOREDITCH_PAGE,
    );
    expect(wrong).toEqual([]);
  });

  it("keeps Simmons' price from its own home page", () => {
    expect(
      rows.some((row) => row.venueId === SIMMONS.venueId && row.sourceUrl === "https://www.simmonsbar.co.uk"),
    ).toBe(true);
  });
});
