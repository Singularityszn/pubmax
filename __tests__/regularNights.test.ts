// Regular nights (launch review 3.3, 30 Oct 2026): the weekly quiz, the weekly
// music session and the pubs that say they show live sport, read from the
// committed what's-on files only, each with its source and its read date.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseRegularNights,
  regularNightsForWeekday,
  regularNightsLead,
  regularNightsWeekday,
  regularNightSourceLine,
  regularNightTimeLabel,
} from "@/lib/regularNights";

function committed(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "public/data/whats_on", name), "utf8"));
}

const FILES = {
  quiz: committed("quiz_london.json"),
  music: committed("music_london.json"),
  sport: committed("sport_attributes.json"),
};

const TUESDAY = 2;
const SUNDAY = 0;

describe("regularNightsForWeekday over the committed files", () => {
  const all = parseRegularNights(FILES);

  it("answers Tuesday with Question One's Tuesday quizzes, each with its source and read date", () => {
    const answer = regularNightsForWeekday(all, TUESDAY);
    expect(answer.weekdayLabel).toBe("Tuesday");
    expect(answer.nights.length).toBeGreaterThan(0);
    for (const night of answer.nights) {
      expect(night.weekday).toBe(TUESDAY);
      expect(night.kind).not.toBe("sport");
      expect(night.source.label).toBeTruthy();
      expect(Number.isFinite(Date.parse(night.readAt))).toBe(true);
    }
    const quiz = answer.nights.filter((night) => night.kind === "quiz");
    expect(quiz.length).toBeGreaterThan(0);
    expect(new Set(quiz.map((night) => night.source.label))).toEqual(new Set(["Question One"]));
    expect(regularNightSourceLine(quiz[0]!)).toBe("per Question One, read 18 July 2026");
    // Earliest start first.
    const times = answer.nights.map((night) => night.time ?? "99:99");
    expect([...times].sort()).toEqual(times);
    expect(answer.readAt).toBe("2026-07-18T21:20:05.134Z");
  });

  it("puts the venue's own weekly music on its weekday, under a dash-free source name", () => {
    const sunday = regularNightsForWeekday(all, SUNDAY);
    const music = sunday.nights.filter((night) => night.kind === "music");
    expect(music.map((night) => night.placeName)).toEqual(
      expect.arrayContaining(["The Ivy House", "Skehan's"]),
    );
    for (const night of music) expect(night.source.label).not.toMatch(/[—–]/);
    expect(regularNightsForWeekday(all, TUESDAY).nights.some((n) => n.title === "Jazz + Roasts Sundays")).toBe(false);
  });

  it("keeps live sport a pub attribute with no weekday and no fixture", () => {
    const sport = all.filter((night) => night.kind === "sport");
    expect(sport.length).toBe(94);
    expect(sport.every((night) => night.weekday === null && night.time === null)).toBe(true);
    expect(sport.every((night) => night.source.label === "Greene King")).toBe(true);
    const answer = regularNightsForWeekday(all, TUESDAY, { lat: 51.4995, lng: -0.1357 });
    expect(answer.sportCount).toBe(94);
    expect(answer.sport).toHaveLength(3);
    // Nearest first: the Adam & Eve sits on that point.
    expect(answer.sport[0]?.placeName).toBe("Adam & Eve (St James)");
  });
});

