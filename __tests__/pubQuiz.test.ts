import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pickPubQuizQuestion, PUB_QUIZ_GRADES, type PubQuizListing } from "@/lib/pubQuiz";

const entry = (id: number) => `https://historicengland.org.uk/listing/the-list/list-entry/${id}`;

const LISTINGS: PubQuizListing[] = [
  { grade: "II", listedYear: 1974, name: "The Plain Arms", url: entry(1) },
  { grade: "II*", listedYear: 1983, name: "Druid's Head Public House", url: entry(2) },
  { grade: "I", listedYear: 1950, name: "The George Inn", url: entry(3) },
];

/** A random source that hands back the given numbers in order. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe("pickPubQuizQuestion", () => {
  it("asks for the grade, and the answer is the listing's own grade", () => {
    // rare pool (0.1 < 0.5), first rare listing (0), grade question (0.9 >= 0.5)
    const quiz = pickPubQuizQuestion(LISTINGS, sequence(0.1, 0, 0.9));
    expect(quiz).toEqual({
      question: "What grade is Druid's Head Public House listed?",
      options: PUB_QUIZ_GRADES,
      answer: "Grade II*",
      detail: "It went on the list in 1983.",
      sourceUrl: entry(2),
    });
  });

  it("asks for the year, with the true year among sorted options", () => {
    // whole pool (0.9), The George Inn (0.99), year question (0.1), then two other years
    const quiz = pickPubQuizQuestion(LISTINGS, sequence(0.9, 0.99, 0.1, 0, 0));
    expect(quiz?.question).toBe("When did The George Inn go on the heritage list?");
    expect(quiz?.answer).toBe("1950");
    expect(quiz?.options).toEqual(["1950", "1974", "1983"]);
    expect(quiz?.detail).toBe("It is listed Grade I.");
  });

  it("skips a listing whose link is not a Historic England entry", () => {
    const quiz = pickPubQuizQuestion(
      [{ grade: "II", listedYear: 1974, name: "The Odd One", url: "https://example.com/1" }],
      () => 0,
    );
    expect(quiz).toBeNull();
  });

  it("asks nothing when the pack is empty", () => {
    expect(pickPubQuizQuestion([])).toBeNull();
  });

  it("only ever answers with a fact from the committed pack", () => {
    const pack = JSON.parse(
      readFileSync(join(process.cwd(), "public", "data", "heritage_listings.json"), "utf8"),
    ) as { listings: Record<string, PubQuizListing> };
    const listings = Object.values(pack.listings);
    for (let seed = 0; seed < 200; seed += 1) {
      let state = seed + 1;
      const random = () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
      };
      const quiz = pickPubQuizQuestion(listings, random)!;
      const source = listings.find((listing) => listing.url === quiz.sourceUrl)!;
      expect(source).toBeDefined();
      expect(quiz.options).toContain(quiz.answer);
      expect([`Grade ${source.grade}`, String(source.listedYear)]).toContain(quiz.answer);
    }
  });
});
