// A SCANNED MENU IS A MENU, AND IT EARNS NO RULE OF ITS OWN.
//
// The OCR lane reads the documents the text reader answered null on. What comes
// back is a model's transcription, which is weaker evidence than words a page
// stated, so the whole design rests on that transcription going through the SAME
// rules a served page goes through. These cases are the two halves that could
// drift: which hosts the lane is allowed to visit, and what a reading is allowed
// to become.

import { describe, expect, it } from "vitest";

import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import {
  OCR_DOCUMENT_OUTCOMES,
  hostsWithUnreadablePdfs,
  rowsFromReadings,
} from "../scripts/harvest/uk-prices/ocr.mjs";
import { defined } from "@/__tests__/helpers/defined";

/** One host's ledger entry, in the shape the crawler writes it. */
const entryWith = (evidence: string) => ({
  outcome: "menu-states-no-price",
  evidence,
  pagesRead: 3,
  pubs: 1,
  checkedAt: "2026-09-04T17:12:42.533Z",
  drops: [],
});

const SCANNED_DRINKS_MENU = `
Drinks

Draught
Camden Hells Lager  pint  £6.40
Guinness  pint  £6.20
Neck Oil  pint  £6.80
Beavertown Gamma Ray  pint  £6.90

Wine by the glass
House Red 175ml  £7.50
Malbec 175ml  £9.00

Cocktails
Negroni  £11.00
Espresso Martini  £11.50
`;

const soloPub = {
  host: "thegunhackney.com",
  origin: "https://www.thegunhackney.com",
  pubs: [
    {
      venueId: "venue-uk-n1",
      osmId: "node/1",
      name: "The Gun",
      postcode: "E3 3NS",
      lat: 51.5,
      lng: -0.02,
      website: "https://www.thegunhackney.com",
    },
  ],
};

const estate = {
  host: "moorwoodhotelcollection.co.uk",
  origin: "https://www.moorwoodhotelcollection.co.uk",
  pubs: [
    { venueId: "venue-uk-n2", osmId: "node/2", name: "White Hart", postcode: null, lat: 0, lng: 0, website: "" },
    { venueId: "venue-uk-n3", osmId: "node/3", name: "Canal Inn", postcode: null, lat: 0, lng: 0, website: "" },
  ],
};

describe("which hosts the OCR lane may visit", () => {
  it("takes the hosts the crawl's own evidence records an unreadable PDF for", () => {
    const targets = hostsWithUnreadablePdfs({
      hosts: {
        "bluebellcardiff.co.uk": entryWith(
          "4 page(s) read, 3 PDF(s) seen (1 read, 2 unreadable), no stated drink price",
        ),
        "thegunhackney.com": entryWith(
          "2 page(s) read, 1 PDF(s) seen (0 read, 1 unreadable), no stated drink price",
        ),
      },
    });

    expect(targets).toEqual([
      { host: "bluebellcardiff.co.uk", unreadable: 2, checkedAt: "2026-09-04T17:12:42.533Z" },
      { host: "thegunhackney.com", unreadable: 1, checkedAt: "2026-09-04T17:12:42.533Z" },
    ]);
  });

  it("leaves out a host whose PDFs were all read, so the lane cannot widen the crawl", () => {
    const targets = hostsWithUnreadablePdfs({
      hosts: {
        "greeneking.co.uk": entryWith(
          "6 page(s) read, 4 PDF(s) seen (4 read, 0 unreadable), no stated drink price",
        ),
        "sabrainpubs.com": entryWith("1 page(s) read, 0 PDF(s) seen, no stated drink price"),
        "nomenu.co.uk": entryWith("1 page(s) read"),
      },
    });

    expect(targets).toEqual([]);
  });

  it("prefers a counted field over the sentence, and survives a ledger with no hosts at all", () => {
    expect(
      hostsWithUnreadablePdfs({
        hosts: { "a.co.uk": { ...entryWith("no PDF sentence here"), pdfUnread: 3 } },
      }),
    ).toEqual([{ host: "a.co.uk", unreadable: 3, checkedAt: "2026-09-04T17:12:42.533Z" }]);
    expect(hostsWithUnreadablePdfs({})).toEqual([]);
    expect(hostsWithUnreadablePdfs(null)).toEqual([]);
  });
});

