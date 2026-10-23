import { describe, expect, it } from "vitest";

import { tonightMusicLaneObservedAt } from "@/lib/tonightOutListings";
import { MUSIC_LANE_MAX_CARDS, type WhatsOnRow } from "@/lib/whatsOn";

/**
 * The live-music lane's one "Checked" stamp covers every card it shows.
 *
 * On Tonight the lane mixes the What's-On read and the Out read. The music
 * feed's own date says nothing about a Ticketmaster card, and a card's bare
 * `observedAt` is not evidence either: a LIVE What's-On row carries the request
 * instant whenever CityMCP states no time (lib/whatsOnCitymcp.ts), so dating
 * the lane from it printed "Checked today" over a check that never happened.
 */

const REQUEST_INSTANT = "2026-10-18T19:00:00.000Z";
const MUSIC_FEED_DAY = "2026-10-07T18:48:54.205Z";
const TICKETMASTER_DAY = "2026-10-17T09:00:00.000Z";
const SKIDDLE_DAY = "2026-10-15T09:00:00.000Z";

function row(id: string, overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id,
    placeName: "The Test Arms",
    kind: "music",
    startsAt: "2026-10-18T20:00:00.000Z",
    title: "Live set",
    source: { label: "The Test Arms website", url: "https://example.com/listing" },
    observedAt: REQUEST_INSTANT,
    confidence: "listed",
    ...overrides,
  } as WhatsOnRow;
}

describe("the live-music lane's checked date", () => {
  it("dates What's-On cards by the music feed, never by a live row's request instant", () => {
    const live = row("whats-live-abc");
    expect(
      tonightMusicLaneObservedAt({
        rows: [live],
        outEvents: [],
        kindObservedAt: { music: MUSIC_FEED_DAY },
      }),
    ).toBe(MUSIC_FEED_DAY);
  });

  it("is undated when the music feed holds no evidence for its cards", () => {
    // The store leaves a live row out of the map when the provider states no
    // time, so the kind is absent and the lane may not invent a day.
    expect(
      tonightMusicLaneObservedAt({
        rows: [row("whats-live-abc")],
        outEvents: [],
        kindObservedAt: { deal: "2026-10-18T08:00:00.000Z" },
      }),
    ).toBeNull();
  });

  it("covers an Out card with its publisher's own check", () => {
    const ticketmaster = row("out-tm-1", {
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/e/1" },
    });
    expect(
      tonightMusicLaneObservedAt({
        rows: [ticketmaster],
        outEvents: [ticketmaster],
        kindObservedAt: { music: MUSIC_FEED_DAY },
        outObservedAt: { ticketmaster: TICKETMASTER_DAY },
      }),
    ).toBe(TICKETMASTER_DAY);
  });

  it("takes the OLDEST check when the lane mixes both reads", () => {
    const whatsOn = row("own-site-1");
    const ticketmaster = row("out-tm-1", {
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/e/1" },
    });
    const skiddle = row("out-sk-1", {
      source: { label: "Skiddle", url: "https://www.skiddle.com/e/1" },
    });
    const observed = tonightMusicLaneObservedAt({
      rows: [whatsOn, ticketmaster, skiddle],
      outEvents: [ticketmaster, skiddle],
      kindObservedAt: { music: "2026-10-18T10:00:00.000Z" },
      outObservedAt: { ticketmaster: TICKETMASTER_DAY, skiddle: SKIDDLE_DAY },
    });
    expect(observed).toBe(SKIDDLE_DAY);
  });

  it.each<{ label: string; observedAt: string; checks: Record<string, string>; expected: string | null }>([
    { label: "", observedAt: "", checks: { ticketmaster: TICKETMASTER_DAY }, expected: null },
    { label: "Skiddle", observedAt: "", checks: { ticketmaster: TICKETMASTER_DAY }, expected: null },
    { label: "Ticketmaster", observedAt: "", checks: {}, expected: null },
    { label: "Skiddle", observedAt: SKIDDLE_DAY, checks: { ticketmaster: TICKETMASTER_DAY }, expected: SKIDDLE_DAY },
  ])("requires check evidence for every participating Out music row: $label / $observedAt", ({ label, observedAt, checks, expected }) => {
    const events = [
      row("out-tm-known", { source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/e/1" }, observedAt: TICKETMASTER_DAY }),
      row("out-other", { source: { label, url: "https://example.com/e/2" }, observedAt }),
    ];
    expect(tonightMusicLaneObservedAt({
      rows: events,
      outEvents: events,
      kindObservedAt: {},
      outObservedAt: checks,
    })).toBe(expected);
  });

  it("goes undated when one read on screen cannot be dated", () => {
    const whatsOn = row("own-site-1");
    const unlabelled = row("out-1", { source: { label: " ", url: "https://example.com/e" } });
    expect(
      tonightMusicLaneObservedAt({
        rows: [whatsOn, unlabelled],
        outEvents: [unlabelled],
        kindObservedAt: { music: MUSIC_FEED_DAY },
        outObservedAt: {},
      }),
    ).toBeNull();
  });

  it.each(["", "not-a-date"])("does not lend a publisher check to an invalid row date: %s", (observedAt) => {
    const events = [
      row("known", { source: { label: "Ticketmaster", url: "https://example.com/known" }, observedAt: TICKETMASTER_DAY }),
      row("unknown", { source: { label: "Ticketmaster", url: "https://example.com/unknown" }, observedAt }),
    ];
    expect(tonightMusicLaneObservedAt({
      rows: events,
      outEvents: events,
      kindObservedAt: {},
      outObservedAt: { ticketmaster: TICKETMASTER_DAY },
    })).toBeNull();
  });

  it("dates only the cards the lane shows", () => {
    const shown = Array.from({ length: MUSIC_LANE_MAX_CARDS }, (_, index) => row(`own-site-${index}`));
    const hiddenOut = row("out-tm-hidden", {
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/e/9" },
    });
    const deal = row("deal-1", { kind: "deal" });
    expect(
      tonightMusicLaneObservedAt({
        rows: [deal, ...shown, hiddenOut],
        outEvents: [hiddenOut],
        kindObservedAt: { music: MUSIC_FEED_DAY },
        outObservedAt: {},
      }),
    ).toBe(MUSIC_FEED_DAY);
  });

  it("has no date for a lane with no music cards", () => {
    expect(
      tonightMusicLaneObservedAt({
        rows: [row("deal-1", { kind: "deal" })],
        outEvents: [],
        kindObservedAt: { music: MUSIC_FEED_DAY },
      }),
    ).toBeNull();
  });
});
