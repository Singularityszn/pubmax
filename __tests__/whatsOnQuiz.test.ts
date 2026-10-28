import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildQuestionOneRows,
  extractPostcode,
  isGreaterLondonLatLng,
  isGreaterLondonPostcode,
  isKnownLondonAreaName,
  isWeeklyCadence,
  nextWeeklyOccurrence,
  parseQuestionOneNextPage,
  parseQuestionOneVenueDetail,
  parseQuestionOneVenuesApi,
  parseQuestionOneVenuesPage,
  parseSpeedQuizzingFindEvents,
  placeNameFromQuestionOneTitle,
} from "../scripts/whatson/quizParsers.mjs";
import { buildVenueResolverIndex } from "../scripts/whatson/resolveVenueId.mjs";
import { defined } from "@/__tests__/helpers/defined";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", "whats_on", name), "utf8");

// Real excerpts fetched 2026-07-11 (see the comment at the top of each file).
const LISTING = fixture("question-one-venues-page.html");
const DETAIL = fixture("question-one-venue-detail.html");
const SQ_FIND = fixture("speedquizzing-find.html");

describe("parseQuestionOneVenuesPage", () => {
  it("extracts every media-card with its weekly slot", () => {
    const cards = parseQuestionOneVenuesPage(LISTING);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toEqual({
      url: "https://questionone.com/venues/sporting-page-sundays-7-30pm/",
      title: "Sporting Page, Chelsea",
      day: "Sunday",
      time: "19:30",
    });
    // HTML entities in titles are decoded (&#8211; -> –).
    expect(defined(cards[1]).title).toBe("PUB QUIZ – The Britannia, Poole – Every Other Sunday");
  });

  it("follows the archive's rel=next pagination link", () => {
    expect(parseQuestionOneNextPage(LISTING)).toBe("https://questionone.com/venues/page/2/");
    expect(parseQuestionOneNextPage("<html></html>")).toBeNull();
  });

  it("follows rel=next only on the page's own host", () => {
    const page = "https://questionone.com/venues/";
    const offHost = '<link rel="next" href="https://evil.example/venues/page/2/" />';
    const downgraded = '<link rel="next" href="http://questionone.com/venues/page/2/" />';
    const relative = '<link rel="next" href="/venues/page/2/" />';
    expect(parseQuestionOneNextPage(offHost, page)).toBeNull();
    expect(parseQuestionOneNextPage(offHost)).toBeNull();
    expect(parseQuestionOneNextPage(downgraded, page)).toBeNull();
    expect(parseQuestionOneNextPage(relative, page)).toBe("https://questionone.com/venues/page/2/");
  });

  it("returns [] for pages without cards", () => {
    expect(parseQuestionOneVenuesPage("<html><body></body></html>")).toEqual([]);
  });
});

describe("parseQuestionOneVenueDetail", () => {
  it("reads slot, entry fee and address off the icon field blocks", () => {
    expect(parseQuestionOneVenueDetail(DETAIL)).toEqual({
      day: "Sunday",
      time: "19:30",
      feeGbp: 2,
      feeRaw: "£2",
      address: "25 Roupell Street, England SE1 8TB, United Kingdom",
      postcode: "SE1 8TB",
    });
  });

  it("keeps unknown fields null instead of inventing them", () => {
    const empty = parseQuestionOneVenueDetail("<html></html>");
    expect(empty).toEqual({
      day: null, time: null, feeGbp: null, feeRaw: null, address: null, postcode: null,
    });
  });
});

