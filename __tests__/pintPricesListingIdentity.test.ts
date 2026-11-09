// A pint-prices row is re-read against the listing page its price came from.
//
// The venue canonicalizer rewrites a merged row's name, address and point to
// the canonical pub and leaves `pub_url` alone. Two pint-prices listings at one
// point then display as one pub, and a refresh that matched by the display name
// gave each merged row the canonical listing's price. The four cases are the
// published rows the 2026-11-09 re-read found wrong.

import { describe, expect, it } from "vitest";

import type { HarvestSource } from "@/lib/harvest/sourcePolicy";

import { attachMatchedListings, type PintPricesListing } from "../scripts/lib/pintPricesListings.mjs";
import {
  collect as collectPintPrices,
  freshPriceFor,
  PINT_PRICES_SOURCE_ID,
} from "../scripts/refresh_pint_price_observations.mjs";

const ORIGIN = "https://www.pint-prices.com";
const SITEMAP = `${ORIGIN}/static/sitemap.xml`;
const BOROUGH = `${ORIGIN}/borough-results/Camden`;

const ROW: HarvestSource = {
  id: PINT_PRICES_SOURCE_ID,
  label: "test-only row",
  url: `${ORIGIN}/`,
  kind: "chain-menu-prices",
  firstParty: false,
  nonFirstPartyException: "test-only: stated pint prices, nothing else",
  access: { allowed: true, evidence: "test", checkedOn: "2026-11-09" },
  notes: "test-only",
};

type Listing = { name: string; address: string; pint: string; price: string };

/** Each case: the merged row's own listing, and the canonical listing it now displays as. */
const CASES: { own: Listing; canonical: Listing; ownUrl: string; expected: number; published: number }[] = [
  {
    own: { name: "Red Lion", address: "1 Eldon Street, EC2M 7LS", pint: "Amstel", price: "6.15" },
    canonical: { name: "Red Lion (Moorgate)", address: "1 Eldon Street, , Moorgate, England", pint: "Amstel", price: "6.40" },
    ownUrl: `${ORIGIN}/pub/1%20Eldon%20Street,%20EC2M%207LS/Red%20Lion`,
    expected: 6.15,
    published: 6.4,
  },
  {
    own: {
      name: "The Rochester Castle - JD Wetherspoon",
      address: "143-145 Stoke Newington High St, London N16 0NY, UK",
      pint: "Bud Light",
      price: "2.43",
    },
    canonical: {
      name: "The Rochester Castle",
      address: "143-145 Stoke Newington High Street, , Stoke Newington, England",
      pint: "Bud Light",
      price: "1.99",
    },
    ownUrl: `${ORIGIN}/pub/143-145%20Stoke%20Newington%20High%20St,%20London%20N16%200NY,%20UK/The%20Rochester%20Castle%20-%20JD%20Wetherspoon`,
    expected: 2.43,
    published: 1.99,
  },
  {
    own: { name: "The Earls Court Tavern", address: "123 Earls Court Rd, London SW5 9RL", pint: "Estrella", price: "6.70" },
    canonical: { name: "Earls Court Tavern", address: "123 Earls Court Road, SW5 9RL", pint: "Estrella", price: "7.15" },
    ownUrl: `${ORIGIN}/pub/123%20Earls%20Court%20Rd,%20London%20SW5%209RL/The%20Earls%20Court%20Tavern`,
    expected: 6.7,
    published: 7.15,
  },
  {
    own: { name: "The Fox On The Green", address: "1 Islington Grn, London N1 2XA", pint: "Amstel", price: "5.90" },
    canonical: {
      name: "Fox on the green",
      address: "1 Islington Grn, London N1 2XH, Reino Unido",
      pint: "Amstel",
      price: "6.25",
    },
    ownUrl: `${ORIGIN}/pub/1%20Islington%20Grn,%20London%20N1%202XA/The%20Fox%20On%20The%20Green`,
    expected: 5.9,
    published: 6.25,
  },
];

function boroughPage(listings: Listing[]): string {
  const pubsData = Object.fromEntries(
    listings.map((listing, index) => [
      `pub${index}`,
      { name: listing.name, address: listing.address, latitude: 51.5, longitude: -0.1, pints: [[listing.pint, listing.price]] },
    ]),
  );
  return `<html><script>\nvar pubsData = ${JSON.stringify(pubsData)};\n</script></html>`;
}

function page(body: string, url: string, type = "text/html"): Response {
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-type": type }),
    body: null,
    text: async () => body,
  } as unknown as Response;
}

async function observe(listings: Listing[]) {
  const pages: Record<string, string> = {
    [SITEMAP]: `<urlset><url><loc>${BOROUGH}</loc></url></urlset>`,
    [BOROUGH]: boroughPage(listings),
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = pages[url];
    if (body === undefined) throw new Error(`unexpected fetch ${url}`);
    return page(body, url, url === SITEMAP ? "application/xml" : "text/html");
  }) as typeof fetch;
  const allow = async (url: string) => ({ allowed: true, reason: "allowed", evidence: url });
  return (await collectPintPrices({ source: ROW, fetchImpl, robots: allow, sleepImpl: async () => {} }))
    .observations;
}

