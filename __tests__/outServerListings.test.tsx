import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import OutClient from "@/app/out/OutClient";
import { metadata } from "@/app/out/page";
import type { OutResponse } from "@/lib/out/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

const body: OutResponse = {
  status: "ready",
  listingsStatus: "ready",
  events: [{
    id: "fixture-event",
    venueId: "venue-fixture",
    kind: "event",
    placeName: "The Fixture Arms",
    startsAt: "2026-10-16T19:00:00Z",
    title: "Friday acoustic set",
    source: { label: "The Fixture Arms", url: "https://example.com/music" },
    observedAt: "2026-10-15T12:00:00Z",
    confidence: "listed",
  }],
  openPlans: [],
  attribution: [{ label: "The Fixture Arms", logoRequired: false, url: "https://example.com/music" }],
  observedAt: { "The Fixture Arms": "2026-10-15T12:00:00Z" },
  providers: [],
  venueMatch: "ready",
};

function documentFor(answer: OutResponse | null) {
  return renderToStaticMarkup(createElement(OutClient, {
    day: "tonight",
    initialAnswer: { city: "london", day: "today", body: answer, failed: answer === null },
  }));
}

describe("Out's server document", () => {
  it("contains sourced listings before JavaScript runs, while staying noindex", () => {
    const html = documentFor(body);
    expect(html).toContain("Friday acoustic set");
    expect(html).toContain("The Fixture Arms");
    expect(html).toContain("https://example.com/music");
    expect(html).not.toContain("Loading listings");
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBeUndefined();
  });

  it("reports a failed read without an indefinite loading placeholder", () => {
    const html = documentFor(null);
    expect(html).toContain("Could not check listings.");
    expect(html).not.toContain("Loading listings");
    expect(html).not.toContain("No listings for this day yet.");
  });
});
