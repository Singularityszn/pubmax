// Crawl name generator (launch review F9): deterministic per plan id, the noun
// comes from a stop's own name, never a banned word, never a stop's full name.

import { describe, expect, it } from "vitest";

import {
  crawlNameNouns,
  generateCrawlName,
  isBannedCrawlNameWord,
} from "@/lib/crawlNameGenerator";
import { VIBE_CHIP_IDS } from "@/lib/vibeChips";

const STOPS = ["The Lamb and Flag", "The Anchor", "The Brass Compass Arms"];
const VOICE_BANS = [
  "experience", "discover", "elevate", "seamless", "curated", "unleash", "empower",
  "vibrant", "delve", "journey", "effortless", "immerse", "robust", "leverage", "unlock",
  "revolutionary", "sesh", "carnage", "session",
];

function planIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
}

describe("generateCrawlName", () => {
  it("returns the same name for the same plan every time", () => {
    const first = generateCrawlName({ planId: "plan-a", stopNames: STOPS, vibe: "quiet" });
    for (let i = 0; i < 5; i += 1) {
      expect(generateCrawlName({ planId: "plan-a", stopNames: STOPS, vibe: "quiet" })).toBe(first);
    }
    expect(first).toMatch(/^The [A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("varies the name across plan ids", () => {
    const names = new Set(planIds(40).map((planId) => generateCrawlName({ planId, stopNames: STOPS })));
    expect(names.size).toBeGreaterThan(5);
  });

  it("draws its noun from a stop's own name", () => {
    const nouns = new Set(crawlNameNouns(STOPS));
    expect([...nouns]).toEqual(["Lamb", "Flag", "Anchor", "Brass", "Compass"]);
    for (const planId of planIds(60)) {
      for (const vibe of [...VIBE_CHIP_IDS, null]) {
        const noun = generateCrawlName({ planId, stopNames: STOPS, vibe }).split(" ")[2]!;
        expect(nouns.has(noun)).toBe(true);
      }
    }
  });

  it("keeps the adjective in the vibe's own closed list", () => {
    const quiet = new Set(planIds(60).map((planId) => generateCrawlName({ planId, stopNames: STOPS, vibe: "quiet" }).split(" ")[1]));
    expect([...quiet].every((word) => ["Quiet", "Gentle", "Hushed", "Lamplit", "Snug"].includes(word!))).toBe(true);
  });

  it("never emits a banned word or a drinking word", () => {
    const sly = ["The Sesh Tavern", "Carnage Bar", "The Pint and Session", "The Lager Journey"];
    for (const planId of planIds(60)) {
      for (const vibe of [...VIBE_CHIP_IDS, null]) {
        for (const stopNames of [STOPS, sly]) {
          const name = generateCrawlName({ planId, stopNames, vibe });
          for (const word of name.split(" ")) {
            expect(VOICE_BANS).not.toContain(word.toLowerCase());
            expect(isBannedCrawlNameWord(word)).toBe(false);
          }
          expect(name).not.toMatch(/[—!]/);
        }
      }
    }
  });

  it("never equals a stop's full name or a name the caller avoids", () => {
    // A route whose only nouns could rebuild a real stop: "The Brass Compass".
    const stopNames = ["The Brass Compass", "Victorian Soho"];
    for (const planId of planIds(80)) {
      const name = generateCrawlName({ planId, stopNames, avoidNames: ["The Quiet Soho"] });
      expect(name.toLowerCase()).not.toBe("the brass compass");
      expect(name.toLowerCase()).not.toBe("the quiet soho");
      for (const stop of stopNames) expect(name.replace(/^The /, "").toLowerCase()).not.toBe(stop.replace(/^The /, "").toLowerCase());
    }
  });

  it("falls back to a closed pub-sign noun when no stop has a usable word", () => {
    const name = generateCrawlName({ planId: "plan-a", stopNames: ["The Inn", "Ye Olde Tap"] });
    expect(name).toMatch(/^The [A-Z][a-z]+ (?:Compass|Lantern|Anchor|Crown|Lamb|Kettle|Fox|Bell)$/);
  });
});
