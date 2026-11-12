import { describe, expect, it } from "vitest";

import { londonFamousPubs, londonWeekNumber, pickPubOfTheWeek } from "@/lib/guides";
import type { HistoricPub } from "@/lib/historic";

function pub(overrides: Partial<HistoricPub> & { name: string }): HistoricPub {
  const slug = overrides.slug ?? overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const hook = overrides.hook ?? `${overrides.name} is an old London pub.`;
  const base: HistoricPub = {
    venueId: `venue-${slug}`,
    name: overrides.name,
    slug,
    borough: "Test",
    lat: 51.5,
    lng: 0,
    hook,
    facts: [{ source: "wikipedia", fact: hook, sourceRef: `https://en.wikipedia.org/wiki/${slug}` }],
    era: null,
    listed: null,
    sourced: true,
  };
  return { ...base, ...overrides };
}

const WEEK_MS = 7 * 86_400_000;

describe("londonWeekNumber", () => {
  it("turns the week at London midnight on Monday in winter", () => {
    const sundayLate = new Date("2026-11-08T23:59:00Z");
    const mondayEarly = new Date("2026-11-09T00:01:00Z");
    expect(londonWeekNumber(mondayEarly)).toBe(londonWeekNumber(sundayLate) + 1);
  });

  it("turns the week at London midnight on Monday in summer time, not at UTC midnight", () => {
    const sundayUtcButMondayInLondon = new Date("2026-06-07T23:30:00Z");
    const mondayNoon = new Date("2026-06-08T12:00:00Z");
    const sundayNoon = new Date("2026-06-07T12:00:00Z");
    expect(londonWeekNumber(sundayUtcButMondayInLondon)).toBe(londonWeekNumber(mondayNoon));
    expect(londonWeekNumber(sundayUtcButMondayInLondon)).toBe(londonWeekNumber(sundayNoon) + 1);
  });
});

describe("pickPubOfTheWeek", () => {
  const pubs = Array.from({ length: 12 }, (_, index) => pub({ name: `Pub ${String(index).padStart(2, "0")}` }));

  it("gives every reader the same pub all week, and moves on the next Monday", () => {
    const monday = pickPubOfTheWeek(pubs, new Date("2026-11-09T08:00:00Z"));
    const sunday = pickPubOfTheWeek(pubs, new Date("2026-11-15T22:00:00Z"));
    const nextMonday = pickPubOfTheWeek(pubs, new Date("2026-11-16T08:00:00Z"));
    expect(monday?.pub.slug).toBe(sunday?.pub.slug);
    expect(nextMonday?.pub.slug).not.toBe(monday?.pub.slug);
    expect(monday?.weekStartsOn).toBe("2026-11-09");
    expect(nextMonday?.weekStartsOn).toBe("2026-11-16");
  });

  it("reaches every pub once before it repeats one, whatever order the file is in", () => {
    const start = new Date("2026-11-09T08:00:00Z").getTime();
    const seen = Array.from(
      { length: pubs.length },
      (_, week) => pickPubOfTheWeek([...pubs].reverse(), new Date(start + week * WEEK_MS))?.pub.slug,
    );
    expect(new Set(seen).size).toBe(pubs.length);
    expect(pickPubOfTheWeek(pubs, new Date(start))?.pub.slug).toBe(seen[0]);
  });

  it("never picks a pub that is closed, off the map or without a cited hook", () => {
    const passedOver = [
      pub({ name: "Closed Arms", venueStatus: "closed" }),
      pub({ name: "Gone Tavern", venueStatus: "demolished" }),
      pub({ name: "Unmapped Inn", venueId: null }),
      pub({ name: "Uncited Bell", facts: [] }),
      pub({ name: "Blank Hook", hook: " " }),
    ];
    const only = pub({ name: "The Only One" });
    const start = new Date("2026-11-09T08:00:00Z").getTime();
    for (let week = 0; week < 10; week += 1) {
      const pick = pickPubOfTheWeek([...passedOver, only], new Date(start + week * WEEK_MS));
      expect(pick?.pub.slug).toBe("the-only-one");
      expect(pick?.sourceHref).toBe("https://en.wikipedia.org/wiki/the-only-one");
    }
    expect(pickPubOfTheWeek(passedOver, new Date(start))).toBeNull();
  });
});

describe("londonFamousPubs", () => {
  it("lists dated pubs on the map, oldest first, and leaves out closed and undated ones", () => {
    const famous = londonFamousPubs([
      pub({ name: "Victorian Vaults", era: "1850" }),
      pub({ name: "Undated Swan" }),
      pub({ name: "Old Wharf", era: "1520" }),
      pub({ name: "Closed Crown", era: "1400", venueStatus: "closed" }),
      pub({ name: "Unmapped Mitre", era: "1450", venueId: null }),
      pub({ name: "Century Arms", era: "17th century" }),
    ]);
    expect(famous.map((row) => row.name)).toEqual(["Old Wharf", "Century Arms", "Victorian Vaults"]);
  });
});
