// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { WhatsOnRow } from "@/lib/whatsOn";

const listings = vi.hoisted(() => ({
  status: "empty",
  rows: [] as WhatsOnRow[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightConditionsStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightGetHomeStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightShareButton", () => ({ default: () => null }));
vi.mock("@/components/desktop/AreaNewsRail", () => ({ default: () => null }));
vi.mock("@/components/out/EditorialRail", () => ({ default: () => null }));
vi.mock("@/components/discovery/DealsTonightLane", () => ({ default: () => null }));
vi.mock("@/components/discovery/MusicTonightLane", () => ({ default: () => null }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({
    ...listings,
    sourceFreshnessKind: "unknown",
    kindObservedAt: {},
    retry: vi.fn(),
  }),
}));
vi.mock("@/components/out/useOutListings", () => ({
  useOutListings: () => ({
    body: { status: "ready", listingsStatus: "ready", events: [], venueMatch: "ready" },
    failed: false,
    pending: false,
    retry: vi.fn(),
  }),
}));

import TonightClient from "@/app/tonight/TonightClient";

describe("Tonight soft plan handoff", () => {
  it.each(["empty", "ready"])("renders plan links on a %s night", (status) => {
    listings.status = status;
    listings.rows = status === "empty" ? [] : [{
      id: "quiz-test-arms",
      venueId: "venue-test-arms",
      kind: "quiz",
      title: "Pub quiz",
      placeName: "The Test Arms",
      startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      observedAt: new Date().toISOString(),
      source: { label: "The Test Arms", url: "https://example.com/quiz" },
      confidence: "listed",
    }];
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(TonightClient));
    const vibes = container.querySelector('[role="group"][aria-label="What’s the vibe tonight"]');
    expect(vibes).not.toBeNull();
    const links = [...vibes!.querySelectorAll("a")];

    for (const [label, occasion] of [
      ["Quiet pint", "quiet"],
      ["Coffee catch-up", "coffee"],
      ["Alcohol-free outing", "af"],
      ["Chill afternoon", "chill"],
    ]) {
      const matches = links.filter((link) => link.textContent === label);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.getAttribute("href")).toBe(
        `/plan?occasion=${occasion}&src=tonight-vibes`,
      );
    }
  });
});
