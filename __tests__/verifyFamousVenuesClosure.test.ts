import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyRow } from "@/scripts/verify_famous_venues.mjs";

const OPERATOR = "https://www.kwantexample.co.uk";
const LISTING = "https://www.theworlds50best.com/discovery/kwantexample";
const SECOND_LISTING = "https://www.theinfatuation.com/london/reviews/kwantexample";

const row = {
  id: "bar-kwantexample",
  name: "Kwantexample",
  address: "5 Stratton Street, London W1J 8LA",
  borough: "Westminster",
  sourceUrl: `${OPERATOR}/`,
  anchor: { sourceUrl: `${OPERATOR}/menu` },
  fameGates: [{ sourceUrl: LISTING }, { sourceUrl: SECOND_LISTING }],
};

function servePages(pages: Record<string, { status: number; body: string }>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    asked.push(url);
    const page = pages[url] ?? { status: 404, body: "" };
    return new Response(`<html><body>${page.body}</body></html>`, {
      status: page.status,
      headers: { "content-type": "text/html" },
    });
  });
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verify:famous-venues closure evidence", () => {
  it("stops at an operator page that says the venue closed for good, before a listing can confirm it", async () => {
    const asked = servePages({
      [`${OPERATOR}/`]: { status: 403, body: "" },
      [`${OPERATOR}/menu`]: { status: 200, body: "Sadly, Kwantexample has permanently closed." },
      [LISTING]: { status: 200, body: "Kwantexample Mayfair cocktail bar" },
    });

    const check = await verifyRow(row, new Map());

    expect(check.outcome).toBe("closed");
    expect(check.closureSourceUrl).toBe(`${OPERATOR}/menu`);
    expect(asked).not.toContain(LISTING);
  }, 20_000);

  it("keeps a venue whose operator page only says a booking window is now closed", async () => {
    servePages({
      [`${OPERATOR}/`]: {
        status: 200,
        body: "Kwantexample Mayfair. Christmas Eve reservations are now closed; our terrace has closed for the season.",
      },
    });

    const check = await verifyRow(row, new Map());

    expect(check.outcome).toBe("confirmed");
  }, 20_000);

  it("never treats closure text on a listing page as closure, and lets no later listing confirm over it", async () => {
    servePages({
      [`${OPERATOR}/`]: { status: 503, body: "" },
      [`${OPERATOR}/menu`]: { status: 503, body: "" },
      [LISTING]: { status: 200, body: "Kwantexample is permanently closed." },
      [SECOND_LISTING]: { status: 200, body: "Kwantexample Mayfair cocktail bar review" },
    });

    const check = await verifyRow(row, new Map());

    expect(check.outcome).toBe("unverified");
    expect(check.closureSourceUrl).toBe(LISTING);
  }, 20_000);

  it("does not drop a venue when its operator page names it beside a closed sister site", async () => {
    const dalston = {
      id: "bar-sheetsexample-dalston",
      name: "Sheetsexample Dalston",
      address: "510b Kingsland Road, London E8 4AB",
      borough: "Hackney",
      sourceUrl: "https://www.sheetsexample.com/",
      anchor: { sourceUrl: "https://www.sheetsexample.com/" },
      fameGates: [],
    };
    servePages({
      "https://www.sheetsexample.com/": {
        status: 200,
        body: "Sheetsexample Dalston cocktails nightly. Sheetsexample Soho has closed for good.",
      },
    });

    const check = await verifyRow(dalston, new Map());

    expect(check.outcome).not.toBe("closed");
  }, 20_000);

  it("ignores closure text on an operator page that is not about this venue", async () => {
    servePages({
      [`${OPERATOR}/`]: { status: 200, body: "Our Shoreditch sister site is permanently closed." },
      [`${OPERATOR}/menu`]: { status: 404, body: "" },
      [LISTING]: { status: 404, body: "" },
    });

    const check = await verifyRow(row, new Map());

    expect(check.outcome).toBe("unverified");
  }, 20_000);
});
