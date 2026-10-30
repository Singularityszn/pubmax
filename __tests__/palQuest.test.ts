import { describe, expect, it } from "vitest";

import {
  PAL_PASSPORT_ANYWHERE,
  PAL_QUEST_NO_DRINK,
  PAL_QUEST_STAMPS_KEY,
  palQuestDoneLine,
  palQuestLine,
  palQuestStampDate,
  palPassportLandmark,
  palPassportPages,
  palPassportPose,
  palQuestStampToday,
  parsePalQuestStamps,
  readPalQuestStamps,
  stampPalQuest,
} from "@/lib/palQuest";

function memoryStore(initial?: unknown) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(PAL_QUEST_STAMPS_KEY, JSON.stringify(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    raw: () => map.get(PAL_QUEST_STAMPS_KEY),
  };
}

// In summer London is an hour ahead of UTC: 23:30 UTC on 1 July is 00:30 on
// 2 July in London, so a quest answered then belongs to 2 July.
const lateSummerNight = new Date("2026-07-01T23:30:00Z");
const autumnDay = new Date("2026-10-30T15:00:00Z");

describe("the Pal's stamp book", () => {
  it("keeps one stamp a day, newest first, and drops anything it cannot read", () => {
    expect(parsePalQuestStamps(null)).toEqual([]);
    expect(parsePalQuestStamps("not json")).toEqual([]);
    expect(parsePalQuestStamps(JSON.stringify({ day: "2026-10-30" }))).toEqual([]);
    expect(
      parsePalQuestStamps(
        JSON.stringify([
          { day: "2026-10-28", venueId: "venue-a", venueName: " The Lamb " },
          { day: "2026-10-30", venueId: "venue-b", venueName: "The Crown" },
          { day: "2026-10-30", venueId: "venue-c", venueName: "A second on the same day" },
          { day: "30/10/2026", venueId: "venue-d", venueName: "Bad day" },
          { day: "2026-10-29", venueId: "", venueName: "No pub" },
          { day: "2026-10-29", venueId: "venue-e", venueName: "  " },
          "junk",
        ]),
      ),
    ).toEqual([
      { day: "2026-10-30", venueId: "venue-b", venueName: "The Crown" },
      { day: "2026-10-28", venueId: "venue-a", venueName: "The Lamb" },
    ]);
  });

  it("never grows without end", () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      day: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      venueId: `venue-${index}`,
      venueName: `Pub ${index}`,
    }));
    const kept = parsePalQuestStamps(JSON.stringify(many));
    expect(kept).toHaveLength(60);
    expect(kept[0]!.venueId).toBe("venue-79");
  });

  it("stamps the London day's first answer only; a second price that day stamps nothing and claims nothing", () => {
    const store = memoryStore();
    expect(stampPalQuest({ venueId: "venue-a", venueName: "The Lamb" }, autumnDay, store)).toEqual(
      { day: "2026-10-30", venueId: "venue-a", venueName: "The Lamb" },
    );
    // The same day answered again (here, or in another tab) adds no stamp, so
    // the second pub is never shown as the first one's stamp.
    expect(stampPalQuest({ venueId: "venue-b", venueName: "The Crown" }, autumnDay, store)).toBeNull();
    expect(readPalQuestStamps(store)).toEqual([{ day: "2026-10-30", venueId: "venue-a", venueName: "The Lamb" }]);
    expect(palQuestStampToday(readPalQuestStamps(store), autumnDay)?.venueName).toBe("The Lamb");
    expect(palQuestStampToday(readPalQuestStamps(store), new Date("2026-10-31T12:00:00Z"))).toBeNull();
  });

  it("buckets on the London day, not the UTC one", () => {
    const store = memoryStore();
    stampPalQuest({ venueId: "venue-a", venueName: "The Lamb" }, lateSummerNight, store);
    expect(readPalQuestStamps(store)[0]!.day).toBe("2026-07-02");
  });

  it("keeps the old book and still answers when storage refuses a write", () => {
    const refusing = {
      getItem: () => JSON.stringify([{ day: "2026-10-29", venueId: "venue-a", venueName: "The Lamb" }]),
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(stampPalQuest({ venueId: "venue-b", venueName: "The Crown" }, autumnDay, refusing)?.day).toBe("2026-10-30");
    expect(readPalQuestStamps(null)).toEqual([]);
  });

  it("prints a stamp's day as the stamp does", () => {
    expect(palQuestStampDate("2026-10-30")).toBe("30 Oct");
    expect(palQuestStampDate("bad")).toBe("");
  });
});

