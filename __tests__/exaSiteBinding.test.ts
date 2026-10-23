// AN EXA WEBSITE REACHES A PRICE ONLY WHEN ITS OWN PAGE STATES THE PUB'S ADDRESS.
//
// Exa finds a namesake's site as readily as the pub's own: in the first pilot,
// the Joiners Arms in Morpeth answered for the one in Morecambe. The crawl
// therefore admits an Exa-found host only for a pub whose OSM tags state a
// postcode or a house number and street, and keeps its prices only when a page
// of the site states the same. These cases pin that rule and the candidate cut
// in scripts/harvest/uk-prices/exaSites.mjs.

import { describe, expect, it } from "vitest";

import { isHarvestableOperatorUrl } from "@/lib/harvest/sourcePolicy";

import {
  addExaSiteHosts,
  bindingFromAddressTags,
  canonicalPostcode,
  contactLinkCandidates,
  pageBindsPub,
  selectExaSiteCandidates,
  type CrawlHostEntry,
} from "../scripts/harvest/uk-prices/exaSites.mjs";

const LAMB_TAGS = {
  "addr:housenumber": "94",
  "addr:street": "Lamb's Conduit Street",
  "addr:postcode": "wc1n3lz",
};

describe("the address binding", () => {
  it("reads a postcode in its canonical form and refuses a partial one", () => {
    expect(canonicalPostcode("wc1n3lz")).toBe("WC1N 3LZ");
    expect(canonicalPostcode(" SW1A 1AA ")).toBe("SW1A 1AA");
    expect(canonicalPostcode("WC1N")).toBeNull();
  });

  it("needs a postcode or a house number with its street, never a street alone", () => {
    expect(bindingFromAddressTags(LAMB_TAGS)).toEqual({
      postcode: "WC1N 3LZ",
      streetAddress: "94 Lamb's Conduit Street",
    });
    expect(bindingFromAddressTags({ "addr:street": "High Street" })).toBeNull();
    expect(bindingFromAddressTags({})).toBeNull();
  });

  it("binds on the postcode with or without its space, inside markup", () => {
    const binding = bindingFromAddressTags(LAMB_TAGS);
    expect(pageBindsPub("<footer><p>London<br>WC1N&nbsp;3LZ</p></footer>", binding)).toBe(true);
    expect(pageBindsPub("<p>wc1n3lz</p>", binding)).toBe(true);
  });

  it("binds on the street address, written short or long", () => {
    const binding = { postcode: null, streetAddress: "94 Lamb's Conduit Street" };
    expect(pageBindsPub("<p>94 Lamb's Conduit St, London</p>", binding)).toBe(true);
    expect(pageBindsPub("<p>94, Lamb's Conduit Street</p>", binding)).toBe(true);
  });

  it("does not bind a namesake's page, a neighbouring postcode or a longer house number", () => {
    const binding = bindingFromAddressTags(LAMB_TAGS);
    expect(pageBindsPub("<p>The Lamb, 12 Market Place, LA4 5AB</p>", binding)).toBe(false);
    expect(pageBindsPub("<p>WC1N 3LZZ</p>", binding)).toBe(false);
    expect(pageBindsPub("<p>194 Lamb's Conduit Street</p>", binding)).toBe(false);
    expect(pageBindsPub("<p>anything</p>", null)).toBe(false);
  });

  it("finds same-origin contact pages and nothing off-site", () => {
    const html = `<a href="/contact-us">Contact</a><a href="https://maps.google.com/x">Find us</a>
      <a href="/menu">Menu</a><a href="/find-us">Getting here</a><a href="/visit">Visit us</a>`;
    expect(contactLinkCandidates(html, "https://thelamb.example", 2)).toEqual([
      "https://thelamb.example/contact-us",
      "https://thelamb.example/find-us",
    ]);
  });
});

