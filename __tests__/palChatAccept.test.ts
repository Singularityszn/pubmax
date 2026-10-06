import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AnswerCard } from "@/components/pal/PalChat";
import type { PalCard } from "@/lib/palChat";
import { resolvePalLocality } from "@/lib/palLocality";

function card(overrides: Partial<PalCard> = {}): PalCard {
  return {
    key: "v-1",
    venueId: "venue-a",
    title: "The Anchor",
    place: "Brixton",
    note: "In Brixton, within budget",
    price: 4.5,
    provenance: { label: "On record", kind: "directory" },
    ...overrides,
  };
}

const noop: (venueId: string) => void = () => {};

describe("Pub Pal card acceptance handoff", () => {
  it("offers an explicit source-pal acceptance to Map on every venue card", () => {
    const locality = resolvePalLocality("cheap in Brixton", null);
    const html = renderToStaticMarkup(createElement(AnswerCard, { card: card(), onOpen: noop, locality }));
    expect(html).toContain("Use this venue");
    expect(html).toContain("/map?sel=venue-a&amp;accept=1&amp;src=pal");
    // The browse deep-link stays available and browse-only alongside it.
    expect(html).toContain("/map?sel=venue-a");
  });

  it("still offers the acceptance with no resolved locality", () => {
    const html = renderToStaticMarkup(createElement(AnswerCard, { card: card(), onOpen: noop, locality: null }));
    expect(html).toContain("Use this venue");
    expect(html).toContain("/map?sel=venue-a&amp;accept=1&amp;src=pal");
  });

  it("shows no acceptance for a card that does not deep-link to a Venue", () => {
    const html = renderToStaticMarkup(createElement(AnswerCard, { card: card({ venueId: "" }), onOpen: noop, locality: null }));
    expect(html).not.toContain("Use this venue");
    expect(html).not.toContain("accept=1");
  });

  it("keeps the provenance link outside the venue link", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerCard, {
        card: card({
          provenance: {
            label: "Skiddle",
            kind: "whats-on",
            url: "https://example.test/event",
          },
        }),
        onOpen: noop,
        locality: null,
      }),
    );
    expect(html).toContain('href="/map?sel=venue-a"');
    expect(html).toContain('href="https://example.test/event"');
    const venueOpen = html.search(/<a[^>]*href="\/map\?sel=venue-a"/);
    expect(venueOpen).toBeGreaterThanOrEqual(0);
    const venueTagEnd = html.indexOf(">", venueOpen);
    const firstClose = html.indexOf("</a>", venueTagEnd);
    expect(html.slice(venueTagEnd, firstClose)).not.toContain("https://example.test/event");
  });
});