describe("what the Pal says", () => {
  it("asks the mission's own reason in its own words", () => {
    expect(palQuestLine("Ripley", "missing", "The Lamb")).toBe(
      "Ripley's quest for today: nobody has logged a price at The Lamb yet. Be the first?",
    );
    expect(palQuestLine("Ripley", "stale", "The Lamb")).toBe(
      "Ripley's quest for today: the price at The Lamb is out of date. Check the board for me?",
    );
    expect(palQuestLine("Ripley", "provisional", " ")).toBe(
      "Ripley's quest for today: one person logged a price at this pub. Can you check it?",
    );
    expect(palQuestDoneLine("Ripley", "The Lamb")).toBe("Quest done. Ripley stamped The Lamb in your book.");
  });

  it("asks for a price, never a drink, and never keeps score", () => {
    const lines = [
      palQuestLine("Ripley", "missing", "The Lamb"),
      palQuestLine("Ripley", "stale", "The Lamb"),
      palQuestLine("Ripley", "provisional", "The Lamb"),
      palQuestDoneLine("Ripley", "The Lamb"),
      PAL_QUEST_NO_DRINK,
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/!|—|\d|\b(level|points?|xp|streak|in a row|round|another pint|drink up)\b/i);
    }
    expect(PAL_QUEST_NO_DRINK).toBe("No need to buy anything. Read the board or ask at the bar.");
  });
});

describe("the price passport", () => {
  it("keeps a stamp's area, and drops an empty one", () => {
    expect(
      parsePalQuestStamps(JSON.stringify([
        { day: "2026-10-30", venueId: "venue-a", venueName: "The Lamb", area: " Camden " },
        { day: "2026-10-29", venueId: "venue-b", venueName: "The Crown", area: "  " },
      ])),
    ).toEqual([
      { day: "2026-10-30", venueId: "venue-a", venueName: "The Lamb", area: "Camden" },
      { day: "2026-10-29", venueId: "venue-b", venueName: "The Crown" },
    ]);
    const store = memoryStore();
    expect(stampPalQuest({ venueId: "venue-a", venueName: "The Lamb", area: "Camden" }, autumnDay, store)?.area).toBe("Camden");
  });

  it("opens one page per area, the newest page first, and gathers older stamps on one page", () => {
    const pages = palPassportPages([
      { day: "2026-10-27", venueId: "venue-c", venueName: "The Bell", area: "Camden" },
      { day: "2026-10-30", venueId: "venue-a", venueName: "The Lamb", area: "Southwark" },
      { day: "2026-10-28", venueId: "venue-d", venueName: "The Swan" },
      { day: "2026-10-29", venueId: "venue-b", venueName: "The Crown", area: "Camden" },
    ]);
    expect(pages.map((page) => page.area)).toEqual(["Southwark", "Camden", PAL_PASSPORT_ANYWHERE]);
    expect(pages[1]!.stamps.map((stamp) => stamp.venueName)).toEqual(["The Crown", "The Bell"]);
    expect(palPassportPages([])).toEqual([]);
  });

  it("gives the well-known areas their landmark, and every other area a steady one", () => {
    expect(palPassportLandmark("Westminster")).toBe("clock-tower");
    expect(palPassportLandmark("southwark")).toBe("shard");
    expect(palPassportLandmark("Camden")).toBe("market");
    expect(palPassportLandmark("Barnet")).toBe(palPassportLandmark("Barnet"));
    expect(["clock-tower", "dome", "twin-towers", "shard", "wheel", "gherkin", "column", "civic", "keep", "market", "canal", "ship", "chimneys"])
      .toContain(palPassportLandmark(PAL_PASSPORT_ANYWHERE));
  });

  it("poses the Pal its own way for each area, and the same way every visit", () => {
    const camden = palPassportPose("Camden");
    expect(palPassportPose("Camden")).toEqual(camden);
    expect(Math.abs(camden.tiltDeg)).toBeGreaterThanOrEqual(6);
    expect(Math.abs(camden.tiltDeg)).toBeLessThanOrEqual(18);
    expect([1, -1]).toContain(camden.flip);
    expect(camden.hopPx).toBeGreaterThanOrEqual(0);
    expect(camden.hopPx).toBeLessThanOrEqual(6);
    const poses = new Set(["Camden", "Hackney", "Southwark", "Westminster", "Lambeth"].map((area) => JSON.stringify(palPassportPose(area))));
    expect(poses.size).toBeGreaterThan(1);
  });
});