describe("pint-prices refresh: a merged row keeps its own listing's price", () => {
  it.each(CASES)("$own.name $own.pint reads £$expected from its own page, not £$published", async (example) => {
    const observations = await observe([example.own, example.canonical]);
    // The row as published: the canonicalizer gave it the canonical listing's
    // name and address, and kept its own page in pub_url.
    const merged = {
      pub_name: example.canonical.name,
      address: example.canonical.address,
      pub_url: example.ownUrl,
      pint_name: example.own.pint.toUpperCase(),
      price_gbp: example.published,
    };
    expect(freshPriceFor(observations, merged)).toBe(example.expected);
  });
});

const READ_AT = "2026-11-09T13:07:13+00:00";

function heldRow(overrides: Record<string, unknown>) {
  return {
    app_price_id: "app_price_000001",
    pub_name: "",
    pint_name: "",
    price_gbp: null as number | null,
    price_text: "",
    address: "",
    latitude: 51.5,
    longitude: -0.1,
    primary_borough: "Westminster",
    pub_url: "",
    constructed_pub_url: "",
    source_datasets: "london_osm_promotion",
    has_raw_embedded_map_row: false,
    scraped_at_values: "",
    ...overrides,
  };
}

function listing(name: string, address: string, at: [number, number], pints: [string, number][]): PintPricesListing {
  return {
    name,
    address,
    latitude: at[0],
    longitude: at[1],
    url: null,
    pints: new Map(pints.map(([pint, price]) => [pint.toLowerCase(), { pint, prices: new Set([price]) }])),
  };
}

const WELLINGTON = heldRow({
  app_price_id: "app_price_003175",
  pub_name: "The Wellington",
  address: "351 Strand, Covent Garden, WC2R 0HS, London",
  latitude: 51.51142,
  longitude: -0.11954,
  source_datasets: "london_chain_gazetteer_seed",
});

describe("pint-prices attach: a new pint joins a venue we already hold, never a new one", () => {
  it("puts a matched listing's pint on the held venue, credited to its own page and read day", () => {
    const listings = new Map([
      ["w", listing("The Wellington", "351 The Strand London WC2R 0HS", [51.5114, -0.119542], [["Neck Oil", 8.65]])],
    ]);
    const { added, unmatched } = attachMatchedListings([WELLINGTON], listings, READ_AT);

    expect(unmatched).toEqual([]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      app_price_id: "app_price_003176",
      pub_name: WELLINGTON.pub_name,
      address: WELLINGTON.address,
      latitude: WELLINGTON.latitude,
      longitude: WELLINGTON.longitude,
      pint_name: "Neck Oil",
      price_gbp: 8.65,
      price_text: "£8.65",
      pub_url: "https://www.pint-prices.com/pub/351%20The%20Strand%20London%20WC2R%200HS/The%20Wellington",
      scraped_at_values: READ_AT,
    });
  });

  it("reports a listing no held venue matches, and a listing outside London, instead of adding a venue", () => {
    const listings = new Map([
      ["t", listing("Theatreship", "E14 9SH", [51.501, -0.0161262], [["Beavertown Bones", 4.95]])],
      ["b", listing("Farmers Boy", "1 Brickendon Lane, Brickendon", [51.7634, -0.0905], [["Amstel", 5.55]])],
    ]);
    const { added, unmatched } = attachMatchedListings([WELLINGTON], listings, READ_AT);

    expect(added).toEqual([]);
    expect(Object.fromEntries(unmatched.map((row) => [row.name, row.reason]))).toEqual({
      "Farmers Boy": "outside-london",
      Theatreship: "no-matching-venue",
    });
  });

  it("refuses a same-name listing whose postcode is another place's", () => {
    const listings = new Map([
      ["w", listing("The Wellington", "CT2 8AF", [51.5114, -0.119542], [["Guinness", 6.9]])],
    ]);
    const { added, unmatched } = attachMatchedListings([WELLINGTON], listings, READ_AT);

    expect(added).toEqual([]);
    expect(unmatched[0]?.reason).toBe("no-matching-venue");
  });

  it("leaves a pint the venue already prices to the row that prices it", () => {
    const priced = heldRow({
      ...WELLINGTON,
      app_price_id: "app_price_003177",
      pint_name: "NECK OIL",
      price_gbp: 7.9,
      source_datasets: "wetherspoons_directory",
    });
    const listings = new Map([
      ["w", listing("The Wellington", "351 The Strand London WC2R 0HS", [51.5114, -0.119542], [["Neck Oil", 8.65]])],
    ]);
    const { added, unmatched } = attachMatchedListings([WELLINGTON, priced], listings, READ_AT);

    expect(added).toEqual([]);
    expect(unmatched[0]?.reason).toBe("venue-already-prices-this-pint");
  });

  it("treats a pint held under the row's map listing as held, whatever its pub page is called", () => {
    const fox = heldRow({
      pub_name: "Fox on the green",
      address: "1 Islington Grn, London N1 2XH, Reino Unido",
      pint_name: "CAMDEN HELLS",
      price_gbp: 7.45,
      pub_url: "https://www.pint-prices.com/pub/1%20Islington%20Grn,%20London%20N1%202XH/Fox%20on%20the%20green",
      constructed_pub_url:
        "https://www.pint-prices.com/pub/1%20Islington%20Grn%2C%20London%20N1%202XH%2C%20Reino%20Unido/Fox%20on%20the%20green",
    });
    const listings = new Map([
      [
        "f",
        listing("Fox on the green", "1 Islington Grn, London N1 2XH, Reino Unido", [51.5367, -0.103155], [
          ["Camden Hells", 7.45],
        ]),
      ],
    ]);

    expect(attachMatchedListings([fox], listings, READ_AT)).toEqual({ added: [], unmatched: [] });
  });
});
