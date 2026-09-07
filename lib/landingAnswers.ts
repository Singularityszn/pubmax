// What the front door prints under the picture: what today is, and what is on
// tonight, one sentence each.
//
// Captain 7 Sep 2026: "Let's say: What is happening today? What is happening
// tonight?" The SHAPING of both sentences lives here, in a pure leaf, so it can
// be tested without a weather store or a listings provider, and so the client
// landing component can take the result as props without pulling a
// `server-only` module into its own graph. lib/landingAnswers.server.ts does
// the reading and hands the figures in.

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

/** What the weather read gave us, reduced to the three words the card uses. */
export type TodayWeatherFacts = {
  /** "19C", the feels-like figure the brief rounded. */
  tempLabel: string;
  /** "cloudy". */
  conditionLabel: string;
  /** "Beer garden weather. Lager or cider." */
  verdictLine: string;
  /** True once the reading has aged past its own expiry. */
  stale: boolean;
};

/**
 * Today's sentence. A reading that is missing or has gone stale is a fact about
 * us rather than about the weather, so the card says that instead of printing
 * an old sky as this morning's.
 */
export function todayAnswer(weather: TodayWeatherFacts | null, stamp: string): LandingAnswer {
  if (!weather || weather.stale) {
    return { line: "We could not read today's London weather just now.", stamp, measured: false };
  }
  return {
    line: `${weather.tempLabel} and ${weather.conditionLabel} in London. ${weather.verdictLine}`,
    stamp,
    measured: true,
  };
}

/** What the listing lanes gave us, reduced to what the card can say. */
export type TonightListingFacts = {
  /** True when neither the What's-On lane nor the Out lane could be read. */
  unread: boolean;
  /** How many listings the merged lanes hold for tonight. */
  count: number;
};

/**
 * Tonight's sentence. A city with nothing listed and a city we could not read
 * are different answers, so they get different words and only one of them
 * counts as measured.
 */
export function tonightAnswer(listings: TonightListingFacts, stamp: string): LandingAnswer {
  if (listings.unread) {
    return { line: "We could not reach tonight's listings just now.", stamp, measured: false };
  }
  if (listings.count < 1) {
    return { line: "Nothing is listed across London tonight yet.", stamp, measured: true };
  }
  const things = listings.count === 1 ? "1 thing" : `${listings.count} things`;
  return { line: `${things} on across London tonight.`, stamp, measured: true };
}
