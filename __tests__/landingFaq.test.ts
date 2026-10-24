import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LandingFaq, { LANDING_FAQ } from "@/components/landing/LandingFaq";
import { RECEIPT_REQUIRED_LINE } from "@/lib/pintDropReceipt";
import { LOG_PRICE_DOOR_LABEL } from "@/lib/pintTrust";

// The captain asked for an FAQ "where people understand how the app works and
// everything" (7 Sep 2026). The UX audit (16 Oct 2026) cut it to three
// questions, two short sentences each at most, in the house voice, and nothing
// a drinker is asked to buy.

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
  it("asks three questions and answers each in two short sentences at most", () => {
    expect(LANDING_FAQ).toHaveLength(3);
    for (const entry of LANDING_FAQ) {
      expect(entry.question.endsWith("?")).toBe(true);
      expect(entry.answer.split("\n")).toHaveLength(1);
      expect(entry.answer.length).toBeGreaterThan(60);
      const sentences = entry.answer.split(/(?<=[.?])\s+/);
      expect(sentences.length, entry.id).toBeLessThanOrEqual(2);
    }
    expect(new Set(LANDING_FAQ.map((entry) => entry.id)).size).toBe(3);
  });

  it("covers the three things a stranger needs before a first tap", () => {
    expect(LANDING_FAQ.map((entry) => entry.id)).toEqual([
      "how-it-works",
      "prices",
      "log-a-price",
    ]);
  });

  it("names the product by its one name", () => {
    expect(LANDING_FAQ[0]?.question).toBe("How does PUBMAXX work?");
  });

  it("names the real price sources and keeps missing read days unknown", () => {
    const html = renderToStaticMarkup(createElement(LandingFaq));
    expect(html).toContain("public directories");
    expect(html).toContain("drinker reports");
    expect(html).toContain("show its read day when known");
    expect(html).not.toContain("each figure shows the day");
  });

  it("names the button the sheet really prints, and the bill rule the composer states", () => {
    const answer = LANDING_FAQ.find((entry) => entry.id === "log-a-price")?.answer ?? "";
    expect(answer).toContain(`tap ${LOG_PRICE_DOOR_LABEL}`);
    expect(answer).toContain("Log it");
    expect(answer).toContain(RECEIPT_REQUIRED_LINE);
    expect(answer).not.toMatch(/price door/i);
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
    const html = renderToStaticMarkup(createElement(LandingFaq));
    expect(html).toContain("Questions people ask");
    expect(html).not.toMatch(/£\s?\d/);
    expect(html).not.toMatch(/\bPro\b/);
    expect(html).not.toMatch(/waitlist|subscri|a month/i);
    expect(html).not.toMatch(/<form|<input|mailto:/);
    for (const entry of LANDING_FAQ) {
      expect(`${entry.question} ${entry.answer}`).not.toMatch(/£\s?\d/);
    }
  });
});
