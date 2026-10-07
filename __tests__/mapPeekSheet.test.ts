import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MapPeekSheet, {
  PEEK_COMMIT_DISTANCE_PX,
  PEEK_COMMIT_VELOCITY,
  peekPresentedOffset,
  peekShouldOpenList,
} from "@/components/mobile/MapPeekSheet";
import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import type { MapPeekModel } from "@/lib/mapPeek";

function render(model: MapPeekModel) {
  return renderToStaticMarkup(
    createElement(
      MapPeekSheet,
      { model, onOpenVenue: vi.fn(), onOpenList: vi.fn() },
      createElement("button", { className: "mobilePlanActivation" }, "Describe the outing"),
    ),
  );
}

const ANSWER: MapPeekModel = {
  status: "answer",
  answer: {
    venueId: "venue-1",
    name: "The Three Tuns",
    priceGbp: 2.95,
    priceLabel: "£2.95",
    anchor: null,
    isPub: true,
    walkMinutes: 6,
  },
};

describe("the bottom card's three honest states", () => {
  it("names the cheapest pub with its price and a walk when the reader has a fix", () => {
    const html = render(ANSWER);
    expect(html).toContain("Cheapest in this view");
    expect(html).toContain("£2.95");
    expect(html).toContain("The Three Tuns");
    expect(html).toContain("6 min walk");
    expect(html).toContain('aria-label="Cheapest in this view: £2.95 at The Three Tuns, 6 minute walk. Open this pub"');
  });

  it("leaves the walk off without a fix instead of inventing one", () => {
    const html = render({
      status: "answer",
      answer: { ...(ANSWER.status === "answer" ? ANSWER.answer : (null as never)), walkMinutes: null },
    });
    expect(html).not.toContain("min walk");
  });

  it("says nothing is listed rather than showing a made-up figure", () => {
    const html = render({ status: "none" });
    expect(html).toContain("No listed price here yet");
    expect(html).not.toContain("£");
    expect(html).toContain('role="status"');
  });

  it("makes no claim while the map has not said what is in view", () => {
    const html = render({ status: "loading" });
    expect(html).toContain("Counting them up…");
    expect(html).not.toContain("£");
  });

  it("keeps the plan door inside the card as its own button", () => {
    for (const model of [ANSWER, { status: "none" } as MapPeekModel, { status: "loading" } as MapPeekModel]) {
      const html = render(model);
      expect(html).toContain("mobilePlanActivation");
      expect(html).toContain("Describe the outing");
      // Door and answer share ONE surface.
      expect(html.match(/class="mapPeek"/g)).toHaveLength(1);
    }
  });

  it("stays mounted but covered when something else owns the foot of the map", () => {
    const html = renderToStaticMarkup(
      createElement(MapPeekSheet, {
        model: ANSWER,
        onOpenVenue: vi.fn(),
        onOpenList: vi.fn(),
        covered: true,
      }),
    );
    expect(html).toContain('data-covered="true"');
    expect(html).not.toContain("mobilePlanActivation");
    expect(render(ANSWER)).not.toContain("data-covered");
  });

  it("wears a non-pub anchor exactly as List view's row does", () => {
    const anchor = { label: "Set lunch", observedLabel: "Sep", sourceLabel: "example.com", sourceUrl: "https://example.com/menu" };
    const html = render({
      status: "answer",
      answer: { venueId: "bistro", name: "Bistro", priceGbp: 4, priceLabel: "£4.00", anchor, isPub: false, walkMinutes: null },
    });
    const row = renderToStaticMarkup(
      createElement(CompactVenuePrice, { priceLabel: "£4.00", anchor, className: "mapPeekPrice", provenanceClassName: "mapPeekProvenance" }),
    );
    expect(html).toContain(row);
    expect(html.replace(/<[^>]+>/g, "")).toContain("Set lunch · £4.00");
    expect(html).toContain(
      'aria-label="Cheapest in this view: Set lunch · £4.00 (Sep · example.com) at Bistro. Open this venue"',
    );
  });

  it("offers the list as a real, named button as well as the pull", () => {
    const html = render(ANSWER);
    expect(html).toContain('aria-label="Show the pubs in this view as a list"');
    expect(html).toContain(">List<");
  });
});

describe("the pull up opens the list", () => {
  it("opens on distance alone", () => {
    expect(peekShouldOpenList(PEEK_COMMIT_DISTANCE_PX, 0)).toBe(true);
    expect(peekShouldOpenList(PEEK_COMMIT_DISTANCE_PX - 1, 0)).toBe(false);
  });

  it("opens on a flick, but a flick has to have gone somewhere", () => {
    expect(peekShouldOpenList(20, PEEK_COMMIT_VELOCITY)).toBe(true);
    expect(peekShouldOpenList(20, PEEK_COMMIT_VELOCITY - 0.01)).toBe(false);
    expect(peekShouldOpenList(4, 2)).toBe(false);
  });

  it("never opens on a downward or still release", () => {
    expect(peekShouldOpenList(-40, 0)).toBe(false);
    expect(peekShouldOpenList(0, 0)).toBe(false);
  });

  it("tracks the finger 1:1 at first and then resists, in both directions", () => {
    expect(peekPresentedOffset(0)).toBe(0);
    expect(peekPresentedOffset(-10)).toBe(-10);
    expect(peekPresentedOffset(-PEEK_COMMIT_DISTANCE_PX)).toBe(-PEEK_COMMIT_DISTANCE_PX);
    // Past the free stretch the card follows less than the finger, and never reverses.
    expect(peekPresentedOffset(-200)).toBeGreaterThan(-200);
    expect(peekPresentedOffset(-400)).toBeLessThan(peekPresentedOffset(-200));
    // Downward there is nowhere to go: it resists from the first pixel.
    expect(peekPresentedOffset(30)).toBeGreaterThan(0);
    expect(peekPresentedOffset(30)).toBeLessThan(30);
  });
});
