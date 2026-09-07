// Where /out's listings may come from, and what each source's rows look like.
//
// The captain asked for adapters for two more event sources with real event
// pages, DICE and Skiddle, IF their robots and terms permit a read. THE
// ALLOW-LIST DECIDES, and it refused both scraping paths, so this file is the
// record of that answer rather than the fence around a new scraper:
//
//  - DICE (dice.fm): robots.txt disallows the headless-renderer class our
//    fetcher belongs to and sets `Content-Signal: use=reference`. Re-read
//    2026-09-07, unchanged. No adapter is built, and none may be.
//  - Skiddle: robots.txt would admit the listing path, but Skiddle's terms make
//    the events data non-commercial without written approval. The PERMITTED
//    path is the official API, and that adapter already exists
//    (lib/events/skiddle.ts) behind SKIDDLE_API_KEY and the brand-asset fence.
//  - Common: permitted, narrowly, and its reader already runs
//    (scripts/whatson/commonRefresh.mjs). Its rows join the same file /out
//    serves, so the named slot the captain asked for is filled.
//
// The fixtures below are one raw payload per source, taken through the real
// normaliser, so a row from any of the three arrives on /out as a whole row: a
// title, a place, a time, a kind, and a credit that opens the source's own
// event page.

import { describe, expect, it } from "vitest";

import { createSkiddleProvider } from "@/lib/events/skiddle";
import { createTicketmasterProvider } from "@/lib/events/ticketmaster";
import { harvestSource } from "@/lib/harvest/sourcePolicy";
import { outRowSourceCredit } from "@/lib/out/attribution";
import { outListingKind } from "@/lib/out/listingKind";
import { outListingRoute } from "@/lib/out/listingRoute";
import { groupOutListings } from "@/lib/outDesktopGrouping";
import {
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
} from "@/lib/whatson/eventNormalise.mjs";
import { toCommonEventRow } from "@/scripts/whatson/commonRefresh.mjs";
import type { WhatsOnRow } from "@/lib/whatsOn";

const OBSERVED_AT = "2026-09-07T17:00:00.000Z";
const NOW = Date.parse("2026-09-07T18:00:00.000Z");

const TICKETMASTER_PAYLOAD = {
  _embedded: {
    events: [
      {
        id: "G5vYZ9Xk1",
        name: "Fontaines D.C.",
        url: "https://www.ticketmaster.co.uk/event/G5vYZ9Xk1",
        dates: { start: { dateTime: "2026-09-07T19:30:00Z" } },
        classifications: [
          { segment: { name: "Music" }, genre: { name: "Rock" } },
        ],
        priceRanges: [{ currency: "GBP", min: 32.5 }],
        _embedded: {
          venues: [
            {
              name: "The Lexington",
              location: { latitude: "51.5326", longitude: "-0.1119" },
            },
          ],
        },
      },
    ],
  },
};

const SKIDDLE_PAYLOAD = {
  results: [
    {
      id: "40213371",
      eventname: "Hard Techno All Night",
      eventcode: "CLUB",
      link: "https://www.skiddle.com/e/40213371",
      startdate: "2026-09-07T22:00:00",
      genre: "Techno",
      entryprice: "12.00",
      venue: {
        name: "Corsica Studios",
        latitude: "51.4938",
        longitude: "-0.0994",
      },
    },
  ],
};

const COMMON_POST = {
  url: "https://www.common-social.com/post/supper-club-at-the-eagle",
  parsed: {
    title: "Supper club at The Eagle",
    placeName: "The Eagle",
    dateText: "7 Sep",
  },
};

function ticketmasterRow(): WhatsOnRow {
  const { rows } = normaliseTicketmasterEvents(TICKETMASTER_PAYLOAD, {
    observedAt: OBSERVED_AT,
  });
  return rows[0] as WhatsOnRow;
}

