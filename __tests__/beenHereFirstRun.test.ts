// "Been here" (lib/beenHere.ts): the pubs the first-run card offers, the copy
// it prints, the one carry request's id rule and the device markers.
//
// The pubs are no invention of the card's: each is a stop on a hand-made
// London crawl AND a pub the cited historic record carries, and its name and
// area are the venue dataset's own.

import { describe, expect, it } from "vitest";

import {
  BEEN_HERE_CARRY_KEY,
  BEEN_HERE_CARRY_MAX,
  BEEN_HERE_COPY,
  BEEN_HERE_FIRST_RUN_PUBS,
  BEEN_HERE_FIRST_RUN_SEEN_KEY,
  BEEN_HERE_LIST,
  carryAfterTap,
  carryBelongsTo,
  hasSeenBeenHereFirstRun,
  markBeenHereFirstRunSeen,
  parseBeenHereVenueIds,
  readBeenHereCarry,
  writeBeenHereCarry,
} from "@/lib/beenHere";
import { curatedCrawls } from "@/lib/curatedCrawls";
import { DEVICE_IDENTITY_LOCAL_KEYS } from "@/lib/deviceAccountIdentity";
import { BUILT_IN_LIST_TYPES, eligibleBuiltInListTypes } from "@/lib/savedListPolicy";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import dataset from "../public/data/pint_prices_app_dataset.json";
import historicPubs from "../public/data/historic_pubs.json";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

describe("the Been here list", () => {
  it("is a built-in saved list every venue may hold", () => {
    expect(BUILT_IN_LIST_TYPES).toContain(BEEN_HERE_LIST);
    for (const kind of [undefined, "pub", "bar", "food"] as const) {
      expect(eligibleBuiltInListTypes(kind)).toContain(BEEN_HERE_LIST);
    }
  });
});

