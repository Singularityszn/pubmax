import { describe, expect, it } from "vitest";

import {
  CONTENT_SHARE_CHANNELS,
  CONTENT_SHARE_SURFACES,
  ERROR_SHOWN_KINDS,
  ERROR_SHOWN_SURFACES,
  ROUTE_OPENED_SURFACES,
  STOP_ADDED_SURFACES,
  VENUE_SHEET_LAYERS,
  VOICE_END_REASONS,
  sanitizeEvent,
} from "@/lib/analyticsEvents";

describe("journey events keep every value of their closed vocabularies", () => {
  it.each(STOP_ADDED_SURFACES)("stop_added surface %s", (surface) => {
    expect(sanitizeEvent("stop_added", { surface })).toEqual({ name: "stop_added", props: { surface } });
  });

  it.each(ROUTE_OPENED_SURFACES)("route_opened surface %s", (surface) => {
    expect(sanitizeEvent("route_opened", { surface })).toEqual({ name: "route_opened", props: { surface } });
  });

  it.each(VENUE_SHEET_LAYERS)("pub_viewed layer %s", (layer) => {
    expect(sanitizeEvent("pub_viewed", { layer })).toEqual({ name: "pub_viewed", props: { layer } });
  });

  it.each(VOICE_END_REASONS)("voice_ended reason %s", (reason) => {
    expect(sanitizeEvent("voice_ended", { reason })).toEqual({ name: "voice_ended", props: { reason } });
  });

  it.each(CONTENT_SHARE_SURFACES.flatMap((surface) => (
    CONTENT_SHARE_CHANNELS.map((channel) => [channel, surface] as const)
  )))("content_shared channel %s surface %s", (channel, surface) => {
    expect(sanitizeEvent("content_shared", { channel, surface }))
      .toEqual({ name: "content_shared", props: { channel, surface } });
  });

  it.each(ERROR_SHOWN_SURFACES.flatMap((surface) => (
    ERROR_SHOWN_KINDS.map((kind) => [surface, kind] as const)
  )))("error_shown surface %s kind %s", (surface, kind) => {
    expect(sanitizeEvent("error_shown", { surface, kind }))
      .toEqual({ name: "error_shown", props: { surface, kind } });
  });

  it("keeps crawl_locked stop counts inside one to ten", () => {
    expect(sanitizeEvent("crawl_locked", { stops: 3 })).toEqual({ name: "crawl_locked", props: { stops: 3 } });
    expect(sanitizeEvent("crawl_locked", { stops: 11 })).toBeNull();
  });

  it("fails closed on a value from another event's vocabulary", () => {
    expect(sanitizeEvent("voice_ended", { reason: "poster" })).toBeNull();
    expect(sanitizeEvent("content_shared", { channel: "copy", surface: "error" })).toBeNull();
    expect(sanitizeEvent("stop_added", { surface: "tonight" })).toBeNull();
  });
});
