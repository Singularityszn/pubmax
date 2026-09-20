// Whether an account's profile is a PUBLIC card or a PRIVATE one.
//
// Privacy in this product has always been per-surface and per-capability: a
// Plan is read through a member capability, a Crew through membership, a
// conversation through participation. None of those is a choice a drinker can
// see or make. This module is the visible account choice the privacy wave
// names, and it is a CLOSED VOCABULARY rather than a boolean, for the reason
// every other closed vocabulary here is one: a boolean has no room for the day
// a third answer arrives, and a column full of `true` says nothing about what
// it was true of.
//
// It is a PURE LEAF and imports nothing, so a browser bundle that needs the
// word "Private" pulls no store and no follow graph in behind it. The
// projection over a profile row lives in `lib/profileVisibility.ts` and the
// server seam that decides which projection a reader gets is
// `lib/profileVisibilityBoundary.server.ts`.

export const ACCOUNT_VISIBILITIES = ["public", "private"] as const;

export type AccountVisibility = (typeof ACCOUNT_VISIBILITIES)[number];

/**
 * What an account is when nobody has chosen. Public, because every account that
 * exists today was made under a public promise and a migration may not change
 * what a person already agreed to. New accounts land here too: the choice is
 * offered on the profile, never asked for at the door.
 */
export const DEFAULT_ACCOUNT_VISIBILITY: AccountVisibility = "public";

export function isAccountVisibility(value: unknown): value is AccountVisibility {
  return ACCOUNT_VISIBILITIES.includes(value as AccountVisibility);
}

/**
 * Read a stored or submitted visibility. THREE answers, and the third is the
 * one worth writing down.
 *
 * An ABSENT value is the default. Absent covers undefined, null and a blank
 * string, which is exactly the shape a row takes before migration 0154 is
 * applied: nobody could have chosen private yet, so reading those rows as
 * public states a fact rather than guessing one.
 *
 * A value we do not RECOGNISE fails closed to private. It cannot arrive from
 * this app (the column carries a CHECK and the write door asks
 * {@link isAccountVisibility} first), so it means a value written by something
 * that is not this code, and a word we cannot read is not a licence to publish
 * somebody's bio. The two cases are deliberately different: the first is a
 * question nobody was asked, the second is an answer nobody can read.
 */
export function parseAccountVisibility(value: unknown): AccountVisibility {
  if (value === undefined || value === null) return DEFAULT_ACCOUNT_VISIBILITY;
  if (typeof value === "string" && value.trim() === "") return DEFAULT_ACCOUNT_VISIBILITY;
  if (isAccountVisibility(value)) return value;
  return "private";
}

/** The one question every reader asks. */
export function accountIsPrivate(value: unknown): boolean {
  return parseAccountVisibility(value) === "private";
}

/**
 * Every sentence a visibility surface may print, written down once.
 *
 * The two explainers are held to one bar by `__tests__/accountVisibility.test.ts`:
 * each NAMES what it covers rather than claiming privacy in the abstract, and
 * neither may imply the choice reaches a price. A price a drinker logged is
 * evidence about a pub, it carries their handle on the map by design, and the
 * standing law is that we keep the prices, so a setting that quietly implied
 * otherwise would be the loudest thing in this file.
 */
export const ACCOUNT_VISIBILITY_COPY = {
  /** The setting's own heading on the profile. */
  legend: "Who can see your profile",
  label: {
    public: "Public",
    private: "Private",
  },
  /** What each choice really does, in the order the control offers them. */
  explainer: {
    public:
      "Anyone can read your profile: your bio, your city, your favourite drink, what you are into and where you work.",
    private:
      "Only your mates read those. Your handle, your name and your face stay visible, so friends can still find you and add you.",
  },
  /**
   * The one thing the choice does NOT cover, said out loud beside it. A person
   * choosing private is owed the boundary, not a discovery later.
   */
  pricesStay:
    "Prices you log stay on the map under your handle either way. This choice is about your profile, never about the evidence behind a price.",
  /** The heading a reader who is not a mate meets on a private card. */
  strangerTitle: "This account is private.",
  /** What that reader may do about it. */
  strangerBody:
    "Add them, and once they add you back you read the rest of their profile.",
  /** The receipt after a save. */
  saved: {
    public: "Your profile is public.",
    private: "Your profile is private. Only your mates read the rest of it.",
  },
} as const;

/** The heading and body a limited card prints, as one pair. */
export function accountPrivateNotice(): { title: string; body: string } {
  return {
    title: ACCOUNT_VISIBILITY_COPY.strangerTitle,
    body: ACCOUNT_VISIBILITY_COPY.strangerBody,
  };
}