describe("Greater London filter", () => {
  it("extracts full UK postcodes from address text", () => {
    expect(extractPostcode("25 Roupell Street, England SE1 8TB, United Kingdom")).toBe("SE1 8TB");
    expect(extractPostcode("1 High Street, Cambridge England CB24 9LG")).toBe("CB24 9LG");
    expect(extractPostcode("no postcode here")).toBeNull();
  });

  it("accepts inner-London postcode areas outright", () => {
    for (const pc of ["SE1 8TB", "E8 2NP", "EC1M 6BN", "WC1N 1LB", "SW10 0BH"])
      expect(isGreaterLondonPostcode(pc), pc).toBe(true);
  });

  it("uses the curated outward-code table for boundary areas", () => {
    expect(isGreaterLondonPostcode("TW1 3AB")).toBe(true); // Twickenham (LB Richmond)
    expect(isGreaterLondonPostcode("HA9 0WS")).toBe(true); // Wembley (LB Brent)
    expect(isGreaterLondonPostcode("RM14 1AB")).toBe(true); // Upminster (LB Havering)
    expect(isGreaterLondonPostcode("IG10 4BE")).toBe(false); // Loughton = Essex
    expect(isGreaterLondonPostcode("KT19 8AG")).toBe(false); // Epsom = Surrey
    expect(isGreaterLondonPostcode("WD17 1AA")).toBe(false); // Watford = Herts
    expect(isGreaterLondonPostcode("CB24 9LG")).toBe(false); // Histon = Cambs
  });

  it("area-name fallback only matches the explicit district allowlist", () => {
    expect(isKnownLondonAreaName("Grapes, Limehouse")).toBe(true);
    expect(isKnownLondonAreaName("White Swan, Pimlico")).toBe(true);
    expect(isKnownLondonAreaName("The Queen Victoria, Epping")).toBe(false); // Essex
    expect(isKnownLondonAreaName("Sonder Bar")).toBe(false); // no area part at all
  });

  it("bounding box covers London and excludes elsewhere", () => {
    expect(isGreaterLondonLatLng(51.5074, -0.1278)).toBe(true); // central London
    expect(isGreaterLondonLatLng(53.4808, -2.2426)).toBe(false); // Manchester
    expect(isGreaterLondonLatLng(Number.NaN, 0)).toBe(false);
  });
});

describe("nextWeeklyOccurrence (Europe/London)", () => {
  it("returns the next slot after the observation, with BST offset", () => {
    // Observed Saturday 2026-07-11 15:00 UTC; next Tuesday 19:30 London.
    expect(nextWeeklyOccurrence("Tuesday", "19:30", "2026-07-11T15:00:00Z"))
      .toBe("2026-07-14T19:30:00+01:00");
  });

  it("rolls to next week when the slot already passed today", () => {
    // 2026-07-14 is a Tuesday; observing at 20:00 London (19:00Z) is after 19:30.
    expect(nextWeeklyOccurrence("Tuesday", "19:30", "2026-07-14T19:00:00Z"))
      .toBe("2026-07-21T19:30:00+01:00");
    // ...but observing at 19:00 London still hits the same evening.
    expect(nextWeeklyOccurrence("Tuesday", "19:30", "2026-07-14T17:00:00Z"))
      .toBe("2026-07-14T19:30:00+01:00");
  });

  it("is DST-aware: GMT offset after the October clock change", () => {
    // Clocks fall back Sunday 2026-10-25; a quiz that evening is +00:00.
    expect(nextWeeklyOccurrence("Sunday", "19:30", "2026-10-24T12:00:00Z"))
      .toBe("2026-10-25T19:30:00+00:00");
    expect(nextWeeklyOccurrence("Sunday", "19:30", "2026-10-25T20:00:00Z"))
      .toBe("2026-11-01T19:30:00+00:00");
  });

  it("rejects malformed input instead of guessing", () => {
    expect(nextWeeklyOccurrence("Funday", "19:30", "2026-07-11T15:00:00Z")).toBeNull();
    expect(nextWeeklyOccurrence("Tuesday", "25:99", "2026-07-11T15:00:00Z")).toBeNull();
    expect(nextWeeklyOccurrence("Tuesday", "19:30", "not a date")).toBeNull();
  });
});

