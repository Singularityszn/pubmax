// A Guinndex price reaches a pub only when the page dates it, the pub is the
// same pub, and no fresher price on record says otherwise.

import { describe, expect, it } from "vitest";

import { readGuinndexObservation } from "@/lib/harvest/guinndex";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { indexCandidates, matchGuinndexPub, venueCandidates } from "../scripts/build_guinndex_prices.mjs";
import { addListingSiteRows } from "../scripts/build_uk_price_bundle.mjs";

const NOW = Date.parse("2026-11-09T12:00:00Z");

function detail(pub: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    pub: { slug: "the-pub-london", guinness_price_cents: 650, currency: "GBP", price_source: "crowdsourced", ...pub },
    price_history: [],
    drink_prices: [],
    ...extra,
  };
}

const guinness = (cents: number, at: string) => ({ drink_type: "stout", drink_brand: "Guinness", price_cents: cents, created_at: at });

describe("readGuinndexObservation", () => {
  it("takes the headline price dated by the newest record that states it", () => {
    const read = readGuinndexObservation(
      detail({}, { drink_prices: [guinness(650, "2026-04-22T10:35:15Z"), guinness(650, "2026-06-01T09:00:00Z")] }),
      NOW,
    );
    expect(read).toEqual({
      ok: true,
      observation: { slug: "the-pub-london", priceGbp: 6.5, observedAt: "2026-06-01T09:00:00.000Z", priceSource: "crowdsourced" },
    });
  });

  it("never dates a price from the record's own update stamp", () => {
    expect(readGuinndexObservation(detail({ updated_at: "2026-07-05T18:49:54Z", price_source: "ai_call" }), NOW)).toEqual({
      ok: false,
      reason: "undated",
    });
  });

  it("dates a phoned price by the finished call", () => {
    const read = readGuinndexObservation(detail({ price_source: "ai_call", call_completed_at: "2026-03-17T20:00:00Z" }), NOW);
    expect(read.ok && read.observation.observedAt).toBe("2026-03-17T20:00:00.000Z");
  });

  it("skips a price a newer record contradicts", () => {
    const read = readGuinndexObservation(
      detail({}, { drink_prices: [guinness(650, "2026-04-01T00:00:00Z"), guinness(700, "2026-05-01T00:00:00Z")] }),
      NOW,
    );
    expect(read).toEqual({ ok: false, reason: "newer-record-disagrees" });
  });

  it("skips a price Guinndex itself flagged", () => {
    const read = readGuinndexObservation(
      detail(
        { guinness_price_cents: 860 },
        {
          price_history: [{ new_price_cents: 860, flag_reason: "Price too high: £8.60", created_at: "2026-04-22T10:35:14Z" }],
          drink_prices: [guinness(860, "2026-04-22T10:35:15Z")],
        },
      ),
      NOW,
    );
    expect(read).toEqual({ ok: false, reason: "flagged" });
  });

  it("skips a figure outside the pint band, a closed pub and a date in the future", () => {
    const dated = { drink_prices: [guinness(150, "2026-04-01T00:00:00Z")] };
    expect(readGuinndexObservation(detail({ guinness_price_cents: 150 }, dated), NOW)).toEqual({ ok: false, reason: "implausible-price" });
    expect(
      readGuinndexObservation(detail({ business_status: "CLOSED_PERMANENTLY" }, { drink_prices: [guinness(650, "2026-04-01T00:00:00Z")] }), NOW),
    ).toEqual({ ok: false, reason: "closed" });
    expect(readGuinndexObservation(detail({}, { drink_prices: [guinness(650, "2027-01-01T00:00:00Z")] }), NOW)).toEqual({
      ok: false,
      reason: "undated",
    });
  });
});