describe("the pubs the card offers", () => {
  const venues = new Map(groupVenuePrices(dataset as VenuePrice[]).map((venue) => [venue.id, venue]));
  const crawlStops = new Set(curatedCrawls.flatMap((crawl) => crawl.venueIds));
  const cited = new Map(
    (historicPubs as Array<{ venueId?: string; facts?: Array<{ sourceRef?: string }> }>)
      .filter((pub) => pub.venueId)
      .map((pub) => [pub.venueId!, pub]),
  );

  it("offers about a dozen distinct pubs", () => {
    expect(BEEN_HERE_FIRST_RUN_PUBS).toHaveLength(12);
    expect(new Set(BEEN_HERE_FIRST_RUN_PUBS.map((pub) => pub.venueId)).size).toBe(12);
  });

  it.each(BEEN_HERE_FIRST_RUN_PUBS.map((pub) => [pub.name, pub] as const))(
    "%s is a hand-made crawl stop, cited in the historic record, named as the map names it",
    (_name, pub) => {
      expect(crawlStops.has(pub.venueId), `${pub.venueId} is not a curated crawl stop`).toBe(true);
      const record = cited.get(pub.venueId);
      expect(record, `${pub.venueId} is not in the historic record`).toBeDefined();
      expect(record?.facts?.some((fact) => /^https:\/\//.test(fact.sourceRef ?? ""))).toBe(true);
      const venue = venues.get(pub.venueId);
      expect(venue, `${pub.venueId} is not in the venue dataset`).toBeDefined();
      expect(pub.name).toBe(venue?.name);
      expect(pub.area).toBe(venue?.primaryBorough);
    },
  );
});

describe("the card's words", () => {
  const lines = Object.values(BEEN_HERE_COPY);

  it("says what the code does and promises no date", () => {
    expect(BEEN_HERE_COPY.title).toBe("Tap the pubs you've been to");
    expect(BEEN_HERE_COPY.lead).toMatch(/No dates/);
    expect(BEEN_HERE_COPY.deviceLine).toMatch(/this device/);
    expect(BEEN_HERE_COPY.accountLine).toMatch(/profile/);
    expect(BEEN_HERE_COPY.done).toBe("Done");
    expect(BEEN_HERE_COPY.notNow).toBe("Not now");
  });

  it("keeps the house voice: no dash, no exclamation, no banned word, no count", () => {
    const banned =
      /\b(experience|discover|elevate|seamless|curated|unleash|empower|vibrant|delve|journey|effortless|unlock|streak|level|score)\b/i;
    for (const line of lines) {
      expect(line).not.toMatch(/[—–]/);
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(banned);
      expect(line).not.toMatch(/please try again|check back later|don't miss out/i);
      expect(line).not.toMatch(/\d/);
    }
  });
});

describe("the carry request's ids", () => {
  it("takes one to BEEN_HERE_CARRY_MAX plain ids, deduplicated in order", () => {
    expect(parseBeenHereVenueIds([" venue-a ", "venue-b", "venue-a"])).toEqual(["venue-a", "venue-b"]);
    const most = Array.from({ length: BEEN_HERE_CARRY_MAX }, (_, index) => `venue-${index}`);
    expect(parseBeenHereVenueIds(most)).toEqual(most);
  });

  it.each([
    ["not a list", "venue-a"],
    ["an empty list", []],
    ["a number", ["venue-a", 4]],
    ["a blank", [" "]],
    ["a space inside", ["venue a"]],
    ["markup", ["<b>venue</b>"]],
    ["a long id", ["v".repeat(65)]],
    ["too many", Array.from({ length: BEEN_HERE_CARRY_MAX + 1 }, (_, index) => `venue-${index}`)],
  ])("refuses %s", (_label, value) => {
    expect(parseBeenHereVenueIds(value)).toBeNull();
  });
});

describe("the device markers", () => {
  it("shows the card once: the mark stays once it is set", () => {
    const storage = memoryStorage();
    expect(hasSeenBeenHereFirstRun(storage)).toBe(false);
    markBeenHereFirstRunSeen(storage);
    expect(storage.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY)).toBe("1");
    expect(hasSeenBeenHereFirstRun(storage)).toBe(true);
  });

  it("treats a store it cannot read as seen, so a card that cannot be kept never nags", () => {
    expect(hasSeenBeenHereFirstRun(null)).toBe(true);
  });

  it("keeps the carry set on the device, owned by the account it was tapped under", () => {
    const storage = memoryStorage();
    let carry = readBeenHereCarry(storage);
    expect(carry).toEqual({ owner: null, venueIds: [] });
    carry = carryAfterTap(carry, "venue-a", true, null);
    carry = carryAfterTap(carry, "venue-b", true, null);
    carry = carryAfterTap(carry, "venue-a", false, null);
    writeBeenHereCarry(carry, storage);
    expect(readBeenHereCarry(storage)).toEqual({ owner: null, venueIds: ["venue-b"] });
    // A tap under an account starts that account's own set.
    expect(carryAfterTap(carry, "venue-c", true, "user-1")).toEqual({ owner: "user-1", venueIds: ["venue-c"] });
    writeBeenHereCarry({ owner: null, venueIds: [] }, storage);
    expect(storage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull();
  });

  it("moves a signed-out set to any account, and an account's set to that account alone", () => {
    expect(carryBelongsTo({ owner: null, venueIds: ["venue-a"] }, "user-1")).toBe(true);
    expect(carryBelongsTo({ owner: "user-1", venueIds: ["venue-a"] }, "user-1")).toBe(true);
    expect(carryBelongsTo({ owner: "user-1", venueIds: ["venue-a"] }, "user-2")).toBe(false);
    expect(carryBelongsTo({ owner: null, venueIds: ["venue-a"] }, "")).toBe(false);
  });

  it("reads a damaged carry set as empty", () => {
    const storage = memoryStorage();
    storage.setItem(BEEN_HERE_CARRY_KEY, "{not json");
    expect(readBeenHereCarry(storage)).toEqual({ owner: null, venueIds: [] });
    storage.setItem(BEEN_HERE_CARRY_KEY, JSON.stringify({ owner: 4, venueIds: ["ok-id", "bad id"] }));
    expect(readBeenHereCarry(storage)).toEqual({ owner: null, venueIds: [] });
  });

  it("is not an identity key: a signed-out tap must survive the sign-in it waits for", () => {
    expect(DEVICE_IDENTITY_LOCAL_KEYS).not.toContain(BEEN_HERE_CARRY_KEY);
    expect(DEVICE_IDENTITY_LOCAL_KEYS).not.toContain(BEEN_HERE_FIRST_RUN_SEEN_KEY);
  });
});
