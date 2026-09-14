import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LANDING_FAQ } from "@/components/landing/LandingFaq";

// The captain asked for an FAQ "where people understand how the app works and
// everything" (7 Sep 2026). Six questions, one paragraph each, in the house
// voice, and nothing a drinker is asked to buy.

const source = readFileSync(join(process.cwd(), "components/landing/LandingFaq.tsx"), "utf8");

/** docs/VOICE.md's own list, the ones a marketing template reaches for. */
const BANNED = [
  "experience",
  "discover",
  "elevate",
  "seamless",
  "curated",
  "unleash",
  "empower",
  "vibrant",
  "delve",
  "dive into",
  "look no further",
  "game-changer",
  "unlock",
  "journey",
  "effortless",
  "immerse",
  "robust",
  "leverage",
  "revolutionary",
  "at your fingertips",
];

describe("the landing FAQ", () => {
  it("asks six questions and answers each in one paragraph", () => {
    expect(LANDING_FAQ).toHaveLength(6);
    for (const entry of LANDING_FAQ) {
      expect(entry.question.endsWith("?")).toBe(true);
      expect(entry.answer.split("\n")).toHaveLength(1);
      expect(entry.answer.length).toBeGreaterThan(60);
    }
    expect(new Set(LANDING_FAQ.map((entry) => entry.id)).size).toBe(6);
  });

  it("covers the six things a stranger actually asks", () => {
    expect(LANDING_FAQ.map((entry) => entry.id)).toEqual([
      "how-it-works",
      "prices",
      "log-a-price",
      "today-tonight",
      "outside-london",
      "app",
    ]);
  });

  it("states the photo rule the composer itself states", () => {
    const answer = LANDING_FAQ.find((entry) => entry.id === "log-a-price")?.answer ?? "";
    expect(answer).toContain("optional");
    expect(answer).toContain("public");
    expect(answer).toMatch(/photo of the bill or the pint/);
  });

  it("says prices are London's, because every listed price we hold is", () => {
    const answer = LANDING_FAQ.find((entry) => entry.id === "outside-london")?.answer ?? "";
    expect(answer).toContain("London");
    expect(answer).toMatch(/not for prices yet/i);
  });

  it("keeps the house voice: no em dash, no exclamation, no template words", () => {
    for (const entry of LANDING_FAQ) {
      const words = `${entry.question} ${entry.answer}`;
      expect(words).not.toContain("—");
      expect(words).not.toContain("!");
      for (const banned of BANNED) {
        expect(words.toLowerCase(), `${banned} in ${entry.id}`).not.toContain(banned);
      }
    }
  });

  it("sells a drinker nothing: no price, no Pro and no waitlist", () => {
    // First revenue comes from venues, never drinkers (AGENTS.md anti-goals).
    // The front door once priced a drinker "Pro" at £9.99 a month with an email
    // field; a price a drinker is asked to pay does not appear here again.
    expect(source).not.toMatch(/£\s?\d/);
    expect(source).not.toMatch(/\bPro\b/);
    expect(source).not.toMatch(/waitlist|subscri|a month/i);
    expect(source).not.toMatch(/<form|<input|mailto:/);
    for (const entry of LANDING_FAQ) {
      expect(`${entry.question} ${entry.answer}`).not.toMatch(/£\s?\d/);
    }
  });
});
