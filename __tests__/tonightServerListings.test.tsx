// @vitest-environment jsdom

import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TonightClient from "@/app/tonight/TonightClient";
import type { LoadWhatsOnResult } from "@/lib/whatsOnStore";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));

const NOW = Date.parse("2026-10-16T17:00:00Z");
const OBSERVED = "2026-10-16T09:00:00Z";
const independent = {
  id: "independent-quiz",
  venueId: "venue-quiz",
  placeName: "The Fixture Arms",
  kind: "quiz" as const,
  startsAt: "2026-10-16T18:00:00Z",
  endsAt: "2026-10-16T21:00:00Z",
  title: "Friday pub quiz",
  source: { label: "The Fixture Arms", url: "https://example.com/quiz" },
  observedAt: OBSERVED,
  confidence: "listed" as const,
};
const whatsOn: LoadWhatsOnResult = {
  rows: [independent],
  readStatus: "ready",
  servedAt: new Date(NOW).toISOString(),
  revalidation: { status: "measured" },
  sourceObservedAt: OBSERVED,
  sourceFreshnessKind: "provider-observed",
  kindObservedAt: { quiz: OBSERVED },
  localityBasis: "london-default",
  asOf: OBSERVED,
};
const out = {
  body: { status: "not-configured" as const, events: [], observedAt: {}, reason: "No listings available." },
  failed: false,
  pending: false,
};

function documentFor(answer: LoadWhatsOnResult | null) {
  return renderToStaticMarkup(createElement(TonightClient, {
    initialListings: { whatsOn: answer, out, renderedAt: NOW },
    mapSelectableVenueIds: ["venue-quiz"],
  }));
}

describe("Tonight's completed server document", () => {
  it("contains approved listings and their real source before browser reads run", () => {
    const html = documentFor(whatsOn);
    expect(html).toContain("Friday pub quiz");
    expect(html).toContain("The Fixture Arms");
    expect(html).toContain("via The Fixture Arms");
    expect(html).toContain("7:00 pm");
    expect(html).toContain("data-listings-status=\"ready\"");
    expect(html).not.toContain("Loading listings");
  });

  it("describes an unavailable read instead of claiming an empty city", () => {
    const html = documentFor(null);
    expect(html).toContain("data-picks-state=\"temporarily_unavailable\"");
    expect(html).not.toContain("Loading listings");
    expect(html).not.toContain("The city's having a quiet one");
  });

  it("keeps chain deals and ticket platforms out of the primary listing region", () => {
    const html = documentFor({
      ...whatsOn,
      rows: [
        independent,
        { ...independent, id: "chain", title: "Chain offer", kind: "deal", source: { label: "J D Wetherspoon", url: "https://www.jdwetherspoon.com/" } },
        { ...independent, id: "ticket", title: "Ticket platform show", kind: "event", source: { label: "Ticketmaster", url: "https://ticketmaster.co.uk/" } },
      ],
    });
    const lede = html.split('data-testid="tonight-lede"')[1]?.split('class="tonightWeather"')[0] ?? "";
    expect(lede).toContain("Friday pub quiz");
    expect(lede).not.toContain("Chain offer");
    expect(lede).not.toContain("Ticket platform show");
  });
  it("keeps a held deal's age on the server clock during hydration", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW + 2 * 60 * 60_000);
    try {
      const html = documentFor({ ...whatsOn, rows: [{
        ...independent, kind: "deal", title: "Friday deal",
        observedAt: new Date(NOW - (21 * 24 - 1) * 60 * 60_000).toISOString(),
      }] });
      expect(html).toContain("Listed 2 weeks ago");
      expect(html).not.toContain("Listed 3 weeks ago");
    } finally {
      clock.mockRestore();
    }
  });

  it("hydrates a held deal across an age boundary without changing its date copy", async () => {
    const initialListings = { whatsOn: { ...whatsOn, rows: [{
      ...independent, kind: "deal" as const, title: "Friday deal",
      observedAt: new Date(NOW - (21 * 24 - 1) * 60 * 60_000).toISOString(),
    }] }, out, renderedAt: NOW };
    const element = createElement(TonightClient, { initialListings });
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.append(container);
    const errors: string[] = [];
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW + 2 * 60 * 60_000);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(String(error)) });
      });
      expect(container.textContent).toContain("Listed 2 weeks ago");
      expect(container.textContent).not.toContain("Listed 3 weeks ago");
      expect(errors).toEqual([]);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      clock.mockRestore();
      vi.unstubAllGlobals();
    }
  });

});