function skiddleRow(): WhatsOnRow {
  const { rows } = normaliseSkiddleEvents(SKIDDLE_PAYLOAD, { observedAt: OBSERVED_AT });
  return rows[0] as WhatsOnRow;
}

function commonRow(): WhatsOnRow {
  return toCommonEventRow({
    url: COMMON_POST.url,
    parsed: COMMON_POST.parsed,
    observedAt: OBSERVED_AT,
    todayLondon: "2026-09-07",
  }) as WhatsOnRow;
}

describe("the allow-list is what decides a source, and it is the record", () => {
  it("refuses DICE, and names the rule that refused it", () => {
    const dice = harvestSource("dice-listings");
    expect(dice?.access.allowed).toBe(false);
    expect(dice?.access.allowed === false && dice.access.reason).toBe("robots-disallowed");
    expect(dice?.access.evidence).toContain("CloudflareBrowserRenderingCrawler");
    // Re-read for this lane rather than inherited from an older sweep.
    expect(dice?.access.checkedOn).toBe("2026-09-07");
  });

  it("refuses SCRAPING Skiddle while the official API stays the permitted path", () => {
    const skiddle = harvestSource("skiddle-listings");
    expect(skiddle?.access.allowed).toBe(false);
    expect(skiddle?.access.allowed === false && skiddle.access.reason).toBe(
      "terms-forbid-commercial-use",
    );
    expect(skiddle?.access.checkedOn).toBe("2026-09-07");
    expect(skiddle?.notes).toContain("lib/events/skiddle.ts");
    // The adapter exists and stays shut until the key and the licence allow it.
    expect(createSkiddleProvider().name).toBe("skiddle");
  });

  it("keeps Common's named slot, pointed at a real URL", () => {
    const common = harvestSource("common-social-posts");
    expect(common?.access.allowed).toBe(true);
    expect(common?.url).toBe("https://www.common-social.com/sitemap.xml");
    expect(common?.nonFirstPartyException).toBeTruthy();
  });

  it("builds no adapter for a source the allow-list refused", () => {
    const providers = [createTicketmasterProvider(), createSkiddleProvider()];
    expect(providers.map((provider) => provider.name).sort()).toEqual([
      "skiddle",
      "ticketmaster",
    ]);
    expect(providers.map((provider) => provider.name)).not.toContain("dice");
  });
});

describe("every source's rows arrive on /out as whole rows", () => {
  const cases: [string, () => WhatsOnRow, { kind: string; href: string }][] = [
    [
      "Ticketmaster",
      ticketmasterRow,
      { kind: "gig", href: "https://www.ticketmaster.co.uk/event/G5vYZ9Xk1" },
    ],
    [
      "Skiddle",
      skiddleRow,
      { kind: "club-night", href: "https://www.skiddle.com/e/40213371" },
    ],
    [
      "Common",
      commonRow,
      {
        kind: "food",
        href: "https://www.common-social.com/post/supper-club-at-the-eagle",
      },
    ],
  ];

  for (const [label, build, expected] of cases) {
    it(`carries a title, a place, a time, a kind and a real route for ${label}`, () => {
      const row = build();
      expect(row).toBeDefined();
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.placeName.length).toBeGreaterThan(0);
      expect(row.startsAt ?? row.startsDate).toBeTruthy();
      expect(outListingKind(row)).toBe(expected.kind);
      // The credit and the link are one claim: the route is the source's own
      // event page, never its front door.
      expect(outListingRoute(row)).toEqual({ href: expected.href, external: true });
      expect(outRowSourceCredit(row.source).href).toBe(expected.href);
    });
  }

  it("prints all three sources' rows in one night's group", () => {
    const rows = [ticketmasterRow(), skiddleRow(), commonRow()];
    const groups = groupOutListings(rows, NOW);
    expect(groups.flatMap((group) => group.rows)).toHaveLength(3);
    expect(groups.map((group) => group.label)).toEqual(["Tonight"]);
  });
});