describe("parseRegularNights refuses what it cannot back", () => {
  const read = "2026-07-18T21:20:05.134Z";

  it("drops a quiz row that never says which weekday it runs", () => {
    const nights = parseRegularNights({
      quiz: { rows: [{
        id: "q1", placeName: "The Anchor", title: "Pub quiz", detail: "Monthly pub quiz",
        startsAt: "2026-07-21T19:00:00+01:00", source: { label: "Question One", url: "https://questionone.com/x" },
        observedAt: read,
      }] },
    });
    expect(nights).toEqual([]);
  });

  it("drops a quiz row whose stated weekday and dated start disagree", () => {
    const nights = parseRegularNights({
      quiz: { rows: [{
        id: "q2", placeName: "The Anchor", title: "Pub quiz", detail: "every Monday 19:00",
        startsAt: "2026-07-21T19:00:00+01:00", source: { label: "Question One", url: "https://questionone.com/x" },
        observedAt: read,
      }] },
    });
    expect(nights).toEqual([]);
  });

  it("drops a music row nobody said was weekly, and any row with no read date", () => {
    const nights = parseRegularNights({
      music: { rows: [
        {
          id: "m1", placeName: "The Gig", title: "One-off gig", detail: "A band plays.",
          startsAt: "2026-07-21T20:00:00+01:00", source: { label: "The Gig", url: "https://example.com" },
          observedAt: read,
        },
        {
          id: "m2", placeName: "The Gig", title: "Weekly jam", detail: "Every Tuesday.",
          startsAt: "2026-07-21T20:00:00+01:00", source: { label: "The Gig", url: "https://example.com" },
        },
      ] },
    });
    expect(nights).toEqual([]);
  });

  // Review finding 5 (PR 2402): "every", "recurring" and "residency" do not say
  // weekly. A monthly residency on one dated Friday is not a Friday regular.
  it("drops a monthly music residency that only says every, recurring or residency", () => {
    const row = (id: string, title: string, detail: string, startsAt = "2026-07-24T20:00:00+01:00") => ({
      id, placeName: "The Gig", title, detail, startsAt,
      source: { label: "The Gig", url: "https://example.com" }, observedAt: read,
    });
    const nights = parseRegularNights({
      music: { rows: [
        row("m1", "Jazz residency", "Recurring jazz night, every first Friday of the month."),
        row("m2", "Monthly soul night", "Our residency returns every month."),
        row("m3", "Folk residency", "A recurring folk session."),
        row("m4", "Every so often", "Every now and then a band plays on a Friday."),
        // The stated weekday must be the dated one.
        row("m5", "Blues jam", "Every Tuesday from 8pm."),
      ] },
    });
    expect(nights).toEqual([]);
  });

  // Review P3c (PR 2402): an ordinal week ("1st and 3rd Fridays", "2nd
  // Friday", "last Friday") is not weekly, however the title reads.
  it("drops a music row that names ordinal weeks of the month", () => {
    const row = (id: string, title: string, detail: string, startsAt = "2026-07-24T20:00:00+01:00") => ({
      id, placeName: "The Gig", title, detail, startsAt,
      source: { label: "The Gig", url: "https://example.com" }, observedAt: read,
    });
    const phrases: Array<[string, string, string?]> = [
      ["Jazz Fridays", "Live jazz on the 1st and 3rd Fridays."],
      ["Jazz Fridays", "Live jazz every 2nd Friday."],
      ["Soul Thursdays", "Soul on the 3rd Thursday of the month.", "2026-07-23T20:00:00+01:00"],
      ["Jazz Fridays", "Live jazz on the last Friday."],
      ["Jazz Fridays", "Live jazz on the 2nd & 4th Fridays."],
      ["Jazz Fridays", "Live jazz on the last Fridays."],
    ];
    for (const [title, detail, startsAt] of phrases) {
      expect(parseRegularNights({ music: { rows: [row("o1", title, detail, startsAt)] } }), detail).toEqual([]);
    }
    const weekly = parseRegularNights({
      music: { rows: [
        row("w1", "Blues jam", "Every Friday from 8pm."),
        row("w2", "Jazz Fridays", "Live jazz, last orders at 11pm."),
      ] },
    });
    expect(weekly.map((night) => [night.id, night.weekday])).toEqual([["w1", 5], ["w2", 5]]);
  });

  it("keeps music that says weekly in so many words", () => {
    const row = (id: string, title: string, detail: string) => ({
      id, placeName: "The Gig", title, detail, startsAt: "2026-07-24T20:00:00+01:00",
      source: { label: "The Gig", url: "https://example.com" }, observedAt: read,
    });
    const nights = parseRegularNights({
      music: { rows: [
        row("w1", "Blues jam", "Every Friday from 8pm."),
        row("w2", "Jazz Fridays", "Live jazz."),
        row("w3", "Weekly Friday jam", "Bring an instrument."),
      ] },
    });
    expect(nights.map((night) => [night.id, night.weekday])).toEqual([["w1", 5], ["w2", 5], ["w3", 5]]);
  });
});

describe("regular night wording", () => {
  it("reads the London night, so 1am Saturday is still Friday", () => {
    expect(regularNightsWeekday(new Date("2026-10-31T00:30:00Z"))).toBe(5);
    expect(regularNightsWeekday(new Date("2026-10-30T19:00:00Z"))).toBe(5);
  });

  it("says a time the way a pub board does", () => {
    expect(regularNightTimeLabel("19:30")).toBe("7:30pm");
    expect(regularNightTimeLabel("20:00")).toBe("8pm");
    expect(regularNightTimeLabel(null)).toBeNull();
  });

  it("says it is not tonight's listing", () => {
    expect(regularNightsLead({ weekdayLabel: "Friday" })).toContain("Not tonight\u2019s listing");
  });
});
