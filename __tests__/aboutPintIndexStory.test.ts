import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PintIndexSnapshot } from "@/lib/pintIndex";

const fixtures = vi.hoisted(() => ({
  snapshot: null as unknown,
  stats: {
    pubsTracked: 2_796,
    pintPricesObserved: 2_796,
    cheapestPint: 4,
    dearestPint: 8,
    averagePint: 6,
    boroughsCovered: 33,
    historicPubsCited: 10,
    citiesCovered: 3,
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/aboutStats", () => ({
  loadAboutStats: async () => fixtures.stats,
}));

vi.mock("@/lib/publicPintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshot: async () => fixtures.snapshot,
}));

import AboutPage from "@/app/about/page";

function snapshot(
  observations: PintIndexSnapshot["observations"],
): PintIndexSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "test-snapshot",
    status: observations.length ? "published" : "empty",
    generatedAt: "2026-07-31T00:00:00.000Z",
    observationWindow: observations.length
      ? {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-07-31T00:00:00.000Z",
        }
      : null,
    classification: {
      version: "test",
      method: "point_in_polygon",
      sourceArtifact: "test",
      licence: "test",
    },
    sources: observations.length
      ? [
          {
            id: "source",
            kind: "official_publisher",
            publisher: "Test Brewery",
            sourceUrl: "https://example.com/prices",
            licence: null,
            publisherType: "brewery",
            officialDomain: "example.com",
          },
        ]
      : [],
    observations,
    excluded: [],
  };
}

async function renderStoryHooks(): Promise<string> {
  const page = await AboutPage();
  const html = renderToStaticMarkup(createElement(() => page));
  const start = html.indexOf('aria-labelledby="press-hooks"');
  const end = html.indexOf('aria-labelledby="cta"', start);
  return html.slice(start, end);
}

describe("About Pint Index story", () => {
  beforeEach(() => {
    fixtures.snapshot = snapshot([]);
  });

  it("shows the public snapshot empty state instead of raw map-price counts", async () => {
    const story = await renderStoryHooks();

    expect(story).toContain("No borough league yet.");
    expect(story).toContain("See the Index status");
    expect(story).not.toContain("2,796");
    expect(story).not.toContain("currently ranks");
  });

  it("derives every populated league count from the public snapshot", async () => {
    fixtures.snapshot = snapshot([
      {
        venueId: "camden-pub",
        pubName: "Camden Pub",
        boroughCode: "camden",
        boroughName: "Camden",
        pricePence: 500,
        observedAt: "2026-07-10T00:00:00.000Z",
        sourceId: "source",
      },
      {
        venueId: "westminster-pub",
        pubName: "Westminster Pub",
        boroughCode: "westminster",
        boroughName: "Westminster",
        pricePence: 700,
        observedAt: "2026-07-11T00:00:00.000Z",
        sourceId: "source",
      },
    ]);

    const story = await renderStoryHooks();

    expect(story).toContain("currently ranks");
    expect(story).toContain("<strong>2</strong> boroughs");
    expect(story).toContain("<strong>2</strong> dated prices");
    expect(story).toContain("<strong>2</strong> pubs");
    expect(story).not.toContain("2,796");
  });
});
