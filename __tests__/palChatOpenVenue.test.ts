import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AnswerCard } from "@/components/pal/PalChat";
import type { PalCard } from "@/lib/palChat";
import { venueMapUrl } from "@/lib/venueMapUrl";

const palChatSource = readFileSync(
  join(process.cwd(), "components/pal/PalChat.tsx"),
  "utf8",
);

function card(overrides: Partial<PalCard> = {}): PalCard {
  return {
    key: "v-1",
    venueId: "venue-listed",
    title: "The Anchor",
    place: "Brixton",
    note: "In Brixton, within budget",
    price: 4.5,
    provenance: { label: "On record", kind: "directory" },
    ...overrides,
  };
}

describe("Pal venue card navigation", () => {
  it("links through venueMapUrl for a listed venue", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerCard, {
        card: card(),
        onOpen: vi.fn(),
        palHandoff: false,
        locality: null,
      }),
    );

    expect(html).toContain(venueMapUrl("venue-listed"));
    expect(html).toContain("Show on map");
  });

  it("routes card presses through openVenue and router.push", () => {
    expect(palChatSource).toContain('from "@/lib/palOpenVenue"');
    expect(palChatSource).toContain("resolvePalVenueOpenTarget");
    expect(palChatSource).toContain("router.push(target.href)");
    expect(palChatSource).toContain("event.preventDefault()");
    expect(palChatSource).toContain('trackEvent("concierge_result_tap")');
  });

  it("does not render a map link when the card has no venue id", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerCard, {
        card: card({ venueId: "" }),
        onOpen: vi.fn(),
        palHandoff: false,
        locality: null,
      }),
    );

    expect(html).toContain("palChatCardBody--static");
    expect(html).not.toContain("Show on map");
  });
});
