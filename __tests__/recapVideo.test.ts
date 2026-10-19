import { describe, expect, it } from "vitest";

import type { NightMoment } from "@/lib/nightMemory";
import { buildRecapVideoInput, RECAP_VIDEO_FPS, routeSketchPoints } from "@/lib/recapVideo";
import type { RecapView } from "@/lib/recapView";

/**
 * THE RECAP VIDEO SHOWS ONLY WHAT THE RECAP SHOWS.
 *
 * `lib/recapVideo.ts` writes the video's script from the published recap. A
 * Stop's Venue name and price come from the recap view and are never made up,
 * a missing price or time stays missing, Friends come only from published
 * `person` moments, and nothing in the script counts drinks.
 */

function moment(overrides: Partial<NightMoment>): NightMoment {
  return {
    id: overrides.id ?? "m1",
    memoryId: "mem1",
    ownerId: "owner-1",
    kind: overrides.kind ?? "venue",
    caption: overrides.caption ?? "",
    pintDropId: null,
    venueId: overrides.venueId ?? null,
    mediaObjectKey: null,
    occurredAt: overrides.occurredAt ?? null,
    visibility: "private",
    altText: null,
    altTextConfirmedAt: null,
    createdAt: overrides.createdAt ?? "2026-07-17T19:00:00.000Z",
  };
}

function view(overrides: Partial<RecapView> = {}): RecapView {
  return {
    title: "Soho, slowly",
    completedAt: null,
    route: [
      { position: 0, venueId: "v-lamb", venueName: "The Lamb", caption: null },
      { position: 1, venueId: "v-crown", venueName: "The Crown", caption: null },
    ],
    pints: [
      { venueId: "v-lamb", venueName: "The Lamb", drink: "Bitter", priceGbp: 5.4, priceLabel: "£5.40", note: null },
      { venueId: "v-crown", venueName: "The Crown", drink: "Stout", priceGbp: null, priceLabel: null, note: "No price" },
    ],
    photos: [],
    ending: null,
    guardian: null,
    closingLine: "",
    stats: { stopCount: 2, pintCount: 2, totalGbp: 5.4, cheapestPintGbp: 5.4 },
    ...overrides,
  };
}

const published = [
  moment({ id: "a", kind: "venue", venueId: "v-lamb", occurredAt: "2026-07-17T19:40:00.000Z" }),
  moment({ id: "b", kind: "venue", venueId: "v-crown" }),
  moment({ id: "c", kind: "person", caption: "  Priya " }),
  moment({ id: "d", kind: "person", caption: "Priya" }),
  moment({ id: "e", kind: "person", caption: "Tom" }),
];

describe("the recap video script", () => {
  it("is null for a night with no Stop", () => {
    expect(buildRecapVideoInput({ view: view({ route: [] }), published })).toBeNull();
  });

  it("takes each Stop's name and logged price from the recap, and invents none", () => {
    const input = buildRecapVideoInput({ view: view(), published });
    expect(input?.title).toBe("Soho, slowly");
    expect(input?.stops.map((stop) => [stop.venueName, stop.priceLabels])).toEqual([
      ["The Lamb", ["£5.40"]],
      ["The Crown", []],
    ]);
  });

  it("shows no price at a pub the Route visits twice, because a pint names no visit", () => {
    const route = [
      { position: 0, venueId: "v-lamb", venueName: "The Lamb", caption: null },
      { position: 1, venueId: "v-crown", venueName: "The Crown", caption: null },
      { position: 2, venueId: "v-lamb", venueName: "The Lamb", caption: null },
    ];
    const pints = [
      { venueId: "v-lamb", venueName: "The Lamb", drink: "Bitter", priceGbp: 5.4, priceLabel: "£5.40", note: null },
      { venueId: "v-crown", venueName: "The Crown", drink: "Stout", priceGbp: 6.1, priceLabel: "£6.10", note: null },
    ];
    const input = buildRecapVideoInput({ view: view({ route, pints }), published });
    expect(input?.stops.map((stop) => stop.priceLabels)).toEqual([[], ["£6.10"], []]);
  });

  it("gives a Stop's time in London time, and no time when the moment has none", () => {
    const input = buildRecapVideoInput({ view: view(), published });
    // 19:40 UTC on 17 July is 20:40 in London (BST).
    expect(input?.stops.map((stop) => stop.timeLabel)).toEqual(["20:40", null]);
  });

  it("names Friends only from published person moments, once each", () => {
    expect(buildRecapVideoInput({ view: view(), published })?.friends).toEqual(["Priya", "Tom"]);
    const noPeople = buildRecapVideoInput({ view: view(), published: published.slice(0, 2) });
    expect(noPeople?.friends).toEqual([]);
    expect(noPeople?.timing.friendsFrames).toBe(0);
  });

  it("carries no drink count anywhere in the script", () => {
    const input = buildRecapVideoInput({ view: view(), published });
    const keys = JSON.stringify(input);
    expect(keys).not.toMatch(/pintCount|totalGbp|drink/);
  });

  it("runs a typical night between 15 and 20 seconds, and gives every Stop time to be read", () => {
    const stops = Array.from({ length: 4 }, (_, index) => ({
      position: index,
      venueId: `v${index}`,
      venueName: `Pub ${index}`,
      caption: null,
    }));
    const input = buildRecapVideoInput({ view: view({ route: stops, pints: [] }), published: published.slice(2) });
    const seconds = (input?.timing.durationInFrames ?? 0) / RECAP_VIDEO_FPS;
    expect(seconds).toBeGreaterThanOrEqual(15);
    expect(seconds).toBeLessThanOrEqual(20);
    expect((input?.timing.stopFrames ?? 0) / RECAP_VIDEO_FPS).toBeGreaterThanOrEqual(1.2);
  });
});

describe("the route sketch", () => {
  it("draws no shape without two known points", () => {
    expect(routeSketchPoints([{ lat: 51.5, lng: -0.12 }, null])).toEqual([null, null]);
  });

  it("puts north at the top and keeps every point inside the frame", () => {
    const [south, north] = routeSketchPoints([
      { lat: 51.5, lng: -0.12 },
      { lat: 51.51, lng: -0.12 },
    ]);
    expect(north!.y).toBeLessThan(south!.y);
    for (const point of [south!, north!]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });
});
