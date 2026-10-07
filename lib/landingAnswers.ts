// What the front door prints under the picture: what today is, and what is on
// tonight, one sentence each.
//
// Captain 7 Sep 2026: "Let's say: What is happening today? What is happening
// tonight?" The SHAPING of both sentences lives here, in a pure leaf, so it can
// be tested without a weather store or a listings provider, and so the client
// landing component can take the result as props without pulling a
// `server-only` module into its own graph. lib/landingAnswers.server.ts does
// the reading and hands the figures in.
//
// Tonight's empty line is the SAME sentence /tonight prints over an empty
// listings night (`TONIGHT_QUIET_NIGHT_SENTENCE`). The card also counts the
// hyped-pubs pack /tonight leads with, so a home door that says nothing is on
// cannot sit above a /tonight page full of pubs people are talking about.

import { TONIGHT_QUIET_NIGHT_SENTENCE } from "@/lib/tonightOutListings";

export type LandingAnswer = {
  /** The one sentence the card prints. */
  line: string;
  /** The London day the sentence speaks for, such as "Saturday 19 July". */
  stamp: string;
  /** False when the lane could not be read, so the card prints no count. */
  measured: boolean;
};

export type LandingAnswers = {
  today: LandingAnswer;
  tonight: LandingAnswer;
};

/** What the weather read gave us, reduced to what the card uses. */
export type TodayWeatherFacts = {
  /** Numbers-led facts from the cached observation, with no time-bound label. */
  factsLine: string;
  /** True once the reading has aged past its own expiry, or will while the copy is held. */
  stale: boolean;
  /** "Checked 2 hours ago" (fresh) or "Last checked 3 days ago" (stale). */
  checkedLabel: string;
};

/**
 * Today's sentence. A missing reading says so. A fresh one prints its facts; a
 * stale one prints them as the last read of the sky (factsLine carries that
 * prefix), never as this morning's. Neither carries a drink verdict or a
 * relative age, because the copy is held for an hour (see landingAnswers.server).
 */
export function todayAnswer(weather: TodayWeatherFacts | null, stamp: string): LandingAnswer {
  if (!weather) {
    return { line: "We couldn't read today's London weather just now.", stamp, measured: false };
  }
  return { line: weather.factsLine, stamp, measured: !weather.stale };
}

/** What the listing lanes gave us, reduced to what the card can say. */
export type TonightListingFacts = {
  /** True when neither the What's-On lane nor the Out lane could be read. */
  unread: boolean;
  /** How many listings the merged lanes hold for tonight. */
  count: number;
  /**
   * How many hyped pubs /tonight will print. Same pack, same page limit, so the
   * card and the route cannot disagree about whether anything is on.
   */
  hypedCount?: number;
};

/**
 * Tonight's sentence. A city with nothing listed and a city we could not read
 * are different answers, so they get different words and only one of them
 * counts as measured. Hyped pubs count when listings are empty, because that
 * is what /tonight leads with on a quiet listings night.
 */
export function tonightAnswer(listings: TonightListingFacts, stamp: string): LandingAnswer {
  if (listings.unread) {
    return { line: "We couldn't reach tonight's listings just now.", stamp, measured: false };
  }
  if (listings.count >= 1) {
    const things = listings.count === 1 ? "1 thing" : `${listings.count} things`;
    return { line: `${things} on across London tonight.`, stamp, measured: true };
  }
  const hyped = listings.hypedCount ?? 0;
  if (hyped >= 1) {
    const pubs =
      hyped === 1
        ? "1 pub people are talking about"
        : `${hyped} pubs people are talking about`;
    return { line: `${pubs} tonight.`, stamp, measured: true };
  }
  return { line: TONIGHT_QUIET_NIGHT_SENTENCE, stamp, measured: true };
}
