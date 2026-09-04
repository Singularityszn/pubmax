// WHAT `harvest_venue_overlays.menu_url` HOLDS, AND WHAT THE CRAWL MAY DO WITH IT.
//
// The overlay table (migration 0123) was the last source named in the price
// brief that nothing read. It records, per OSM pub, the https menu page that
// pub's own site states, which is exactly the kind of first-party page the UK
// price crawl exists to read.
//
// MEASURED 2026-09-04 against production (project iankajxliutqogqkmvdg, read
// only): `public.harvest_venue_overlays` holds 0 rows. The table is live and the
// migration is applied; the fold that fills it (`npm run harvest:fold`) has
// never been run against production, so there are no menu URLs to read and the
// coverage delta from this source today is exactly zero rows and zero pubs.
//
// The temptation that finding creates is to type some menu URLs in by hand so
// the lane has something to do. This file forbids that the way
// `__tests__/cityEstimateSupply.test.ts` forbids seeding a region: an input row
// must have come from the table, must survive the permission gate, and must name
// a pub. THE ALARM is the last case below, which fails the day the fold really
// runs, so the coverage claim is remeasured in the same commit rather than a
// release later.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isHarvestableOperatorUrl } from "@/lib/harvest/sourcePolicy";

import {
  crawlableOverlayMenuUrls,
  selectMenuUrls,
  ukBaseVenueId,
} from "../scripts/harvest/uk-prices/menu-urls.mjs";

const ROOT = process.cwd();
const INPUT_PATH = "data/uk_prices/overlay_menu_urls.json";

const input = JSON.parse(readFileSync(join(ROOT, INPUT_PATH), "utf8"));

describe("the committed overlay menu-url input", () => {
  it("says which table it was cut from, when, and through which door", () => {
    expect(input.version).toBe(1);
    expect(input.source).toContain("harvest_venue_overlays");
    // A file that records a day somebody looked owes the reader the door they
    // looked through, because a service-role read and a session read are two
    // different claims about who took the answer.
    expect(["service-role-rest", "supabase-mcp-session"]).toContain(input.readVia);
    expect(Number.isFinite(Date.parse(input.readAt))).toBe(true);
  });

  it("counts every overlay row somewhere, so a drop is never silent", () => {
    const accounted =
      input.counts.usable +
      input.counts["no-menu-url"] +
      input.counts["policy-refused-host"] +
      input.counts["unparseable-url"];
    expect(accounted).toBe(input.counts.overlayRows);
    expect(input.counts.usable).toBe(input.urls.length);
  });

  it("holds no URL that was not read out of the table", () => {
    // Every row carries the OSM identity the overlay keys on. A hand-typed URL
    // has no OSM id to carry, which is what makes this checkable rather than a
    // matter of trust.
    for (const target of input.urls) {
      expect(typeof target.osmId).toBe("string");
      expect(target.osmId).toMatch(/^(node|way|relation)\/\d+$/);
      expect(target.venueId).toBe(ukBaseVenueId(target.osmRef));
      expect(target.menuUrl.startsWith("https://")).toBe(true);
    }
  });
});

describe("the permission gate over an overlay menu url", () => {
  it("drops a refused host before a URL is ever written down, and counts it", () => {
    const refused = "https://www.nicholsonspubs.co.uk/pub/one/menu";
    // The premise: this host really is refused on permission today. If that ever
    // changes, this expectation says so rather than the test quietly passing on
    // a URL nothing refuses.
    expect(isHarvestableOperatorUrl(refused)).toBe(false);

    const { targets, outcomes, refusedHosts } = selectMenuUrls([
      { osm_id: "node/1", osm_ref: "n1", menu_url: refused },
      { osm_id: "node/2", osm_ref: "n2", menu_url: "https://example-freehouse.co.uk/drinks" },
      { osm_id: "node/3", osm_ref: "n3", menu_url: null },
      { osm_id: "node/4", osm_ref: "n4", menu_url: "not a url" },
    ]);

    expect(targets.map((target) => target.menuUrl)).toEqual([
      "https://example-freehouse.co.uk/drinks",
    ]);
    expect(outcomes).toEqual({
      usable: 1,
      "no-menu-url": 1,
      "policy-refused-host": 1,
      "unparseable-url": 1,
    });
    expect(refusedHosts["nicholsonspubs.co.uk"]).toBe(1);
  });

  it("is asked AGAIN on the way out, because the committed file may be stale", () => {
    // The file is committed, so it can be older than the table it was cut from
    // and older than the source policy. A host refused since it was written is
    // dropped here rather than fetched on the strength of a stale answer.
    const stale = {
      version: 1,
      urls: [
        { osmId: "node/1", osmRef: "n1", venueId: "venue-uk-n1", host: "example-freehouse.co.uk", menuUrl: "https://example-freehouse.co.uk/drinks" },
        { osmId: "node/2", osmRef: "n2", venueId: "venue-uk-n2", host: "nicholsonspubs.co.uk", menuUrl: "https://www.nicholsonspubs.co.uk/pub/two/menu" },
      ],
    };
    expect(crawlableOverlayMenuUrls(stale).map((target) => target.osmId)).toEqual(["node/1"]);
  });

  it("answers nothing for an input nobody has cut, rather than throwing", () => {
    expect(crawlableOverlayMenuUrls(null)).toEqual([]);
    expect(crawlableOverlayMenuUrls({ version: 1 })).toEqual([]);
  });
});

describe("the supply this source actually holds", () => {
  // THE ALARM. Zero rows is a fact about the fold never having run, not about
  // pubs having no menus. The day `npm run harvest:fold` runs against
  // production, this fails, and the person who ran it re-measures the coverage
  // delta and rewrites the claim in AGENTS.md in the same commit.
  it("is zero today, and says so the day the fold fills the table", () => {
    expect(input.counts.overlayRows).toBe(0);
    expect(input.urls).toEqual([]);
    expect(input.counts.usable).toBe(0);
  });
});
