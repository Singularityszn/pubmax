import { describe, expect, it } from "vitest";

import {
  openCrawlShareAreaLine,
  openCrawlShareDescription,
  openCrawlSharePlacesLine,
  openCrawlShareTitle,
  openCrawlShareWhen,
  type OpenCrawlShareCard,
} from "@/lib/openCrawlShareCard";

const CARD: OpenCrawlShareCard = {
  crewId: "50000000-0000-4000-8000-000000000001",
  title: "Thursday in Soho",
  hostHandle: "scouthost",
  // 19:00 London time on Thu 12 Nov 2026 (GMT).
  startsAt: "2026-11-12T19:00:00.000Z",
  meetingPubName: "The Blue Posts",
  area: { name: "Piccadilly & Soho", relation: "inside" },
  placesLeft: 5,
  spendBand: { minGbp: 4.5, maxGbp: 6.2 },
};

describe("open crawl link preview words", () => {
  it("titles the link with the night and the host's public handle", () => {
    expect(openCrawlShareTitle(CARD)).toBe("Thursday in Soho · open crawl hosted by @scouthost");
  });

  it("describes day, time, area, meeting pub, places left and price band", () => {
    expect(openCrawlShareDescription(CARD)).toBe(
      "Thu 12 Nov, 19:00 in Piccadilly & Soho. Meet at The Blue Posts. 5 places left. £4.50–£6.20 per pint.",
    );
  });

  it("reads the day in London time across the clock change", () => {
    // 18:30 UTC in August is 19:30 BST.
    expect(openCrawlShareWhen("2026-08-21T18:30:00.000Z")).toBe("Fri 21 Aug, 19:30");
  });

  it("drops a fact it does not have rather than guessing", () => {
    expect(
      openCrawlShareDescription({ ...CARD, area: null, placesLeft: null, spendBand: null }),
    ).toBe("Thu 12 Nov, 19:00. Meet at The Blue Posts.");
  });

  it("says near for a pub in the outer band and Full at the cap", () => {
    expect(openCrawlShareAreaLine({ name: "Camden", relation: "nearby" })).toBe("near Camden");
    expect(openCrawlSharePlacesLine(0)).toBe("Full");
    expect(openCrawlSharePlacesLine(1)).toBe("1 place left");
  });

  it("names no member and no stop", () => {
    const text = `${openCrawlShareTitle(CARD)} ${openCrawlShareDescription(CARD)}`;
    expect(text).not.toMatch(/venue-|member/i);
  });
});
