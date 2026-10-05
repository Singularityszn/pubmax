import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  siteFactsRows,
  statedDogPolicy,
  statedSiteOpeningHours,
  type KeptPageRead,
} from "@/lib/harvest/pubSiteHoursAndDogs";
import { slimVenueToPin } from "@/lib/slimPins";
import { applyVenueSiteFacts, venueSiteFactsFromRow } from "@/lib/venueSiteFacts";

describe("statedDogPolicy", () => {
  it("reads a welcome the pub states, with the passage as evidence", () => {
    expect(statedDogPolicy("Sunday roasts. We're dog-friendly. Book now")).toEqual({ policy: "welcome", evidence: "We're dog-friendly." });
    expect(statedDogPolicy("## FACILITIES - Dog Friendly - Family Friendly - Sky Sports")).toEqual({ policy: "welcome", evidence: "Dog Friendly" });
    expect(statedDogPolicy("Yes, dogs are welcome at the Larkshall. Parking nearby.")?.policy).toBe("welcome");
  });

  it("reads a refusal only in a form that refuses dogs at the whole pub", () => {
    expect(statedDogPolicy("Sorry, no dogs.")).toEqual({ policy: "not-allowed", evidence: "Sorry, no dogs." });
    for (const refusal of [
      "No dogs allowed.",
      "Please note no dogs permitted.",
      "Dogs are not allowed in the pub.",
      "Dogs are not permitted inside the premises.",
      "We're afraid dogs are not admitted.",
      "Dogs are not welcome at the venue.",
      "We do not allow dogs.",
      "We don't accept dogs.",
      "Unfortunately we are not dog friendly.",
      "We're not dog-friendly.",
      "Only assistance dogs are allowed.",
      "Only guide dogs welcome.",
      "No dogs except assistance dogs.",
      "No dogs apart from guide dogs.",
    ]) expect(statedDogPolicy(refusal)?.policy, refusal).toBe("not-allowed");
  });

  it("leaves unknown what the page does not state as the pub's policy", () => {
    // Assistance dogs are a legal duty, not a pet policy.
    expect(statedDogPolicy("Accessibility WC - Assistance dogs welcome - Step Free Access")).toBeNull();
    // A limit on the welcome is not a welcome to the pub.
    expect(statedDogPolicy("Dogs are welcome in the garden only.")).toBeNull();
    expect(statedDogPolicy("Our dog-friendly garden is the perfect place to refuel.")).toBeNull();
    expect(statedDogPolicy("Children and dogs welcome before 8pm.")).toBeNull();
    // A guest's review and a site footer are not the pub speaking.
    expect(statedDogPolicy("Google Thanks so much for being so dog friendly Excellent food.")).toBeNull();
    expect(statedDogPolicy("Quick Links Order & Pay Gift Cards Blog Dog Friendly Pub Careers")).toBeNull();
    // Questions, food and silence.
    expect(statedDogPolicy("Are dogs allowed?")).toBeNull();
    expect(statedDogPolicy("Try our hot dogs welcome deal.")).toBeNull();
    expect(statedDogPolicy("Sunday roasts and real ales.")).toBeNull();
  });

  it("states nothing when the page both welcomes and refuses dogs", () => {
    expect(statedDogPolicy("Dog Friendly. No dogs in the restaurant after 6pm.")).toBeNull();
    expect(statedDogPolicy("Dogs are not allowed. Dog friendly garden.")).toBeNull();
    expect(statedDogPolicy("No dogs. Assistance dogs welcome.")?.policy).toBe("not-allowed");
  });

  it("reads no refusal with any other words beside it", () => {
    for (const limited of [
      "Please note no dogs are allowed in the restaurant.",
      "Dogs are not allowed after 6pm.",
      "No dogs in the dining room.",
      "No dogs in the garden.",
      "Dogs are not permitted in some areas.",
      "No dogs inside.",
      "Dogs are not permitted indoors.",
      "No dogs at weekends.",
      "No dogs on Sundays.",
      "No dogs upstairs.",
      "Dogs are not allowed in the function room.",
      "No dogs during food service.",
      "No dogs on the furniture please.",
      "We welcome all guests, except assistance dogs only policy applies.",
    ]) expect(statedDogPolicy(limited), limited).toBeNull();
  });
});

