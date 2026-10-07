import { describe, expect, it, vi } from "vitest";

import { contextDevUsage, createContextDevBudget, createPageMonitor, refreshChangedPage } from "@/lib/contextDev";
import { ambiguousPubWebsites, discoverWhatsOnPages, mergeOwnSiteListings, readPubWhatsOn } from "@/lib/harvest/contextDevWhatsOn";

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

  it("reads each complete sport fixture instead of publishing its month heading", () => {
    const text = "## October (2)\nPremier League\n10Oct10 Oct\nSat, 12:30pm\nArsenal\nVS\nLeeds\n[Book a table](https://crown.example/book?date=2026-10-10)\nPremier League\n11Oct11 Oct\nSun, 04:30pm\nLiverpool\nVS\nMan City\n[Book a table](https://crown.example/book?date=2026-10-11)";
    const result = readPubWhatsOn(pub, text, pub.website, observedAt);
    expect(result.rows.map((row) => row.title)).toEqual(["Premier League: Arsenal vs Leeds", "Premier League: Liverpool vs Man City"]);
    expect(result.rows.map((row) => row.startsAt)).toEqual(["2026-10-10T12:30:00+01:00", "2026-10-11T16:30:00+01:00"]);
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

  it("removes a cancelled listing after a complete new read and preserves unrelated sources", () => {
    const previous = readPubWhatsOn(pub, "## Pub quiz\nThursday 8 October 2026\n8pm\n", pub.website, observedAt).rows;
    const unrelated = { ...previous[0]!, id: "curated-1", source: { label: "Another publisher", url: "https://another.example/" } };
    expect(mergeOwnSiteListings([...previous, unrelated], [{ sourceUrl: pub.website, rows: [], complete: true }])).toEqual([unrelated]);
    expect(mergeOwnSiteListings(previous, [{ sourceUrl: pub.website, rows: [], complete: false }])).toEqual(previous);
  });

  it("advances a cached weekly slot without claiming another source observation", () => {
    const result = readPubWhatsOn(pub, "## Pub Quiz\nEvery Thursday at 8pm\n", pub.website, observedAt, "2026-10-16T09:00:00.000Z");
    expect(result.rows).toMatchObject([{ startsAt: "2026-10-22T20:00:00+01:00", observedAt }]);
  });
});

describe("Context.dev account and monitors", () => {
  it("reads the live credit balance without spending a scrape credit", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ credits_remaining: 73, period: null, next_refill: null }), { headers: { "content-type": "application/json" } }));
    expect(await contextDevUsage({ env: { CONTEXT_DEV_API_KEY: "test", NODE_ENV: "test" }, fetchImpl })).toMatchObject({ status: "ok", creditsRemaining: 73 });
  });

  it("refuses a monitor before calling the provider when robots denies the page", async () => {
    const fetchImpl = vi.fn();
    const result = await createPageMonitor(pub.website, "Crown events", { env: { CONTEXT_DEV_API_KEY: "test", NODE_ENV: "test" }, robots: async () => ({ allowed: false, reason: "robots-disallowed", evidence: "Disallow: /" }), fetchImpl });
    expect(result).toMatchObject({ status: "error", error: { code: "ROBOTS_REFUSED" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not scrape or restamp a monitored page when the provider reports no new changes", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "change-1", url: pub.website }], has_more: false }), { headers: { "content-type": "application/json" } }));
    const budget = createContextDevBudget(1);
    const result = await refreshChangedPage(pub.website, "monitor-1", ["change-1"], { env: { CONTEXT_DEV_API_KEY: "test", NODE_ENV: "test" }, robots: async () => ({ allowed: true, reason: "allowed", evidence: "Allow: /" }), fetchImpl, budget });
    expect(result).toEqual({ status: "unchanged" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.spent()).toBe(0);
  });
});