describe("the candidate cut", () => {
  const seed = new Map([
    ["node/1", { name: "The Lamb", lat: 51.52, lng: -0.12, addressTags: LAMB_TAGS }],
    ["node/2", { name: "The Plough", lat: 51.5, lng: -0.1, addressTags: { "addr:street": "High Street" } }],
    ["node/3", { name: "Some Pub", lat: 51.5, lng: -0.1, addressTags: LAMB_TAGS }],
  ]);

  it("keeps a pub's own site with its address, and counts every other row by reason", () => {
    const { candidates, outcomes } = selectExaSiteCandidates(
      [
        { osmId: "node/1", osmRef: "n1", website: "https://www.thelamb.example/", menuUrl: "https://www.thelamb.example/drinks" },
        { osmId: "node/2", osmRef: "n2", website: "https://theplough.example/", menuUrl: null },
        { osmId: "node/3", osmRef: "n3", website: "https://www.useyourlocal.com/pubs/some-pub", menuUrl: null },
        { osmId: "node/4", osmRef: "n4", website: null, menuUrl: null },
      ],
      seed,
      { isHarvestableOperatorUrl },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      venueId: "venue-uk-n1",
      host: "thelamb.example",
      menuUrl: "https://www.thelamb.example/drinks",
      binding: { postcode: "WC1N 3LZ" },
    });
    expect(outcomes).toMatchObject({ candidate: 1, "no-address": 1, "not-a-pubs-own-host": 1, "no-site": 1 });
  });

  it("does not seed a menu page that sits on another host", () => {
    const { candidates } = selectExaSiteCandidates(
      [{ osmId: "node/1", osmRef: "n1", website: "https://thelamb.example/", menuUrl: "https://menus.example/lamb" }],
      seed,
      { isHarvestableOperatorUrl },
    );
    expect(candidates[0]?.menuUrl).toBeNull();
  });
});

describe("joining the crawl's host list", () => {
  const candidate = (osmId: string, host: string, menuUrl: string | null = null) => ({
    venueId: `venue-uk-${osmId}`,
    osmId,
    osmRef: osmId,
    name: osmId,
    lat: 51.5,
    lng: -0.1,
    host,
    siteUrl: `https://${host}/`,
    menuUrl,
    binding: { postcode: "WC1N 3LZ", streetAddress: null },
  });

  it("seeds a known host, adds a new one-pub host with its binding, and refuses a shared one", () => {
    const hosts: CrawlHostEntry[] = [{ host: "known.example", origin: "https://known.example", pubs: [] }];
    const counts = addExaSiteHosts(hosts, [
      candidate("n1", "known.example", "https://known.example/drinks"),
      candidate("n2", "new.example", "https://new.example/menu"),
      candidate("n3", "shared.example"),
      candidate("n4", "shared.example"),
    ]);
    expect(counts).toMatchObject({ seededOnKnownHost: 1, hostsAdded: 1, sharedHost: 2 });
    expect(hosts[0]?.seedPages).toEqual(["https://known.example/drinks"]);
    const added = hosts.find((entry) => entry.host === "new.example");
    expect(added).toMatchObject({ exaSite: true, seedPages: ["https://new.example/menu"] });
    expect(added?.pubs[0]).toMatchObject({ venueId: "venue-uk-n2", binding: { postcode: "WC1N 3LZ" } });
    expect(hosts.some((entry) => entry.host === "shared.example")).toBe(false);
  });

  it("never adds a source-table estate or a host already published", () => {
    const hosts: CrawlHostEntry[] = [];
    const counts = addExaSiteHosts(
      hosts,
      [candidate("n1", "pubs.greeneking.co.uk"), candidate("n2", "done.example")],
      { sourceTableHosts: ["www.greeneking.co.uk"], publishedHosts: new Set(["done.example"]) },
    );
    expect(counts).toMatchObject({ estateHost: 1, alreadyPublished: 1, hostsAdded: 0 });
    expect(hosts).toHaveLength(0);
  });
});

describe("an address stated in the site's own page data", () => {
  it("binds on a postcode a site builder states only in JSON-LD", () => {
    const html = `<script type="application/ld+json">{"address":{"postalCode":"BT21 0HE"}}</script><div id="app"></div>`;
    expect(pageBindsPub(html, { postcode: "BT21 0HE", streetAddress: null })).toBe(true);
  });
});

describe("a postcode kept in an attribute", () => {
  it("binds on a postcode a site states inside its own data attribute", () => {
    const html = `<div data-props="{&quot;addressLine2&quot;:&quot;Donaghadee, BT21 0HE&quot;}"></div>`;
    expect(pageBindsPub(html, { postcode: "BT21 0HE", streetAddress: null })).toBe(true);
  });
});
