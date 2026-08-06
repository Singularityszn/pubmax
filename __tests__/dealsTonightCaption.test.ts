import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DealsTonightLane, {
  type DealsTonightLaneProps,
} from "@/components/discovery/DealsTonightLane";
import TonightDealsLane from "@/app/tonight/TonightDealsLane";
import { londonServiceDayBounds } from "@/lib/whatsOn";
import type { WhatsOnRow } from "@/lib/whatsOn";

const DEAL_QUALIFIER =
  "Two pints for £12 before 7pm on Thursdays. Booking excludes match nights, bank holidays, and the terrace.";

describe("DealsTonightLane caption", () => {
  it("renders a legitimate deal condition without changing its text", () => {
    const now = Date.now();
    const serviceWindow = londonServiceDayBounds(now);
    const startsAt = new Date(
      Date.parse(serviceWindow.start) + 2 * 60 * 60 * 1000,
    ).toISOString();
    const endsAt = new Date(
      Date.parse(serviceWindow.start) + 4 * 60 * 60 * 1000,
    ).toISOString();
    const observedAt = new Date(now - 60 * 60 * 1000).toISOString();

    const props: DealsTonightLaneProps = {
      asOf: observedAt,
      rows: [
        {
          id: "caption-integrity-deal",
          venueId: "venue-xjf3n0",
          placeName: "Arnos Arms, Arnos Grove",
          kind: "deal",
          startsAt,
          endsAt,
          title: "Early round offer",
          detail: DEAL_QUALIFIER,
          source: { label: "Venue listing", url: "https://example.com/deal" },
          observedAt,
          confidence: "listed",
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(
        DealsTonightLane as ComponentType<DealsTonightLaneProps>,
        props,
      ),
    );

    expect(html).toContain(`class="dealsTonightDetail">${DEAL_QUALIFIER}</span>`);
  });

  it("derives the Tonight header claim from the deal cards shown", () => {
    const observedAt = "2026-08-06T10:30:00.000Z";
    const props: { rows: WhatsOnRow[] } = {
      rows: [
        {
          id: "dated-card-undated-lane",
          venueId: "venue-xjf3n0",
          placeName: "Arnos Arms, Arnos Grove",
          kind: "deal",
          startsAt: "2026-08-06T17:00:00.000Z",
          endsAt: "2026-08-06T18:30:00.000Z",
          title: "Early round offer",
          detail: "Listed time: Thursday 6 August 2026; 18:00-19:30.",
          source: { label: "Venue listing", url: "https://example.com/deal" },
          observedAt,
          confidence: "listed",
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(
        TonightDealsLane,
        props,
      ),
    );

    expect(html).toContain('class="dealsTonightChecked">1 listed deal</span>');
    expect(html).not.toContain("No date on this yet");
  });

  it("counts only the deal cards that the Tonight lane renders", () => {
    const dealRows: WhatsOnRow[] = Array.from({ length: 9 }, (_, index) => ({
      id: `deal-${index}`,
      placeName: `Venue ${index}`,
      kind: "deal",
      startsAt: "2026-08-06T17:00:00.000Z",
      title: `Deal ${index}`,
      source: { label: "Venue listing", url: "https://example.com/deal" },
      observedAt: "2026-08-06T10:30:00.000Z",
      confidence: "listed",
    }));
    const musicRow: WhatsOnRow = {
      ...dealRows[0]!,
      id: "music-1",
      kind: "music",
      title: "Live music",
    };

    const html = renderToStaticMarkup(
      createElement(TonightDealsLane, { rows: [...dealRows, musicRow] }),
    );

    expect(html).toContain('class="dealsTonightChecked">8 listed deals</span>');
    expect(html.match(/class="dealsTonightCard"/g)).toHaveLength(8);
    expect(html).not.toContain("Live music");
  });
});
