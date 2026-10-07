import { describe, expect, it, vi } from "vitest";

import { contextDevUsage } from "@/lib/contextDev";
import { ambiguousPubWebsites, discoverWhatsOnPages, harvestCredits, isPartnerFixturePage, mergeOwnSiteListings, readPubWhatsOn } from "@/lib/harvest/contextDevWhatsOn";

const pub = { osmId: "node/1", name: "The Crown", venueId: "venue-crown", lat: 51.51, lng: -0.12, website: "https://crown.example/" };
const observedAt = "2026-10-07T09:00:00.000Z";

describe("London pub own-site harvest", () => {
  it("refuses a shared home page for geographically distinct pubs", () => {
    const other = { ...pub, osmId: "node/2", lat: 51.6, website: "http://www.crown.example/" };
    expect(ambiguousPubWebsites([pub, other])).toEqual(new Set([pub.website, other.website]));
    expect(ambiguousPubWebsites([pub, { ...other, lat: pub.lat }])).toEqual(new Set());
  });
  it("follows published event and offer links without visiting a sister pub or private hire", () => {
    const markdown = "[What's on](/pubs/london/crown/whats-on)\n[Other pub](/pubs/london/swan/events)\n[Hire](/pubs/london/crown/event-spaces)\n[Offers](/pubs/london/crown/offers)\n[Tickets](https://tickets.example/events)";
    expect(discoverWhatsOnPages(markdown, "https://pubs.example/pubs/london/crown")).toEqual([
      "https://pubs.example/pubs/london/crown/whats-on", "https://pubs.example/pubs/london/crown/offers",
    ]);
  });

  it("publishes a stated future quiz with its page and observation date", () => {
    const result = readPubWhatsOn(pub, "## Pub quiz\nThursday 8 October 2026\nStarts at 8pm\n", pub.website, observedAt);
    expect(result.rows).toMatchObject([{ venueId: "venue-crown", kind: "quiz", startsAt: "2026-10-08T20:00:00+01:00", source: { url: pub.website }, observedAt, confidence: "listed" }]);
  });

  it("does not convert opening hours or generic live-sport claims into listings", () => {
    const result = readPubWhatsOn(pub, "## Opening Hours\nMonday - Friday 12pm - 11pm\n## Live sport\nWe show all matches.\n", pub.website, observedAt);
    expect(result.rows).toEqual([]);
    expect(result.hours?.hours[1]).toEqual([{ opens: "12:00", closes: "23:00" }]);
  });

  it("does not borrow a happy-hour closing time for a quiz in a separate list item", () => {
    const result = readPubWhatsOn(pub, "## Features & Entertainment\n- Live Sports Screenings\n- Traditional Pub Games\n- Quiz Night (Every Thursday)\n- Happy Hour (Mon-Fri, 4-7pm)\n- Outdoor Seating Area\n", pub.website, observedAt);
    expect(result.rows.filter((row) => row.kind === "quiz")).toEqual([]);
  });

  it("does not merge a calendar link with the next event's teaser clock", () => {
    const result = readPubWhatsOn(pub, "# Autumn Showcase\n- Wednesday, October 28, 2026\n- 7:30 PM 10:30 PM 19:30 22:30\n- [Google Calendar](https://calendar.example/event) [ICS](https://crown.example/event?format=ical)\nWednesday 28th October\nSvisi\nANN-KNOWN\nDJ Set from Tony Bagnari\n[The Karens: Classic Rock Covers](https://crown.example/karens)[Oct 30 7:30 PM19:30](https://crown.example/karens)\n", pub.website, observedAt);
    expect(result.rows).toEqual([]);
  });

  it("reads the George and Vulture's weekly quiz without inventing a duration", () => {
    const result = readPubWhatsOn(pub, "### TUESDAYS\nQUIZ NIGHT\n7.30PM START\n\n### PRIVATE HIRE\n", pub.website, observedAt);
    expect(result.rows).toMatchObject([{ kind: "quiz", title: "QUIZ NIGHT", startsAt: "2026-10-13T19:30:00+01:00" }]);
    expect(result.rows[0]?.endsAt).toBeUndefined();
  });

  it("rejects a past date without a year, a fortnightly slot and a doors-only time", () => {
    const result = readPubWhatsOn(pub, "## Live music\n6 October\n8pm\n## Quiz night\nEvery other Tuesday at 8pm\n## Live band\nEvery Friday, doors at 7pm\n", pub.website, observedAt);
    expect(result.rows).toEqual([]);
  });

  it("uses a stated start time instead of the earlier doors time", () => {
    const result = readPubWhatsOn(pub, "## Live band\nFriday 9 October 2026\nDoors 7pm. Starts at 8pm.\n", pub.website, observedAt);
    expect(result.rows).toMatchObject([{ startsAt: "2026-10-09T20:00:00+01:00" }]);
  });

  it("does not combine two different dates within one card", () => {
    const result = readPubWhatsOn(pub, "## Live music\nThursday 8 October 2026\nFriday 9 October 2026 at 8pm\n", pub.website, observedAt);
    expect(result.rows).toEqual([]);
  });

  it("attaches a preceding schedule to its own heading rather than the previous card", () => {
    const result = readPubWhatsOn(pub, "Every Friday and Saturday | 8pm\n### Live Music\nJoin us every Friday and Saturday night.\nEvery Thursday | 7pm\n### Pub Quiz\nEvery Thursday from 7pm.\n", pub.website, observedAt);
    expect(result.rows.filter((row) => row.kind === "music").map((row) => row.startsAt)).toEqual(["2026-10-09T20:00:00+01:00", "2026-10-10T20:00:00+01:00"]);
    expect(result.rows.find((row) => row.kind === "quiz")?.startsAt).toBe("2026-10-08T19:00:00+01:00");
  });

  it("does not borrow a Friday clock for Thursday's quiz", () => {
    const result = readPubWhatsOn(pub, "THURSDAY 8:30 PM\n#### QUIZ NIGHT\nTest your knowledge every Thursday.\nFRIDAY 9:00 PM\n#### KARAOKE\nEvery second Friday.\n", pub.website, observedAt);
    expect(result.rows).toMatchObject([{ kind: "quiz", startsAt: "2026-10-08T20:30:00+01:00" }]);
    expect(result.rows).toHaveLength(1);
  });

  it("publishes no partner fixture whose date only its gated booking link states", () => {
    const text = "## October (2)\nPremier League\n10Oct10 Oct\nSat, 12:30pm\nArsenal\nVS\nLeeds\n[Book a table](https://crown.example/book?sportId=1&date=2026-10-10)\nPremier League\n11Oct11 Oct\nSun, 04:30pm\nLiverpool\nVS\nMan City\n[Book a table](https://crown.example/book?sportId=2&date=2026-10-11)";
    const result = readPubWhatsOn(pub, text, pub.website, observedAt);
    expect(result.rows).toEqual([]);
    expect(result.drops).toContainEqual({ title: "October (2)", reason: "incomplete-fixture" });
  });

  it("names a fixture once and drops its booking sentence when the heading already states it", () => {
    const text = "Premier League\n\n#### Premier League: Arsenal vs Leeds United\n\nSat 10 October 2026 12:30pm KO All Venues\n\nArsenal vs Leeds United live at The Crown on TNT Sports. Reserve your table for the match.\n";
    expect(readPubWhatsOn(pub, text, pub.website, observedAt).rows.map((row) => row.title)).toEqual(["Premier League: Arsenal vs Leeds United"]);
    const plain = readPubWhatsOn(pub, "## Premier League\nSat 10 October 2026 12:30pm\nArsenal vs Leeds United\n", pub.website, observedAt);
    expect(plain.rows.map((row) => row.title)).toEqual(["Premier League: Arsenal vs Leeds United"]);
  });

  it("publishes a title without the page's Markdown escapes", () => {
    const result = readPubWhatsOn(pub, "**Upcoming October events**\n\n- **Every Tuesday**\\- **Pub Quiz** 8pm - £2 CASH to play\n", pub.website, observedAt);
    expect(result.rows).toMatchObject([{ kind: "quiz", title: "Every Tuesday- Pub Quiz 8pm - £2 CASH to play", startsAt: "2026-10-13T20:00:00+01:00" }]);
  });

  it("rejects another named venue and sign-up times without a stated performance start", () => {
    expect(readPubWhatsOn(pub, "## Open Mic Night at The Prince Albert\nEvery Tuesday | Sign-ups from 7pm\n", pub.website, observedAt).rows).toEqual([]);
    expect(readPubWhatsOn(pub, "## Open Mic Night\nEvery Tuesday | Sign-ups from 7pm\n", pub.website, observedAt).rows).toEqual([]);
  });

  it("does not treat a kitchen's closing clock as a sports fixture or borrow another day's music clock", () => {
    expect(readPubWhatsOn(pub, "## Watch the Premier League\nEvery match screened, food until 9pm, with a full Saturday programme.\n", pub.website, observedAt).rows).toEqual([]);
    const result = readPubWhatsOn(pub, "## Live Music\nThursdays feature folk music from 8pm. On Fridays, a live band starts at 8pm. On Saturdays, DJs play the classics.\n", pub.website, observedAt);
    expect(result.rows.map((row) => row.startsAt)).toEqual(["2026-10-08T20:00:00+01:00", "2026-10-09T20:00:00+01:00"]);
  });

  it("reads a happy-hour window in its heading without publishing a standard drink price", () => {
    const result = readPubWhatsOn(pub, "# happy hour every thurs-sat 5-9pm\nTwo for one cocktails\n", pub.website, observedAt);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ kind: "deal", startsAt: "2026-10-08T17:00:00+01:00", endsAt: "2026-10-08T21:00:00+01:00" });
    expect(result.rows.every((row) => row.priceGbp === undefined)).toBe(true);
  });

  it("reads a daily happy-hour subheading but excludes a seasonal expired window", () => {
    const result = readPubWhatsOn(pub, "# HAPPY HOURS\n### Everyday 12:00-21:00\nCocktail offers\n### Everyday 16:30-18:30 (Until 31st August)\n", pub.website, observedAt);
    expect(result.rows).toHaveLength(7);
    expect(result.rows.every((row) => row.startsAt?.includes("T12:00:"))).toBe(true);
  });

  it("dates each fixture from the date and clock lines above its own heading", () => {
    const text = [
      "## Watch football with us", "Friday 9 October", "8:00PM",
      "### Football: EFL Championship", "West Ham **vs** QPR", "[Book now](https://book.example/1)",
      "Saturday 10 October", "12:30PM",
      "### Football: Premier League", "Arsenal **vs** Leeds", "[Book now](https://book.example/2)",
      "5:30PM",
      "### Football: Premier League", "Man United **vs** Tottenham", "[Book now](https://book.example/3)",
      "Sunday 11 October", "12:00PM",
      "### Football: Premier League", "Liverpool **vs** Man City", "[Book now](https://book.example/4)",
    ].join("\n\n");
    expect(readPubWhatsOn(pub, text, pub.website, observedAt).rows.map((row) => [row.title, row.startsAt])).toEqual([
      ["Football: Premier League: Arsenal vs Leeds", "2026-10-10T12:30:00+01:00"],
      ["Football: Premier League: Man United vs Tottenham", "2026-10-10T17:30:00+01:00"],
      ["Football: Premier League: Liverpool vs Man City", "2026-10-11T12:00:00+01:00"],
    ]);
  });

  it("dates each fixture from its own lines when no booking link closes the previous card", () => {
    const text = "## What's coming up\nShow me:\nFriday 9 October\n7:45PM\n### Premier League: Spurs vs Leeds\nSpurs\nLeeds\nSaturday 10 October\n12:30PM\n### Premier League: Arsenal vs Leeds\nArsenal\nLeeds\n";
    expect(readPubWhatsOn(pub, text, pub.website, observedAt).rows.map((row) => [row.title, row.startsAt])).toEqual([
      ["Premier League: Spurs vs Leeds", "2026-10-09T19:45:00+01:00"],
      ["Premier League: Arsenal vs Leeds", "2026-10-10T12:30:00+01:00"],
    ]);
  });

  it("does not carry a list's day past a later stated date or into a date range", () => {
    const text = "## Fixtures\nSaturday 10 October\n2:10PM\n### Premier League: Arsenal vs Leeds\nArsenal\nSaturday 6 February '27\n2:10PM\n### Premier League: Spurs vs Leeds\nSpurs\n";
    expect(readPubWhatsOn(pub, text, pub.website, observedAt).rows.map((row) => [row.title, row.startsAt])).toEqual([
      ["Premier League: Arsenal vs Leeds", "2026-10-10T14:10:00+01:00"],
    ]);
    expect(readPubWhatsOn(pub, "# Events\n13 \\-27 October 9.30am\n### Pub Quiz\nOctober 13th & 27th launch our brand new quiz\n", pub.website, observedAt).rows).toEqual([]);
  });

  it("keeps an event's own date and time when a deeper About or Details heading follows", () => {
    const quiz = readPubWhatsOn(pub, "# Quiz Night\nThursday 15 October\n8pm\n## About\nJoin us for the pub quiz\n", pub.website, observedAt);
    expect(quiz.rows.map((row) => [row.kind, row.title, row.startsAt])).toEqual([["quiz", "Quiz Night", "2026-10-15T20:00:00+01:00"]]);
    const jazz = readPubWhatsOn(pub, "## Live Music: The Jazz Trio\nSaturday 17 October 9pm\n### Details\nFree entry\n", pub.website, observedAt);
    expect(jazz.rows.map((row) => [row.kind, row.title, row.startsAt])).toEqual([["music", "Live Music: The Jazz Trio", "2026-10-17T21:00:00+01:00"]]);
  });

  it("does not carry a fixture list's day into a weekly listing", () => {
    const text = "## Fixtures\nSaturday 10 October\n12:30PM\n### Premier League: Arsenal vs Leeds\nArsenal\nEvery Friday\n9pm\n### Pub Quiz\nOur weekly quiz\n";
    expect(readPubWhatsOn(pub, text, pub.website, observedAt).rows.map((row) => [row.title, row.startsAt])).toEqual([
      ["Premier League: Arsenal vs Leeds", "2026-10-10T12:30:00+01:00"],
      ["Pub Quiz", "2026-10-09T21:00:00+01:00"],
    ]);
  });

  it("gives an unqualified clock to the heading's kind when the description mentions another kind", () => {
    const result = readPubWhatsOn(pub, "## Pub Quiz\nEvery Tuesday at 8pm. Prizes include tickets to our live music night.\n", pub.website, observedAt);
    expect(result.rows.map((row) => [row.kind, row.title, row.startsAt])).toEqual([["quiz", "Pub Quiz", "2026-10-13T20:00:00+01:00"]]);
  });

  it("does not give a section heading its first fixture's time", () => {
    const text = "## Watch live rugby with us\n\nSaturday 17 October\n\n8:00PM\n\n### Rugby Union: European Challenge Cup\n\nScarlets **vs** Newcastle Red Bulls\n";
    expect(readPubWhatsOn(pub, text, pub.website, observedAt).rows).toEqual([]);
  });

  it("keeps a quiz paragraph's start time with the quiz instead of the sport heading below it", () => {
    const text = "### QUIZ NIGHT\n\nTHURSDAY NIGHTS\n\nEvery Thursday night the Quiz-Masters run a general knowledge quiz. Start time is 9:15pm but arrive early.\n\n### LIVE SPORT\n\nWEEKDAYS & WEEKENDS\n\nWe have Sky Sports and BT Sport - showing all the latest games\n";
    expect(readPubWhatsOn(pub, text, pub.website, observedAt).rows.map((row) => [row.kind, row.title, row.startsAt])).toEqual([
      ["quiz", "QUIZ NIGHT", "2026-10-08T21:15:00+01:00"],
    ]);
  });

  it("does not give one kind the clock another kind states in a shared section", () => {
    const result = readPubWhatsOn(pub, "## Entertainment\nLive sport on every screen.\nPub quiz every Thursday, starts at 8pm.\n", pub.website, observedAt);
    expect(result.rows).toEqual([]);
    expect(result.drops).toContainEqual({ title: "Entertainment", reason: "mixed-kinds" });
  });

  it("publishes a first-party listing whose title starts with a month", () => {
    const result = readPubWhatsOn(pub, "## October Pub Quiz\nThursday 15 October 2026\nStarts at 8pm\n", pub.website, observedAt);
    expect(result.rows).toMatchObject([{ kind: "quiz", title: "October Pub Quiz", startsAt: "2026-10-15T20:00:00+01:00" }]);
  });

  it("names only Greene King's partner fixture pages as partner fixtures", () => {
    expect(isPartnerFixturePage("https://www.greeneking.co.uk/pubs/greater-london/allsop-arms/sports/fixtures")).toBe(true);
    expect(isPartnerFixturePage("https://www.greeneking.co.uk/pubs/greater-london/allsop-arms/whats-on")).toBe(false);
    expect(isPartnerFixturePage("https://wolfpackbars.com/sports/fixtures")).toBe(false);
  });

  it("publishes one pub's slot once when two of its pages list it", () => {
    const home = readPubWhatsOn(pub, "## Live Music from 7pm\nEvery Sunday evening, live music from 7pm.\n", pub.website, observedAt).rows;
    const page = `${pub.website}live-music`;
    const music = readPubWhatsOn(pub, "## Live Music Every Sunday\nFrom 7pm, in the heart of Soho.\n", page, observedAt).rows;
    expect(home).toHaveLength(1);
    expect(music).toHaveLength(1);
    const merged = mergeOwnSiteListings([], [{ sourceUrl: pub.website, osmId: pub.osmId, rows: home }, { sourceUrl: page, osmId: pub.osmId, rows: music }], Date.parse(observedAt));
    expect(merged.map((row) => [row.title, row.source.url])).toEqual([["Live Music from 7pm", pub.website]]);
    const fixtures = readPubWhatsOn(pub, "## Premier League: Hull vs Everton\nSunday 11 October 2026 2pm\n## Premier League: Palace vs Forest\nSunday 11 October 2026 2pm\n", page, observedAt).rows;
    const screened = mergeOwnSiteListings([], [{ sourceUrl: pub.website, osmId: pub.osmId, rows: fixtures.slice(1) }, { sourceUrl: page, osmId: pub.osmId, rows: fixtures }], Date.parse(observedAt));
    expect(screened.map((row) => row.title).sort()).toEqual(["Premier League: Hull vs Everton", "Premier League: Palace vs Forest"]);
  });

  it("removes a cancelled listing after a new read and preserves unrelated sources", () => {
    const previous = readPubWhatsOn(pub, "## Pub quiz\nThursday 8 October 2026\n8pm\n", pub.website, observedAt).rows;
    const unrelated = { ...previous[0]!, id: "curated-1", source: { label: "Another publisher", url: "https://another.example/" } };
    expect(mergeOwnSiteListings([...previous, unrelated], [{ sourceUrl: pub.website, osmId: pub.osmId, rows: [] }], Date.parse(observedAt))).toEqual([unrelated]);
    expect(mergeOwnSiteListings(previous, [], Date.parse(observedAt))).toEqual(previous);
  });

  it("moves a rescheduled kickoff from a page that also drops records, instead of listing both times", () => {
    const page = (time: string) => `## October (1)\nPremier League\n## Live sport: Arsenal v Leeds\nSaturday 10 October 2026\nKick-off ${time}\n`;
    const before = readPubWhatsOn(pub, page("3pm"), pub.website, observedAt);
    const after = readPubWhatsOn(pub, page("5:30pm"), pub.website, "2026-10-08T09:00:00.000Z");
    expect(after.drops).not.toEqual([]);
    const merged = mergeOwnSiteListings(before.rows, [{ sourceUrl: pub.website, osmId: pub.osmId, rows: after.rows }], Date.parse("2026-10-08T09:00:00.000Z"));
    expect(merged.map((row) => row.startsAt)).toEqual(["2026-10-10T17:30:00+01:00"]);
  });

  it("lets a held listing go once its time has passed", () => {
    const held = readPubWhatsOn(pub, "## Pub quiz\nThursday 8 October 2026\n8pm\n", pub.website, observedAt).rows;
    expect(mergeOwnSiteListings(held, [], Date.parse("2026-10-09T09:00:00.000Z"))).toEqual([]);
  });

  it("advances a cached weekly slot without claiming another source observation", () => {
    const result = readPubWhatsOn(pub, "## Pub Quiz\nEvery Thursday at 8pm\n", pub.website, observedAt, "2026-10-16T09:00:00.000Z");
    expect(result.rows).toMatchObject([{ startsAt: "2026-10-22T20:00:00+01:00", observedAt }]);
  });
});