describe("cadence + title helpers", () => {
  it("treats monthly / every-other listings as non-weekly", () => {
    expect(isWeeklyCadence("PUB QUIZ – Royal Oak, Twickenham – Every Thursday")).toBe(true);
    expect(isWeeklyCadence("PUB QUIZ – The Britannia, Poole – Every Other Sunday")).toBe(false);
    expect(isWeeklyCadence("PUB QUIZ – Unity Place, Milton Keynes – Monthly")).toBe(false);
    expect(isWeeklyCadence("PUB QUIZ – Beaconsfield Tap – First Wednesday of the Month")).toBe(false);
  });

  it("strips the PUB QUIZ prefix and cadence suffix from titles", () => {
    expect(placeNameFromQuestionOneTitle("PUB QUIZ – King’s Arms, Waterloo – Every Sunday"))
      .toBe("King’s Arms, Waterloo");
    expect(placeNameFromQuestionOneTitle("Sporting Page, Chelsea")).toBe("Sporting Page, Chelsea");
    expect(placeNameFromQuestionOneTitle("PUB QUIZ – White Hart, Whitechapel – Thursdays"))
      .toBe("White Hart, Whitechapel");
  });
});

describe("buildQuestionOneRows", () => {
  const observedAt = "2026-07-11T20:30:00.000Z";

  it("emits contract rows for weekly London cards and counts the rest", () => {
    const cards = parseQuestionOneVenuesPage(LISTING);
    const detailsByUrl = new Map([
      // Real detail fixture belongs to King's Arms; reused here to give the
      // Chelsea card a fee + London postcode without a second fixture file.
      [defined(cards[0]).url, parseQuestionOneVenueDetail(DETAIL)],
    ]);
    const { rows, dropped } = buildQuestionOneRows({ cards, detailsByUrl, observedAt });

    // Card 2 is "Every Other Sunday" (non-weekly), card 3 (Twickenham) has no
    // detail postcode and "Twickenham" is allowlisted -> kept via area name.
    expect(dropped).toEqual({ nonWeekly: 1, notLondon: 0, noSlot: 0 });
    expect(rows).toHaveLength(2);

    const row = rows[0];
    expect(row).toEqual({
      id: "quiz-qo-sporting-page-sundays-7-30pm",
      venueId: null,
      placeName: "Sporting Page, Chelsea",
      kind: "quiz",
      startsAt: "2026-07-12T19:30:00+01:00", // next Sunday after observedAt
      title: "Pub quiz — Sundays 7:30pm",
      detail: "Weekly pub quiz — every Sunday 19:30 · entry £2 · SE1 8TB · run by Question One",
      priceGbp: 2,
      source: { label: "Question One", url: defined(cards[0]).url },
      observedAt,
      confidence: "listed",
    });
  });

  it("omits priceGbp when the venue page lists no fee", () => {
    const cards = parseQuestionOneVenuesPage(LISTING);
    const { rows } = buildQuestionOneRows({ cards, detailsByUrl: new Map(), observedAt });
    const twickenham = rows.find((r) => r.placeName.includes("Twickenham"));
    expect(twickenham).toBeDefined();
    expect(twickenham).not.toHaveProperty("priceGbp");
    expect(twickenham?.detail).toContain("Weekly pub quiz — every Thursday 19:30");
  });

  it("every emitted row carries source + observedAt provenance", () => {
    const cards = parseQuestionOneVenuesPage(LISTING);
    const { rows } = buildQuestionOneRows({ cards, detailsByUrl: new Map(), observedAt });
    for (const row of rows) {
      expect(row.source.label).toBe("Question One");
      expect(row.source.url).toMatch(/^https:\/\/questionone\.com\/venues\//);
      expect(row.observedAt).toBe(observedAt);
      expect(row.confidence).toBe("listed");
      expect(new Date(row.startsAt).getTime()).toBeGreaterThan(new Date(observedAt).getTime());
    }
  });
});

// Seven real records from https://questionone.com/wp-json/wp/v2/venues, read
// 28 Oct 2026 with the reader's own `_fields` (link, title, acf.dates,
// acf.price, acf.location). The directory lists Sydney and Melbourne too.
const DIRECTORY = JSON.parse(fixture("question-one-venues-api.json")) as unknown[];

describe("parseQuestionOneVenuesApi", () => {
  it("reads one card per weekly slot, and the fee, postcode and map point as the detail", () => {
    const { cards, detailsByUrl } = parseQuestionOneVenuesApi(DIRECTORY);
    expect(cards).toHaveLength(7);
    expect(cards[0]).toEqual({
      url: "https://questionone.com/venues/sporting-page-sundays-7-30pm/",
      title: "Sporting Page, Chelsea",
      day: "Sunday",
      time: "19:30",
    });
    expect(detailsByUrl.get(defined(cards[0]).url)).toEqual({
      day: null,
      time: null,
      feeGbp: 2,
      feeRaw: "£2",
      freeEntry: false,
      address: "The Sporting Page, Camera Place, London, UK",
      postcode: "SW10 0BH",
      lat: 51.4846455,
      lng: -0.1794144,
      name: "The Sporting Page",
    });
  });

  it("states no fee for a bare number, free entry for Free, and nothing for a missing location", () => {
    const { cards, detailsByUrl } = parseQuestionOneVenuesApi(DIRECTORY);
    const byTitle = (part: string) => detailsByUrl.get(defined(cards.find((c) => c.title.includes(part))).url);
    expect(byTitle("Royal Oak")).toMatchObject({ feeGbp: null, feeRaw: null, freeEntry: false });
    expect(byTitle("The Boot")).toMatchObject({ feeGbp: null, feeRaw: "FREE", freeEntry: true });
    expect(byTitle("Hare and Billet")).toMatchObject({ feeGbp: 1, postcode: "SE3 0RB" });
    expect(byTitle("Tower Bridge Arms")).toMatchObject({ address: null, postcode: null, lat: null, lng: null });
  });

  it("gives a record with two slots two cards with their own id suffix, and skips a record with no link", () => {
    const { cards } = parseQuestionOneVenuesApi([
      {
        link: "https://questionone.com/venues/two-nights/",
        title: { rendered: "Two Nights, Soho" },
        acf: { dates: [{ day: "monday", time: "19:00:00" }, { day: "THURSDAY", time: "8:30" }] },
      },
      { title: { rendered: "No Link, Soho" }, acf: { dates: [{ day: "monday", time: "19:00" }] } },
      "not a record",
    ]);
    expect(cards).toEqual([
      { url: "https://questionone.com/venues/two-nights/", title: "Two Nights, Soho", day: "Monday", time: "19:00", idSuffix: "monday" },
      { url: "https://questionone.com/venues/two-nights/", title: "Two Nights, Soho", day: "Thursday", time: "08:30", idSuffix: "thursday" },
    ]);
  });

  it("keeps a malformed slot as no slot, never a guessed one", () => {
    const { cards } = parseQuestionOneVenuesApi([
      {
        link: "https://questionone.com/venues/bad-slot/",
        title: { rendered: "Bad Slot, Soho" },
        acf: { dates: [{ day: "someday", time: "19:00" }] },
      },
    ]);
    expect(cards).toEqual([
      { url: "https://questionone.com/venues/bad-slot/", title: "Bad Slot, Soho", day: null, time: null },
    ]);
  });
});

describe("buildQuestionOneRows from the directory JSON", () => {
  // Wednesday 28 Oct 2026, 12:00 London: the clocks went back on the 25th.
  const observedAt = "2026-10-28T12:00:00.000Z";

  it("emits London weekly rows with the stated point, and drops the rest by name", () => {
    const { cards, detailsByUrl } = parseQuestionOneVenuesApi(DIRECTORY);
    const { rows, dropped } = buildQuestionOneRows({ cards, detailsByUrl, observedAt });
    // Poole is every other Sunday; Histon and Sydney's Paddington are not London.
    expect(dropped).toEqual({ nonWeekly: 1, notLondon: 2, noSlot: 0 });
    expect(rows.map((row) => row.placeName)).toEqual([
      "Sporting Page, Chelsea",
      "Tower Bridge Arms, Tower Hill",
      "Royal Oak, Bethnal Green",
      "Hare and Billet, Blackheath",
    ]);
    expect(rows[2]).toEqual({
      id: "quiz-qo-pub-quiz-royal-oak-bethnal-green-wednesdays",
      venueId: null,
      placeName: "Royal Oak, Bethnal Green",
      lat: 51.5295878,
      lng: -0.0693438,
      kind: "quiz",
      startsAt: "2026-10-28T19:30:00+00:00",
      title: "Pub quiz — Wednesdays 7:30pm",
      detail: "Weekly pub quiz — every Wednesday 19:30 · E2 7RG · run by Question One",
      source: {
        label: "Question One",
        url: "https://questionone.com/venues/pub-quiz-royal-oak-bethnal-green-wednesdays/",
      },
      observedAt,
      confidence: "listed",
    });
  });

  it("drops a Paddington outside London by its map point, before the area name is asked", () => {
    const { cards, detailsByUrl } = parseQuestionOneVenuesApi([
      {
        link: "https://questionone.com/venues/far-paddington/",
        title: { rendered: "Lord Dudley, Paddington" },
        acf: { dates: [{ day: "thursday", time: "19:30" }], location: { lat: -33.887, lng: 151.226 } },
      },
    ]);
    const { rows, dropped } = buildQuestionOneRows({ cards, detailsByUrl, observedAt });
    expect(rows).toEqual([]);
    expect(dropped.notLondon).toBe(1);
  });

  it("names the pub only when name AND postcode or point agree", () => {
    const index = buildVenueResolverIndex([
      { pub_name: "Royal Oak", address: "73 Columbia Road, London E2 7RG", latitude: 51.52959, longitude: -0.06934 },
      { pub_name: "Royal Oak", address: "44 Tabard Street, London SE1 4JU", latitude: 51.4984, longitude: -0.0912 },
    ]);
    const { cards, detailsByUrl } = parseQuestionOneVenuesApi(DIRECTORY);
    const { rows } = buildQuestionOneRows({ cards, detailsByUrl, observedAt, venueIndex: index });
    const bethnalGreen = defined(rows.find((row) => row.placeName === "Royal Oak, Bethnal Green"));
    const [expected] = [...index.byNormalizedName.values()].flat().filter((c) => c.address.includes("E2 7RG"));
    expect(bethnalGreen.venueId).toBe(defined(expected).venueId);
    // Tower Bridge Arms states no postcode and no point, so it stays unnamed.
    expect(rows.find((row) => row.placeName.startsWith("Tower Bridge"))?.venueId).toBeNull();
  });

  it("prints free entry and a fractional fee as the directory states them", () => {
    const { cards, detailsByUrl } = parseQuestionOneVenuesApi([
      {
        link: "https://questionone.com/venues/free-one/",
        title: { rendered: "Free One, Soho" },
        acf: { dates: [{ day: "friday", time: "19:00" }], price: "Free", location: { post_code: "W1D 5NA" } },
      },
      {
        link: "https://questionone.com/venues/half-one/",
        title: { rendered: "Half One, Soho" },
        acf: { dates: [{ day: "friday", time: "19:00" }], price: "£1.5", location: { post_code: "W1D 5NA" } },
      },
    ]);
    const { rows } = buildQuestionOneRows({ cards, detailsByUrl, observedAt });
    expect(rows[0]?.detail).toBe("Weekly pub quiz — every Friday 19:00 · free entry · W1D 5NA · run by Question One");
    expect(rows[0]).not.toHaveProperty("priceGbp");
    expect(rows[1]?.detail).toBe("Weekly pub quiz — every Friday 19:00 · entry £1.50 · W1D 5NA · run by Question One");
    expect(rows[1]?.priceGbp).toBe(1.5);
  });
});

describe("parseSpeedQuizzingFindEvents", () => {
  it("parses the inline events array (coverage only — no venue names)", () => {
    const events = parseSpeedQuizzingFindEvents(SQ_FIND);
    expect(events).toHaveLength(8);
    const london = events.filter((e) => isGreaterLondonLatLng(e.lat, e.lng));
    expect(london).toHaveLength(5);
    for (const e of events) {
      expect(e.eventId).toMatch(/^\d+$/);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("returns [] when the events block is missing", () => {
    expect(parseSpeedQuizzingFindEvents("<html></html>")).toEqual([]);
  });
});
