// A pint-prices row is re-read against the listing page its price came from.
//
// The venue canonicalizer rewrites a merged row's name, address and point to
// the canonical pub and leaves `pub_url` alone. Two pint-prices listings at one
// point then display as one pub, and a refresh that matched by the display name
// gave each merged row the canonical listing's price. The four cases are the
// published rows the 2026-11-09 re-read found wrong.

import { describe, expect, it } from "vitest";

import type { HarvestSource } from "@/lib/harvest/sourcePolicy";

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
    if (!(url in pages)) throw new Error(`unexpected fetch ${url}`);
    return page(pages[url], url, url === SITEMAP ? "application/xml" : "text/html");
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
