// What an /out listing claims about its source. The source label and the
// destination are one claim, so this test pins them together.
//
// 1. THE CREDIT NAMED THE WRONG PLACE. Ticketmaster's Discovery API answers
//    with white-label partner links beside its own: on the audited night six of
//    twenty-one London rows came back on universe.com. Every one printed a bare
//    "Ticketmaster" credit, so the name over the link and the address behind it
//    disagreed, and the reader only found out after the tap. A publisher's own
//    front door has the same problem in reverse - a real link that is not this
//    event - so it is credited by name and opens nothing.
//
// The rows below are the audited ones, kept verbatim, so a regression fails on
// the same data that exposed it.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OutCard } from "@/components/out/OutCard";
import { SourceCredit } from "@/components/out/SourceCredit";
import { outRowSourceCredit, outSourceLinksToEventPage } from "@/lib/out/attribution";
import { tonightRowLinks } from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

// Verbatim from GET /api/out on 30 August 2026.
const UNIVERSE_URL =
  "https://www.universe.com/events/got-soul-carnival-special-bh-sunday-30th-aug-tickets-X60KL2?ref=ticketmaster";
const TICKETMASTER_URL =
  "https://www.ticketmaster.co.uk/aap-rocky-dont-be-dumb-world-london-30-08-2026/event/35006433A0A31DDB";
const TICKETMASTER_SUBDOMAIN_URL =
  "https://theatre.ticketmaster.co.uk/book/1H8DJ-abba-voyage-admissions/#perf=1H8DJ-G8I";
const TICKETMASTER_HOME = "https://www.ticketmaster.co.uk/";

function row(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "events-tm-got-soul",
    placeName: "Pop Brixton",
    kind: "event",
    title: "Got Soul Carnival Special - BH Sunday 30th Aug",
    startsAt: "2026-08-30T19:00:00.000Z",
    source: { label: "Ticketmaster", url: UNIVERSE_URL },
    observedAt: "2026-08-30T06:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

describe("a credit names where the tap lands", () => {
  it("names the destination host when the publisher's link leaves their own", () => {
    expect(outRowSourceCredit({ label: "Ticketmaster", url: UNIVERSE_URL })).toEqual({
      label: "Ticketmaster · universe.com",
      href: UNIVERSE_URL,
    });
  });

  it("says the publisher alone when the link is on the publisher's own host", () => {
    expect(outRowSourceCredit({ label: "Ticketmaster", url: TICKETMASTER_URL })).toEqual({
      label: "Ticketmaster",
      href: TICKETMASTER_URL,
    });
  });

  it("counts a publisher's own subdomain as the publisher", () => {
    // theatre.ticketmaster.co.uk is Ticketmaster, and adding a second name to a
    // link that never left them would be noise rather than honesty.
    expect(
      outRowSourceCredit({ label: "Ticketmaster", url: TICKETMASTER_SUBDOMAIN_URL }).label,
    ).toBe("Ticketmaster");
  });

  it("keeps a venue's own listing named by its own name", () => {
    expect(
      outRowSourceCredit({
        label: "The Ivy House",
        url: "https://theivyhousenunhead.com/whats-on/quiz",
      }).label,
    ).toBe("The Ivy House");
  });
});

describe("a homepage is not an event page", () => {
  it("rejects a publisher front door with query or hash", () => {
    expect(outSourceLinksToEventPage(TICKETMASTER_HOME)).toBe(false);
    expect(outSourceLinksToEventPage("https://www.ticketmaster.co.uk")).toBe(false);
    expect(outSourceLinksToEventPage(`${TICKETMASTER_HOME}?utm_source=pubmaxx`)).toBe(false);
    expect(outSourceLinksToEventPage(`${TICKETMASTER_HOME}#event`)).toBe(false);
    expect(outSourceLinksToEventPage(`${TICKETMASTER_HOME}?utm_source=pubmaxx#event`)).toBe(false);
    expect(outSourceLinksToEventPage("not a url")).toBe(false);
  });

  it("accepts a real event route with a path segment", () => {
    expect(outSourceLinksToEventPage(TICKETMASTER_URL)).toBe(true);
    expect(outSourceLinksToEventPage(UNIVERSE_URL)).toBe(true);
    expect(outSourceLinksToEventPage(TICKETMASTER_SUBDOMAIN_URL)).toBe(true);
  });

  it("credits the publisher without a link when there is no event page", () => {
    expect(outRowSourceCredit({ label: "Ticketmaster", url: TICKETMASTER_HOME })).toEqual({
      label: "Ticketmaster",
      href: null,
    });
  });

  it("renders that credit as text rather than something that looks tappable", () => {
    const html = renderToStaticMarkup(
      SourceCredit({ source: { label: "Ticketmaster", url: TICKETMASTER_HOME } }),
    );
    expect(html).toContain("Ticketmaster");
    expect(html).not.toContain("<a");
    expect(html).toContain("outSourceCredit--unlinked");
  });
});

describe("the rendered out card", () => {
  it("prints the destination beside the publisher on a partner link", () => {
    const html = renderToStaticMarkup(createElement(OutCard, { row: row() }));
    expect(html).toContain("Ticketmaster · universe.com");
    expect(html).toContain(UNIVERSE_URL.replace(/&/g, "&amp;"));
  });
});

describe("Tonight makes the same claim the /out card makes", () => {
  it("names the destination host on a partner link", () => {
    expect(tonightRowLinks(row()).sourceLabel).toBe("Ticketmaster · universe.com");
  });

  it("falls through to the map rather than opening a front door", () => {
    const links = tonightRowLinks(
      row({
        venueId: "venue-1khnupq",
        source: { label: "Ticketmaster", url: TICKETMASTER_HOME },
      }),
    );
    expect(links.primary).toEqual({ href: "/map?sel=venue-1khnupq", external: false });
    expect(links.sourceLabel).toBe("Ticketmaster");
  });
});