describe("statedSiteOpeningHours", () => {
  it("reads a week under an opening-hours label, ranges and closing past midnight included", () => {
    const page = "Book a table Opening Times Monday - Thursday 12pm - 11pm Friday - Saturday 12pm - 12am Sunday 12pm - 10.30pm Food Service Times Monday - Sunday 12pm - 9pm";
    const stated = statedSiteOpeningHours(page);
    expect(stated?.hours).toEqual({
      1: [{ opens: "12:00", closes: "23:00" }],
      2: [{ opens: "12:00", closes: "23:00" }],
      3: [{ opens: "12:00", closes: "23:00" }],
      4: [{ opens: "12:00", closes: "23:00" }],
      5: [{ opens: "12:00", closes: "00:00" }],
      6: [{ opens: "12:00", closes: "00:00" }],
      0: [{ opens: "12:00", closes: "22:30" }],
    });
    expect(stated?.evidence).toBe("Opening Times Monday - Thursday 12pm - 11pm Friday - Saturday 12pm - 12am Sunday 12pm - 10.30pm");
    expect(stated?.statedDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("reads markdown tables, glued day names, today labels, closed days and bracketed notes", () => {
    expect(statedSiteOpeningHours("Opening Times | Day: | Opening Time | | --- | --- | | Monday: | 12:00 - 23:00 | | Tuesday: | Closed |")?.hours)
      .toEqual({ 1: [{ opens: "12:00", closes: "23:00" }], 2: [] });
    expect(statedSiteOpeningHours("Opening Times Monday - Saturday11:00 - 23:00 Sunday12:00 - 22:30 Social")?.statedDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(statedSiteOpeningHours("Opening Hours Today (Mon) 11:30am - 11:00pm Tuesday 11:30am - 11:00pm")?.hours)
      .toEqual({ 1: [{ opens: "11:30", closes: "23:00" }], 2: [{ opens: "11:30", closes: "23:00" }] });
    expect(statedSiteOpeningHours("Opening Times Monday: 12pm-11pm (Kitchen open 12pm - 10pm) Tuesday: 12pm-1am (Kitchen open 12pm - 10pm)")?.hours)
      .toEqual({ 1: [{ opens: "12:00", closes: "23:00" }], 2: [{ opens: "12:00", closes: "01:00" }] });
    expect(statedSiteOpeningHours("Opening hours Mon - Weds 4pm - 11pm Thurs 12 noon - 11pm")?.hours?.[4]).toEqual([{ opens: "12:00", closes: "23:00" }]);
  });

  it("keeps two windows on a day and leaves days the page does not state out", () => {
    const stated = statedSiteOpeningHours("Opening hours: Saturday 12pm - 3pm, 5pm - 11pm");
    expect(stated?.hours).toEqual({ 6: [{ opens: "12:00", closes: "15:00" }, { opens: "17:00", closes: "23:00" }] });
    expect(stated?.statedDays).toEqual([6]);
  });

  it("reads no other block and no time without a meridiem", () => {
    expect(statedSiteOpeningHours("Kitchen Hours Monday 12pm - 9pm")).toBeNull();
    expect(statedSiteOpeningHours("Opening hours Kitchen Monday 12pm - 9pm")).toBeNull();
    expect(statedSiteOpeningHours("Christmas opening hours Monday 12pm - 6pm")).toBeNull();
    expect(statedSiteOpeningHours("[Opening Times](https://pub.example/opening-times/) Monday 12pm - 11pm")).toBeNull();
    expect(statedSiteOpeningHours("Opening hours Monday 11 - 5")).toBeNull();
    expect(statedSiteOpeningHours("Monday 12pm - 11pm Tuesday 12pm - 11pm")).toBeNull();
  });

  it("reads a clock without a meridiem only when its window reads as 24-hour", () => {
    expect(statedSiteOpeningHours("Opening Hours Monday - Saturday 12:00 - 11:00 Sunday 12:00 - 10:30")).toBeNull();
    expect(statedSiteOpeningHours("Opening hours Monday - Thursday 5:00 - 11:00pm")).toBeNull();
    expect(statedSiteOpeningHours("Opening hours Monday 11:00am - 23:00")).toBeNull();
    expect(statedSiteOpeningHours("Opening hours Monday 12pm - 3pm, 5:00 - 11:00")).toBeNull();
    expect(statedSiteOpeningHours("Opening hours Monday 08:00 - 11:00")?.hours).toEqual({ 1: [{ opens: "08:00", closes: "11:00" }] });
    expect(statedSiteOpeningHours("Opening hours Monday 11:00 - 00:00")?.hours).toEqual({ 1: [{ opens: "11:00", closes: "00:00" }] });
    expect(statedSiteOpeningHours("Opening hours Monday 12 noon - 23:00")?.hours).toEqual({ 1: [{ opens: "12:00", closes: "23:00" }] });
  });

  it("stops before hours that hold only under a condition", () => {
    expect(statedSiteOpeningHours("Opening times | Monday | 12:00-21:00 | | Wednesday | 12:00-02:00 for club nights | | Thursday | 12:00-21:00 |")?.hours)
      .toEqual({ 1: [{ opens: "12:00", closes: "21:00" }] });
  });

  it("states nothing when a day is stated twice two ways or its windows overlap", () => {
    expect(statedSiteOpeningHours("Opening hours Monday 12pm - 11pm Monday 1pm - 11pm")).toBeNull();
    expect(statedSiteOpeningHours("Opening hours Monday 12pm - 6pm, 5pm - 11pm")).toBeNull();
    expect(statedSiteOpeningHours("Opening hours Monday 12pm - 11pm. Footer. Opening hours Monday 11am - 11pm")).toBeNull();
  });

  it("takes the fullest of blocks that agree", () => {
    const page = "Opening hours Today (Mon) 12pm - 11pm Footer Opening Hours Monday 12pm - 11pm Tuesday 12pm - 11pm";
    expect(statedSiteOpeningHours(page)?.evidence).toBe("Opening Hours Monday 12pm - 11pm Tuesday 12pm - 11pm");
  });
});

describe("siteFactsRows", () => {
  const pages: Record<string, string> = {
    "node/1": "Welcome. We're dog-friendly. Opening hours Monday 12pm - 11pm",
    "node/2": "Opening hours Monday 12pm - 11pm Tuesday 12pm - 10pm",
    "node/3": "Opening hours Monday 12pm - 11pm Tuesday 12pm - 10pm",
    "node/4": "We're dog-friendly.",
    "node/5": "Sunday roasts.",
    "venue/venue-6": "We're dog-friendly.",
  };
  const read = (sourceUrl: string, status = "ok"): KeptPageRead => ({ status, name: "Pub", venueId: "venue-x", sourceUrl });
  const reads: Record<string, KeptPageRead> = {
    "node/1": read("https://one.example/"),
    "node/2": read("https://chain.example/pubs/two"),
    "node/3": read("https://chain.example/pubs/three"),
    "node/4": read("https://shared.example/"),
    "node/5": read("https://five.example/"),
    "venue/venue-6": read("https://six.example/", "site-of-another-pub"),
  };
  const { rows, skipCounts } = siteFactsRows({
    reads,
    loadPage: (osmId) => (pages[osmId] ? { text: pages[osmId]!, readAt: "2026-10-05T10:00:00.000Z" } : null),
    isChainPage: (url) => url === "https://shared.example/",
  });

  it("keeps a read the amenity run finished and records its page, day and passages", () => {
    expect(rows.map((row) => row.osmId)).toEqual(["node/1"]);
    expect(rows[0]).toMatchObject({ sourceUrl: "https://one.example/", readOn: "2026-10-05", dogs: { policy: "welcome" } });
    expect(rows[0]?.hours?.statedDays).toEqual([1]);
  });

  it("drops chain pages and a passage two pubs on one host state word for word, and skips unfinished reads", () => {
    expect(skipCounts).toEqual({ "chain-page": 1, "chain-hours-passage": 2, "page-stated-neither": 1 });
  });
});

describe("venue site facts", () => {
  const venue = slimVenueToPin({ id: "venue-a", name: "Test Arms", lat: 51.5, lng: -0.1, borough: "Camden", cheapestPrice: null });
  const facts = venueSiteFactsFromRow({
    venueId: "venue-a",
    sourceUrl: "https://test.example/",
    readOn: "2026-10-05",
    dogs: { policy: "welcome", evidence: "Dog Friendly" },
    hours: { hours: { 1: [{ opens: "12:00", closes: "23:00" }] }, statedDays: [1], evidence: "Opening hours Monday 12pm - 11pm" },
  });

  it("refuses a malformed row", () => {
    expect(venueSiteFactsFromRow({ sourceUrl: "javascript:alert(1)", readOn: "2026-10-05", dogs: { policy: "welcome", evidence: "x" } })).toBeNull();
    expect(venueSiteFactsFromRow({ sourceUrl: "https://a.example/", readOn: "2026-10-05", dogs: { policy: "maybe", evidence: "x" } })).toBeNull();
    expect(venueSiteFactsFromRow({ sourceUrl: "https://a.example/", readOn: "2026-10-05", hours: { hours: { 1: [{ opens: "25:00", closes: "23:00" }] }, evidence: "x" } })).toBeNull();
  });

  it("sets open-state hours only while the read is fresh and nothing else set them", () => {
    expect(applyVenueSiteFacts(venue, facts, new Date("2026-10-20T12:00:00Z")).openingHours).toEqual({ 1: [{ opens: "12:00", closes: "23:00" }] });
    expect(applyVenueSiteFacts(venue, facts, new Date("2026-12-20T12:00:00Z")).openingHours).toBeUndefined();
    expect(applyVenueSiteFacts(venue, facts, new Date("2026-12-20T12:00:00Z")).siteFacts).toEqual(facts);
    const withHours = { ...venue, openingHours: { 1: [] } };
    expect(applyVenueSiteFacts(withHours, facts, new Date("2026-10-20T12:00:00Z")).openingHours).toEqual({ 1: [] });
  });
});

describe("committed site facts", () => {
  const file = JSON.parse(readFileSync(path.join(process.cwd(), "data/amenities/london_pub_website_hours_dogs.json"), "utf8"));

  it("holds only rows the venue detail can read, each with a passage that states its fact", () => {
    expect(file.version).toBe(1);
    expect(file.spendUsd).toBe(0);
    for (const row of file.rows) {
      expect(typeof row.venueId).toBe("string");
      expect(venueSiteFactsFromRow(row)).not.toBeNull();
      if (row.dogs) expect(statedDogPolicy(row.dogs.evidence)?.policy).toBe(row.dogs.policy);
      if (row.hours) expect(statedSiteOpeningHours(row.hours.evidence)?.hours).toEqual(row.hours.hours);
    }
  });
});