describe("Context.dev harvest allowance", () => {
  const plan = { creditsAtStart: 1000, maxCredits: 950 };

  it("keeps the completed 950-credit harvest closed after a 1,000-credit refill", () => {
    expect(harvestCredits(plan, { creditsAfter: 50 }, 1050, 50)).toEqual({ spent: 950, available: 0 });
    expect(harvestCredits(plan, { creditsSpent: 950, creditsAfter: 1050 }, 1050, 50)).toEqual({ spent: 950, available: 0 });
  });

  it("counts this harvest's own requests and never reports negative spending", () => {
    expect(harvestCredits(plan, { creditsSpent: 100, creditsAfter: 1050 }, 1050, 50)).toEqual({ spent: 100, available: 850 });
    expect(harvestCredits(plan, { creditsAfter: 1050 }, 1050, 50)).toEqual({ spent: 950, available: 0 });
  });
});

describe("Context.dev account", () => {
  it("reads the live credit balance without spending a scrape credit", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ credits_remaining: 73, period: null, next_refill: null }), { headers: { "content-type": "application/json" } }));
    expect(await contextDevUsage({ env: { CONTEXT_DEV_API_KEY: "test", NODE_ENV: "test" }, fetchImpl })).toMatchObject({ status: "ok", creditsRemaining: 73 });
  });
});
