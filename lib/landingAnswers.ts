// The homepage answers keep events, recommendations and recurring deals separate.
//
// Captain 7 Sep 2026: "Let's say: What is happening today? What is happening
// tonight?" The copy lives here, in a pure leaf, so it can
// be tested without a weather store or a listings provider, and so the client
// landing component can take the result as props without pulling a
// `server-only` module into its own graph. lib/landingAnswers.server.ts does
// the reading and hands the figures in.

export type LandingAnswer = {
  /** The answer the card prints. */
  line: string;
  /** The London day the answer speaks for, such as "Saturday 19 July". */
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
  /** How many dated pub events the merged lanes hold for tonight. */
  count: number;
  /** How many of those dated events are quizzes. */
  quizCount?: number;
  hasDeals?: boolean;
  /**
   * The same recommendation pack and page limit as /tonight. These pubs are
   * recommendations, so this count never enters the dated event total.
   */
  hypedCount?: number;
};

/**
 * An empty event read differs from a failed read. Recommendations and recurring
 * deals remain separate claims, so neither can inflate the dated event count.
 */
export function tonightAnswer(listings: TonightListingFacts, stamp: string): LandingAnswer {
  if (listings.unread) {
    return { line: "We couldn't reach tonight's listings just now.", stamp, measured: false };
  }
  const dealNote = listings.hasDeals ? " See recurring deals." : "";
  if (listings.count >= 1) {
    const [one, many] = listings.quizCount === listings.count
      ? ["pub quiz", "pub quizzes"]
      : ["pub event", "pub events"];
    const events = listings.count === 1 ? `1 ${one}` : `${listings.count} ${many}`;
    return { line: `${events} listed in London tonight.${dealNote}`, stamp, measured: true };
  }
  const hyped = listings.hypedCount ?? 0;
  const pubs = hyped === 1
    ? "A pub Londoners keep recommending. "
    : hyped > 1 ? `${hyped} pubs Londoners keep recommending. ` : "";
  return {
    line: `${pubs}No pub events listed for tonight.${dealNote}`,
    stamp,
    measured: true,
  };
}
