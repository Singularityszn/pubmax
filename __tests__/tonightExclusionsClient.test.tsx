// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TonightClient from "@/app/tonight/TonightClient";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import { useOutListings } from "@/components/out/useOutListings";
import type { OutResponse } from "@/lib/out/types";
import type { TonightOutAnswer } from "@/lib/tonightOutListings";
import { matchVenueId, type WhatsOnKindObservedAt, type WhatsOnRow } from "@/lib/whatsOn";
import { mapThingsToDoToRows } from "@/lib/whatsOnCitymcp";
import type { LoadWhatsOnResult } from "@/lib/whatsOnStore";

vi.mock("@/components/map/useWhatsOnTonight", () => ({ useWhatsOnTonight: vi.fn() }));
vi.mock("@/components/out/useOutListings", () => ({ useOutListings: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));

const NOW = Date.parse("2026-10-25T12:00:00Z");
const FRESH = "2026-10-25T11:00:00Z";
const cask: WhatsOnRow = {
  id: "cask-bluegrass", venueId: "venue-pzbwmw", placeName: "Cask", kind: "music",
  title: "Bluegrass", startsAt: "2026-10-25T16:30:00Z", confidence: "listed",
  observedAt: "2026-10-07T12:00:00Z",
  source: { label: "Cask", url: "https://example.com/bluegrass" },
};
const readyBody: OutResponse = {
  status: "ready", listingsStatus: "ready", venueMatch: "ready", events: [],
  observedAt: { ticketmaster: FRESH }, providers: [], attribution: [], openPlans: [],
};

function documentFor(
  path: "initial" | "browser",
  rows: WhatsOnRow[],
  out: TonightOutAnswer,
  kindObservedAt: WhatsOnKindObservedAt = {},
) {
  const whatsOn: LoadWhatsOnResult = {
    rows, readStatus: "ready", servedAt: new Date(NOW).toISOString(),
    revalidation: { status: "measured" }, sourceObservedAt: null,
    sourceFreshnessKind: "provider-observed", kindObservedAt,
    localityBasis: "london-default", asOf: null,
  };
  vi.mocked(useWhatsOnTonight).mockReturnValue({
    rows, status: rows.length ? "ready" : "empty", summary: new Map(),
    sourceFreshnessKind: whatsOn.sourceFreshnessKind, kindObservedAt,
    sourceObservedAt: null, asOf: null, retry: vi.fn(),
  });
  vi.mocked(useOutListings).mockReturnValue({
    ...out, body: out.body as OutResponse | null, retry: vi.fn(),
  });
  const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
  try {
    const html = renderToStaticMarkup(createElement(TonightClient, {
      initialListings: path === "initial" ? { whatsOn, out, renderedAt: NOW } : undefined,
      mapSelectableVenueIds: ["venue-pzbwmw", "venue-the-dove"],
    }));
    return new DOMParser().parseFromString(html, "text/html");
  } finally {
    clock.mockRestore();
  }
}

describe.each(["initial", "browser"] as const)("Tonight exclusions in the %s read", (path) => {
  it.each([
    { state: "timeout", body: null, failed: true, pending: false },
    { state: "degraded", body: { ...readyBody, status: "degraded", listingsStatus: "degraded" }, failed: false, pending: false },
    { state: "unavailable matching", body: { ...readyBody, venueMatch: "unavailable" }, failed: false, pending: false },
    { state: "pending", body: null, failed: false, pending: true },
  ] satisfies (TonightOutAnswer & { state: string })[])(
    "explains known exclusions during an Out $state without successful-feed credits",
    (out) => {
      for (const observedAt of [cask.observedAt, ""]) {
        const doc = documentFor(path, [{ ...cask, observedAt }], out);
        expect(doc.querySelector('[data-tonight-provenance="excluded-whats-on"]')?.textContent)
          .toBe(observedAt
            ? "1 pub listing hidden: its source check is older than 24 hours."
            : "1 pub listing hidden: its source check date is not recorded.");
        expect(doc.querySelector('[data-tonight-provenance="whats-on"]')).toBeNull();
        expect(doc.querySelector('[data-tonight-provenance="out"]')).toBeNull();
        expect(doc.querySelector(".tonightPrimary")?.getAttribute("data-status"))
          .toBe(out.pending ? "idle" : "error");
        expect(doc.body.textContent).not.toContain("Bluegrass");
        expect(doc.body.textContent).not.toContain("The pub listings source check date is not recorded.");
      }
    },
  );

  it("keeps a displayed unknown source date beside stale Cask and a dated Out read", () => {
    const deals = mapThingsToDoToRows({
      window: "tonight", opportunities: [{
        title: "Sunday food offer", kind: "food_drink", startsAt: cask.startsAt,
        place: { name: "The Dove" },
        source: { label: "The Dove", url: "https://example.com/sunday-food" },
      }],
    }, { now: NOW }).map((row) => matchVenueId(row, () => "venue-the-dove"));
    const doc = documentFor(path, [cask, ...deals], { body: readyBody, failed: false, pending: false });
    expect(doc.body.textContent).toContain("Sunday food offer");
    expect(doc.querySelector('[data-tonight-provenance="undated-whats-on"]')?.textContent)
      .toContain("The pub listings source check date is not recorded.");
    expect(doc.querySelector('[data-tonight-provenance="excluded-whats-on"]')?.textContent)
      .toBe("1 pub listing hidden: its source check is older than 24 hours.");
    expect(doc.querySelector('[data-tonight-provenance="out"]')?.textContent)
      .toBe("No pub-matched events via Ticketmaster · Checked 25 Oct");
  });

  it("keeps accepted duplicate versions visible without a hidden-listing claim", () => {
    const fresh = { ...cask, observedAt: FRESH };
    for (const rows of [[cask, fresh], [fresh, cask]]) {
      const doc = documentFor(path, rows, { body: null, failed: true, pending: false }, { music: FRESH });
      expect(doc.body.textContent).toContain("Bluegrass");
      expect(doc.querySelector('[data-tonight-provenance="excluded-whats-on"]')).toBeNull();
      expect(doc.querySelector('[data-tonight-provenance="whats-on"]')?.textContent)
        .toBe("1 listing · Checked 25 Oct · via what’s-on");
    }
  });
});
