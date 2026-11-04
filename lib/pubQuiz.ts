// One pub quiz question for a loading screen, drawn from the listed-building
// pack (public/data/heritage_listings.json, Historic England's register).
//
// Every question and every answer is a field of one real listing: its grade or
// the year it went on the list. Nothing is invented, so the quiz cannot make up
// pub lore (root AGENTS.md anti-goals). The wrong options are just other
// choices, never claims about the pub. A pure leaf: the caller hands in the
// listings and a random source, so a test can pin every pick.

export type PubQuizListing = {
  grade: string;
  listedYear: number | null;
  name: string;
  url: string;
};

export type PubQuizQuestion = {
  question: string;
  options: readonly string[];
  answer: string;
  /** One more true line about the same listing, shown with the answer. */
  detail: string | null;
  /** The Historic England list entry the answer comes from. */
  sourceUrl: string;
};

export const PUB_QUIZ_GRADES = ["Grade I", "Grade II*", "Grade II"] as const;

const HISTORIC_ENGLAND_ENTRY =
  /^https:\/\/historicengland\.org\.uk\/listing\/the-list\/list-entry\/\d+$/;

function usable(listing: PubQuizListing): boolean {
  return (
    PUB_QUIZ_GRADES.includes(`Grade ${listing.grade}` as (typeof PUB_QUIZ_GRADES)[number]) &&
    listing.name.trim().length > 0 &&
    HISTORIC_ENGLAND_ENTRY.test(listing.url)
  );
}

function pick<T>(items: readonly T[], random: () => number): T | undefined {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function yearLine(listing: PubQuizListing): string | null {
  return listing.listedYear ? `It went on the list in ${listing.listedYear}.` : null;
}

/**
 * A question, or null when the pack holds nothing usable. Grade II covers
 * almost every listed pub, so half the picks come from the rarer Grade I and
 * II* listings, or the right answer would nearly always be the same one.
 */
export function pickPubQuizQuestion(
  listings: readonly PubQuizListing[],
  random: () => number = Math.random,
): PubQuizQuestion | null {
  const pool = listings.filter(usable);
  if (pool.length === 0) return null;
  const rare = pool.filter((listing) => listing.grade !== "II");
  const listing = pick(rare.length > 0 && random() < 0.5 ? rare : pool, random);
  if (!listing) return null;
  const name = listing.name.trim();

  const years = [...new Set(pool.map((entry) => entry.listedYear).filter(
    (year): year is number => typeof year === "number" && year !== listing.listedYear,
  ))];
  if (listing.listedYear && years.length >= 2 && random() < 0.5) {
    const first = pick(years, random)!;
    const second = pick(years.filter((year) => year !== first), random)!;
    const options = [listing.listedYear, first, second].sort((a, b) => a - b).map(String);
    return {
      question: `When did ${name} go on the heritage list?`,
      options,
      answer: String(listing.listedYear),
      detail: `It is listed Grade ${listing.grade}.`,
      sourceUrl: listing.url,
    };
  }

  return {
    question: `What grade is ${name} listed?`,
    options: PUB_QUIZ_GRADES,
    answer: `Grade ${listing.grade}`,
    detail: yearLine(listing),
    sourceUrl: listing.url,
  };
}