describe("matchGuinndexPub", () => {
  const grid = indexCandidates(
    venueCandidates({
      baseRows: [
        ["n1", "The Kings Ford", "250 Chingford Mount Road, E4 8JL", 51.6200, -0.0130, ""],
        ["n2", "The Red Lion", "1 High Street, SW1A 1AA", 51.5000, -0.1400, "venue-curated-red-lion"],
        ["n3", "Red Lion", "2 High Street, SW1A 1AB", 51.50005, -0.14005, ""],
        ["n4", "The Crown", "9 Other Road, N1 1AA", 51.5400, -0.1000, ""],
      ],
      slimRows: [{ id: "venue-slim-only", name: "The Harp", lat: 51.5100, lng: -0.1250, filterHints: { searchText: "the harp 47 chandos place wc2n 4hs" } }],
    }),
  );

  it("matches the same pub under an operator suffix and a dropped apostrophe", () => {
    expect(
      matchGuinndexPub({ name: "The King's Ford - JD Wetherspoon", lat: 51.6201, lng: -0.0131, formatted_address: "250-252 Chingford Mount Rd, London E4 8JL, UK" }, grid),
    ).toMatchObject({ ok: true, venueId: "venue-uk-n1" });
  });

  it("matches a curated venue that no base pub hands to", () => {
    expect(matchGuinndexPub({ name: "The Harp", lat: 51.5101, lng: -0.1251, formatted_address: "47 Chandos Pl, London WC2N 4HS, UK" }, grid)).toMatchObject({
      ok: true,
      venueId: "venue-slim-only",
    });
  });

  it("refuses two pubs of one name side by side", () => {
    expect(matchGuinndexPub({ name: "Red Lion", lat: 51.50002, lng: -0.14002, formatted_address: "London SW1A 1AA, UK" }, grid)).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("refuses a shared name in another postcode district or too far away", () => {
    expect(matchGuinndexPub({ name: "The Crown", lat: 51.5401, lng: -0.1001, formatted_address: "London N7 1AA, UK" }, grid)).toEqual({
      ok: false,
      reason: "no-venue",
    });
    expect(matchGuinndexPub({ name: "The Crown", lat: 51.5430, lng: -0.1000, formatted_address: "London N1 1AA, UK" }, grid)).toEqual({
      ok: false,
      reason: "no-venue",
    });
  });
});

describe("addListingSiteRows", () => {
  const row = (venueId: string, observedAt = "2026-06-01T09:00:00.000Z", sourceUrl = "https://guinndex.co.uk/pub/the-pub-london") => ({
    venueId,
    venueName: "The Pub",
    sourceUrl,
    priceGbp: 6.5,
    observedAt,
    drinkLabel: "Guinness",
    servingSize: "Pint",
  });

  function run(rows: Record<string, unknown>[], baselineDays = new Map<string, string>()) {
    const pushed: UkPriceBundleRow[] = [];
    const report = { droppedRefusedHost: 0, droppedUnresolvedVenue: 0, droppedOlderThanOnRecord: 0 };
    addListingSiteRows(rows, {
      owners: new Map([["n9", "venue-curated-nine"]]),
      servedRefs: new Set(["n1", "n9"]),
      venueAliases: { "venue-old": "venue-new" },
      baselineDays,
      push: (pushedRow) => pushed.push(pushedRow),
      report,
    });
    return { pushed, report };
  }

  it("writes a listed Guinness pint credited to Guinndex under the venue that serves the pub", () => {
    const { pushed } = run([row("venue-uk-n9"), row("venue-old"), row("venue-uk-n1")]);
    expect(pushed.map((pushedRow) => pushedRow.venueId)).toEqual(["venue-curated-nine", "venue-new", "venue-uk-n1"]);
    expect(pushed[0]).toMatchObject({
      category: "beer",
      lane: "listing-site",
      standing: "listed",
      publisher: "Guinndex",
      sourceUrl: "https://guinndex.co.uk/pub/the-pub-london",
      drinkLabel: "Guinness",
      servingSize: "Pint",
      observedAt: "2026-06-01T09:00:00.000Z",
    });
  });

  it("drops a row off the registered host, a pub that left the base layer, and one older than the price on record", () => {
    const { pushed, report } = run(
      [row("venue-uk-n1", undefined, "https://example.com/pub/x"), row("venue-uk-n404"), row("venue-curated", "2026-06-01T09:00:00.000Z")],
      new Map([["venue-curated", "2026-10-02"]]),
    );
    expect(pushed).toEqual([]);
    expect(report).toEqual({ droppedRefusedHost: 1, droppedUnresolvedVenue: 1, droppedOlderThanOnRecord: 1 });
  });
});
