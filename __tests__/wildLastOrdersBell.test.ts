import { describe, expect, it } from "vitest";

import { londonCivilTime } from "@/lib/lastOrders";
import type { LastOrdersPub } from "@/lib/lastOrdersList";
import { BELL_MINUTES, findBellPub, lastOrdersBell, wildClockFromSearch } from "@/lib/wildLastOrdersBell";

// THE LAST ORDERS BELL (wild idea 07). It rings only for a pub whose SOURCED
// hours say it closes within 45 minutes, and it names a pub open later only
// when the same hours say so and the walk leaves time for a drink.

// Monday 2 November 2026: after the clocks went back, so a `Z` instant is the
// London wall clock, and not a bank holiday.
const MONDAY = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);

function pub(venueId: string, name: string, lat: number, lng: number, openingHours: string): LastOrdersPub {
  return { venueId, name, lat, lng, openingHours, hoursCheckDate: null };
}

// The Dog and Duck and its neighbours in Soho, with their OpenStreetMap hours.
const DOG = pub("venue-osm-n14178896030", "The Dog and Duck", 51.514, -0.13196, "Mo-We 12:00-23:00; Th 12:00-23:30; Fr 12:00-24:00; Sa 11:30-24:00; Su 12:00-22:30");
const HORSE = pub("venue-osm-w244772119", "Black Horse", 51.51671, -0.133, "Mo-Th 12:00-23:30; Fr-Sa 12:00-24:00; Su 12:00-22:00");
const SHUTS_FIRST = pub("venue-near-early", "The Early One", 51.5141, -0.1321, "Mo-Su 12:00-22:50");
const FAR = pub("venue-far", "Far Away Arms", 51.55, -0.2, "Mo-Su 12:00-02:00");
const PACK = [DOG, HORSE, SHUTS_FIRST, FAR];

describe("lastOrdersBell", () => {
  it("rings inside the last 45 minutes, with the close and a pub open later nearby", () => {
    const answer = lastOrdersBell({ pubs: PACK, pub: { venueId: DOG.venueId, name: DOG.name }, now: MONDAY("22:40") });
    expect(answer).toMatchObject({
      venueId: DOG.venueId,
      minutesLeft: 20,
      closesAt: "23:00",
      when: "tonight",
    });
    expect(answer?.nearby).toMatchObject({ venueId: HORSE.venueId, name: "Black Horse", closesAt: "23:30" });
    expect(answer?.nearby?.walkMinutes).toBeLessThanOrEqual(10);
  });

  it("stays quiet with more than 45 minutes left, and once the pub has closed", () => {
    expect(BELL_MINUTES).toBe(45);
    expect(lastOrdersBell({ pubs: PACK, pub: { venueId: DOG.venueId, name: DOG.name }, now: MONDAY("22:10") })).toBeNull();
    expect(lastOrdersBell({ pubs: PACK, pub: { venueId: DOG.venueId, name: DOG.name }, now: MONDAY("22:15") })).not.toBeNull();
    expect(lastOrdersBell({ pubs: PACK, pub: { venueId: DOG.venueId, name: DOG.name }, now: MONDAY("23:05") })).toBeNull();
  });

  it("never rings for a pub whose hours it does not hold or cannot read", () => {
    expect(lastOrdersBell({ pubs: PACK, pub: { venueId: "venue-unknown", name: "Nowhere" }, now: MONDAY("22:40") })).toBeNull();
    const unreadable = pub("venue-odd", "Odd Hours", 51.514, -0.132, "Jan-Mar Mo 12:00-23:00; \"by appointment\"");
    expect(lastOrdersBell({ pubs: [unreadable], pub: { venueId: "venue-odd", name: "Odd Hours" }, now: MONDAY("22:40") })).toBeNull();
  });

  it("stays quiet on a bank holiday the hours say nothing about", () => {
    const christmas = new Date("2026-12-25T22:40:00Z");
    expect(lastOrdersBell({ pubs: PACK, pub: { venueId: DOG.venueId, name: DOG.name }, now: christmas })).toBeNull();
  });

  it("names no pub nearby when none is open later, or the walk leaves no time to drink", () => {
    const alone = lastOrdersBell({ pubs: [DOG, SHUTS_FIRST, FAR], pub: { venueId: DOG.venueId, name: DOG.name }, now: MONDAY("22:40") });
    expect(alone?.nearby).toBeNull();
    // Open only five minutes past the Dog and Duck is not open later in any way that helps.
    const tight = pub("venue-tight", "Tight Squeeze", 51.5155, -0.1325, "Mo-Su 12:00-23:05");
    const answer = lastOrdersBell({ pubs: [DOG, tight], pub: { venueId: DOG.venueId, name: DOG.name }, now: MONDAY("22:40") });
    expect(answer?.nearby).toBeNull();
  });

  it("says today for an afternoon close", () => {
    const afternoon = pub("venue-lunch", "The Lunch Bar", 51.514, -0.132, "Mo-Fr 11:00-15:00");
    const answer = lastOrdersBell({ pubs: [afternoon], pub: { venueId: "venue-lunch", name: "The Lunch Bar" }, now: MONDAY("14:30") });
    expect(answer).toMatchObject({ closesAt: "15:00", when: "today", minutesLeft: 30 });
  });
});

describe("findBellPub", () => {
  it("matches by id first, then by the same name a few doors away", () => {
    expect(findBellPub(PACK, { venueId: HORSE.venueId, name: "anything" })).toBe(HORSE);
    expect(findBellPub(PACK, { venueId: "venue-curated", name: "Dog & Duck", lat: 51.5141, lng: -0.132 })).toBe(DOG);
    expect(findBellPub(PACK, { venueId: "venue-curated", name: "Dog & Duck", lat: 51.52, lng: -0.132 })).toBeNull();
    expect(findBellPub(PACK, { venueId: "venue-curated", name: "Dog & Duck" })).toBeNull();
  });
});

describe("wildClockFromSearch", () => {
  it("reads HH:MM as that minute of today on London's clock", () => {
    const today = new Date("2026-11-02T09:15:00Z");
    const clock = wildClockFromSearch("?wild=1&wildclock=22:40", today);
    expect(clock?.toISOString()).toBe("2026-11-02T22:40:00.000Z");
  });

  it("reads London's summer clock on a summer day", () => {
    const clock = wildClockFromSearch("?wildclock=22:40", new Date("2026-07-10T09:00:00Z"));
    expect(clock).not.toBeNull();
    expect(londonCivilTime(clock!).minutes).toBe(22 * 60 + 40);
    expect(clock?.toISOString()).toBe("2026-07-10T21:40:00.000Z");
  });

  it("ignores an address that does not ask, or asks for a time that is not one", () => {
    const today = new Date("2026-11-02T09:15:00Z");
    expect(wildClockFromSearch("", today)).toBeNull();
    expect(wildClockFromSearch("?wildclock=25:00", today)).toBeNull();
    expect(wildClockFromSearch("?wildclock=tea", today)).toBeNull();
  });
});