describe("what an OCR reading is allowed to become", () => {
  it("retains separately priced glass measures in source rows", () => {
    // Row builder receives an excerpt shaped like the captured Sydney Arms
    // menu. This tests persistence shape, not a new OCR or live harvest.
    const reading = readVenueDrinkPrices(`<p>Chardonnay, Pays D&#8217;oc, France<br />
125ml £5.50 250ml £11.00 Btl £31.50</p>
<p>Rioja, Spain<br />
125ml £5.25 250ml £10.50 Btl £30.00</p>`);
    const { rows } = rowsFromReadings(
      soloPub,
      [{ url: "https://www.thegunhackney.com/s/test-menu.pdf", reading }],
      "2026-09-04T22:30:00.000Z",
    );
    expect(rows.map((row) => [row.drinkLabel, row.servingSize, row.priceGbp])).toEqual([
      ["Chardonnay, Pays D’oc, France", "125ml", 5.5],
      ["Chardonnay, Pays D’oc, France", "250ml", 11],
      ["Rioja, Spain", "125ml", 5.25],
      ["Rioja, Spain", "250ml", 10.5],
    ]);
  });

  it("prices a single-pub host from its own scanned drinks list, cheapest per drink", () => {
    const { rows, documents } = rowsFromReadings(
      soloPub,
      [
        {
          url: "https://www.thegunhackney.com/s/TheGun-Menu-August-2026.pdf",
          reading: readVenueDrinkPrices(SCANNED_DRINKS_MENU),
        },
      ],
      "2026-09-04T22:30:00.000Z",
    );

    expect(documents).toEqual([
      { url: "https://www.thegunhackney.com/s/TheGun-Menu-August-2026.pdf", outcome: "priced" },
    ]);
    const beers = rows.filter((row) => row.category === "beer");
    expect(Math.min(...beers.map((row) => row.priceGbp))).toBe(6.2);
    expect(beers.some((row) => row.drinkLabel)).toBe(true);
    // The row says HOW it was read. A figure a model took off a photograph is
    // not a figure a page stated in words, and the file may not hide which.
    expect(rows.every((row) => row.reader === "olmocr")).toBe(true);
    expect(rows.every((row) => row.observedAt === "2026-09-04T22:30:00.000Z")).toBe(true);
    expect(rows.every((row) => row.venueId === "venue-uk-n1")).toBe(true);
  });

  it("takes nothing off a document under the drinks-list floor, and says so", () => {
    const banner = "Sunday roast £16.95. Pint of Guinness £6.20 with any main.";
    const { rows, documents } = rowsFromReadings(
      soloPub,
      [{ url: "https://www.thegunhackney.com/s/promo.pdf", reading: readVenueDrinkPrices(banner) }],
      "2026-09-04T22:30:00.000Z",
    );

    expect(rows).toEqual([]);
    expect(defined(documents[0]).outcome).toBe("states-no-price");
  });

  it("refuses an estate scan that names none of its own pubs", () => {
    const { rows, documents } = rowsFromReadings(
      estate,
      [
        {
          url: "https://www.moorwoodhotelcollection.co.uk/assets/group-drinks.pdf",
          reading: readVenueDrinkPrices(SCANNED_DRINKS_MENU),
        },
      ],
      "2026-09-04T22:30:00.000Z",
    );

    expect(rows).toEqual([]);
    expect(documents.at(-1)).toMatchObject({
      outcome: "states-no-price",
      evidence: "no document naming a pub",
    });
  });

  it("lets an estate scan price the pubs when its own path names one of them", () => {
    const { rows } = rowsFromReadings(
      estate,
      [
        {
          url: "https://www.moorwoodhotelcollection.co.uk/white-hart/menu/Drinks.pdf",
          reading: readVenueDrinkPrices(SCANNED_DRINKS_MENU),
        },
      ],
      "2026-09-04T22:30:00.000Z",
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.pubsOnHost === 2)).toBe(true);
  });

  it("takes nothing off a scanned food card, by the food rule", () => {
    const foodCard = `
Starters
Soup of the day £7.50
Crab cocktail £11.00
Mains
Beef and ale pie £18.50
Fish and chips £17.00
Steak and ale pudding £19.00
`;
    const { rows } = rowsFromReadings(
      soloPub,
      [{ url: "https://www.thegunhackney.com/s/food.pdf", reading: readVenueDrinkPrices(foodCard) }],
      "2026-09-04T22:30:00.000Z",
    );
    expect(rows).toEqual([]);
  });

  it("names every outcome it can report, so a skip is never silently a success", () => {
    expect(OCR_DOCUMENT_OUTCOMES).toContain("priced");
    expect(OCR_DOCUMENT_OUTCOMES).toContain("has-text-layer");
    expect(OCR_DOCUMENT_OUTCOMES).toContain("ocr-failed");
    expect(new Set(OCR_DOCUMENT_OUTCOMES).size).toBe(OCR_DOCUMENT_OUTCOMES.length);
  });
});
