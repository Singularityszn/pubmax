import { JSDOM } from "jsdom";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: ReactElement, options?: ResponseInit) {
      super(renderToStaticMarkup(element), options);
    }
  },
}));

vi.mock("@/lib/openCrawlShareCard.server", () => ({ loadOpenCrawlShareCard: vi.fn() }));
vi.mock("@/components/social/PublicCrewRouteClient", () => ({ default: () => null }));

import Image from "@/app/social/crews/[crewId]/opengraph-image";
import { generateMetadata } from "@/app/social/crews/[crewId]/page";
import { displayHandle } from "@/lib/handleDisplay";
import { clampOgText } from "@/lib/ogCardText";
import { loadOpenCrawlShareCard } from "@/lib/openCrawlShareCard.server";
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
  spendBand: { minGbp: 4.5, maxGbp: 6.2, observedOn: "2026-11-03", sourceKind: "listed" },
};

describe("open crawl link preview words", () => {
  it("titles the link with the night and the host's public handle", () => {
    expect(openCrawlShareTitle(CARD)).toBe("Thursday in Soho · open crawl hosted by @scouthost");
  });

  it("describes day, time, area, meeting pub, places left and price band", () => {
    expect(openCrawlShareDescription(CARD)).toBe(
      "Thu 12 Nov, 19:00 in Piccadilly & Soho. Meet at The Blue Posts. 5 places left. £4.50–£6.20 per pint, listed prices seen 3 Nov 2026.",
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

async function imageLines(card: OpenCrawlShareCard): Promise<string[]> {
  vi.mocked(loadOpenCrawlShareCard).mockResolvedValue({
    ok: true,
    card,
    meetingPoint: { kind: "venue", name: card.meetingPubName, lat: 51.51, lng: -0.13 },
    stillTrue: null,
  });
  const response = await Image({ params: Promise.resolve({ crewId: card.crewId }) });
  const dom = new JSDOM(await response.text());
  try {
    return Array.from(dom.window.document.querySelectorAll("div"), (element) => element.textContent ?? "");
  } finally {
    dom.window.close();
  }
}

describe("open crawl share image text", () => {
  it("prevents caching a public card and the poster after the crew becomes private", async () => {
    vi.mocked(loadOpenCrawlShareCard)
      .mockResolvedValueOnce({
        ok: true,
        card: CARD,
        meetingPoint: { kind: "venue", name: CARD.meetingPubName, lat: 51.51, lng: -0.13 },
        stillTrue: null,
      })
      .mockResolvedValueOnce({ ok: false, reason: "missing" });

    const card = await Image({ params: Promise.resolve({ crewId: CARD.crewId }) });
    expect(card.headers.get("cache-control")).toBe("private, no-store");
    expect(await card.text()).toContain(CARD.title);

    const poster = await Image({ params: Promise.resolve({ crewId: CARD.crewId }) });
    expect(poster.headers.get("cache-control")).toBe("private, no-store");
    expect(await poster.text()).not.toContain(CARD.title);
  });

  it("renders the ordinary title, host, area, meeting pub and crawl facts", async () => {
    const lines = await imageLines(CARD);
    expect(lines).toContain("Thursday in Soho");
    expect(lines).toContain("Hosted by @scouthost · in Piccadilly & Soho");
    expect(lines).toContain("Meet at The Blue Posts");
    expect(lines).toContain("Thu 12 Nov, 19:00");
    expect(lines).toContain("5 places left");
    expect(lines).toContain("£4.50–£6.20 per pint, listed prices seen 3 Nov 2026");
  });

  it("dates the band in page, Open Graph and Twitter descriptions", async () => {
    vi.mocked(loadOpenCrawlShareCard).mockResolvedValue({
      ok: true,
      card: CARD,
      meetingPoint: { kind: "venue", name: CARD.meetingPubName, lat: 51.51, lng: -0.13 },
      stillTrue: null,
    });
    const metadata = await generateMetadata({
      params: Promise.resolve({ crewId: CARD.crewId }),
      searchParams: Promise.resolve({}),
    });
    for (const description of [metadata.description, metadata.openGraph?.description, metadata.twitter?.description]) {
      expect(description).toContain("£4.50–£6.20 per pint, listed prices seen 3 Nov 2026");
    }
  });

  it.each([
    {
      title: `\x01  Night\n out  ${"t".repeat(80)}\x7f`,
      hostHandle: `@@HOST${"h".repeat(40)}\x7f`,
      meetingPubName: `\x01  The\n pub  ${"p".repeat(80)}\x7f`,
      area: { name: `\x01  Long\n area  ${"a".repeat(80)}\x7f`, relation: "inside" as const },
    },
    {
      title: "\x01\x7f",
      hostHandle: "\x01\x7f",
      meetingPubName: "\x01\x7f",
      area: { name: "\x01\x7f", relation: "nearby" as const },
    },
    { title: "", hostHandle: "", meetingPubName: "", area: null },
  ])("renders filtered, bounded text through the shared clampOgText contract %#", async (fields) => {
    const card = { ...CARD, ...fields };
    const lines = await imageLines(card);
    const options = { collapseWhitespace: true, collapseBeforeFilter: true };
    const area = card.area ? `${card.area.relation === "inside" ? "in" : "near"} ${card.area.name}` : null;

    expect(lines).toContain(clampOgText(card.title, 60, "A night out", options));
    const host = clampOgText(displayHandle(card.hostHandle), 32, "@host", options);
    expect(lines).toContain(`Hosted by ${host}${area ? ` · ${clampOgText(area, 40, "", options)}` : ""}`);
    expect(lines).toContain(`Meet at ${clampOgText(card.meetingPubName, 44, "the first pub", options)}`);
  });
});
