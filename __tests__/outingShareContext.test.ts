import { describe, expect, it } from "vitest";

import { orderOutingStops } from "@/lib/outingEventStop";
import { parseOutingShareContext, preservedOutingShareSearch, resolveCanonicalOutingEvent } from "@/lib/outingShareContext";

const EVENT = {
  kind: "event",
  id: "gig-42",
  title: "Late set",
  placeName: "Camden Assembly",
  venueId: "venue-camden-assembly",
  source: { label: "Venue programme", url: "https://venue.example/gig-42" },
  startsAt: "2026-09-27T19:30:00.000Z",
  endsAt: "2026-09-27T22:30:00.000Z",
  observedAt: "2026-09-20T10:00:00.000Z",
  admissionGbp: 12,
} as const;

describe("outing share context", () => {
  it("preserves typed intent and ordered sourced event while excluding private and arbitrary query fields", () => {
    const eventStop = JSON.stringify(EVENT);
    const source = new URLSearchParams({
      area: "Camden",
      date: "2026-09-27",
      time: "19:30",
      groupSize: "6",
      budgetGbp: "35",
      alcohol: "none",
      eventStop,
      eventId: EVENT.id,
      eventSourceUrl: EVENT.source.url,
      eventStartsAt: EVENT.startsAt,
      eventEndsAt: EVENT.endsAt,
      eventObservedAt: EVENT.observedAt,
      admissionGbp: "12",
      eventSide: "before",
      homeTime: "23:45",
      secret: "drop-me",
    });

    const encoded = preservedOutingShareSearch(source.toString(), 4);
    const shared = new URLSearchParams(encoded);
    const decoded = parseOutingShareContext(shared);

    expect(decoded).toMatchObject({
      intent: { area: "Camden", date: "2026-09-27", time: "19:30", groupSize: 6, budgetGbp: 35, alcohol: "none" },
      eventStop: EVENT,
      eventPosition: 4,
      eventSide: null,
    });
    expect(shared.has("homeTime")).toBe(false);
    expect(shared.has("secret")).toBe(false);
  });

  it("drops event handoffs whose individual identity conflicts with the typed stop", () => {
    const params = new URLSearchParams({ eventStop: JSON.stringify(EVENT), eventId: "other-event" });
    expect(parseOutingShareContext(params).eventStop).toBeNull();
  });

  it("upgrades event context only on a server-owned ID and source URL match", () => {
    const supplied = { ...EVENT, title: "Caller-edited title", admissionGbp: 99 };
    const canonicalRow = {
      id: EVENT.id,
      kind: "event",
      title: "Canonical listing title",
      placeName: "Canonical venue",
      venueId: "canonical-venue-id",
      source: EVENT.source,
      startsAt: EVENT.startsAt,
      endsAt: EVENT.endsAt,
      observedAt: "2026-09-21T10:00:00.000Z",
      priceGbp: 8,
    } as import("@/lib/whatsOn").WhatsOnRow;

    expect(resolveCanonicalOutingEvent(supplied, [canonicalRow])).toEqual({
      eventStop: expect.objectContaining({
        title: "Canonical listing title",
        placeName: "Canonical venue",
        venueId: "canonical-venue-id",
        admissionGbp: 8,
      }),
      verified: true,
    });
    expect(resolveCanonicalOutingEvent(supplied, [{ ...canonicalRow, source: { ...EVENT.source, url: "https://other.example/event" } }])).toEqual({
      eventStop: supplied,
      verified: false,
    });
  });

  it("keeps the event as a typed non-pub stop at its selected position", () => {
    const pubs = [{ id: "pub-a" }, { id: "pub-b" }];
    expect(orderOutingStops(pubs, EVENT, 1)).toEqual([
      { kind: "pub", stop: pubs[0] },
      { kind: "event", event: EVENT },
      { kind: "pub", stop: pubs[1] },
    ]);
  });
});
