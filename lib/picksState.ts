import type { Route } from "next";

// WHAT A PICK SECTION IS, IN FOUR WORDS, AND NOWHERE ELSE.
//
// F04 of the 5 Sep 2026 live audit: /today's tonight-recommendations section
// rendered empty with a map link under it. Two separate things were wrong.
// The state vocabulary was too coarse to tell "the city is quiet" from "we
// could not look", and the honest half of that pair still handed a new reader
// one door out of a section that had just told them nothing.
//
// This module is the one state vocabulary both /today and /tonight read, and
// the one place the words for each state live. It is a PURE LEAF: it imports
// nothing, so a browser bundle that needs to know what a picks section is
// never pulls the listing spine in behind it.
//
// FOUR STATES, and a surface may branch on nothing else:
//
//   ready                    rows to paint, and the read behind them answered.
//   refreshing               a read is in flight. The last good rows stay on
//                            screen with the day they were checked; with none
//                            held, the surface paints a skeleton and says
//                            nothing, because a sentence about waiting is read
//                            as a claim about the city.
//   genuinely_empty          every lane answered and there is nothing on.
//   temporarily_unavailable  a lane did not answer. NEVER worded as a quiet
//                            city, because we did not look.
//
// The reason and the checked-at instant ride WITH the state, so no surface has
// to re-derive either, and the two can never disagree between /today and
// /tonight. `reason` is a lane's own already-worded line, never a code, and
// `checkedAt` is the evidence stamp for the rows on screen, null when the
// evidence cannot be dated.
//
// THE ALTERNATIVE IS THE OTHER HALF OF THE FIX. A section with nothing in it
// is not a dead end: it offers two doors that are honestly NOT events, and
// both carry the context the reader already chose. See `picksAlternativeWays`.

/** The four things a picks section may be. There is no fifth. */
export type PicksStateKind =
  | "ready"
  | "refreshing"
  | "genuinely_empty"
  | "temporarily_unavailable";

export type PicksState = {
  kind: PicksStateKind;
  /** A lane's own line for why it could not carry its share, else null. */
  reason: string | null;
  /** ISO instant the evidence behind the visible rows was checked, else null. */
  checkedAt: string | null;
  /** Whether asking again could change the answer. A lane nobody asked cannot. */
  retryable: boolean;
};

export type PicksReadInput = {
  /** Rows the section can paint right now, held ones included. */
  visibleCount: number;
  /** A read is in flight: first load, or a retry over rows already held. */
  inFlight: boolean;
  /**
   * A FINISHED read did not answer FOR US.
   *
   * Two different things, one state. A lane that FAILED (threw, degraded, or
   * could not confirm its venues) did not answer; a lane NOBODY ASKED did not
   * answer either, and the difference between them is about us rather than
   * about the city. Battle test M07: on a preview with no listings keys /today
   * printed "Nothing on tonight's list yet." while /api/out said
   * `not-configured`, which is a claim that London is quiet made on a question
   * we never put. Both are `temporarily_unavailable`; `reason` carries the
   * lane's own words and `retryable` says which of the two it was.
   */
  unreadable: boolean;
  /** The lane note, already worded by the lane that could not answer. */
  reason?: string | null;
  /** The evidence stamp for the visible rows. */
  checkedAt?: string | null;
  /** False for a lane nobody switched on: asking it again changes nothing. */
  retryable?: boolean;
};

/**
 * The one decision. Order is the whole rule.
 *
 * A read in flight is `refreshing` whatever else is true, because the answer
 * on screen is about to be replaced and calling it ready or empty dates it to
 * a read that has not landed. Rows then mean `ready`. Only with no rows does
 * the pair of honest absences separate, and they separate on whether a read
 * ANSWERED: a read we could not run is never an empty night.
 */
export function picksState(input: PicksReadInput): PicksState {
  const reason = input.reason ?? null;
  const checkedAt = input.checkedAt ?? null;
  const retryable = input.retryable ?? true;
  if (input.inFlight) return { kind: "refreshing", reason, checkedAt, retryable };
  if (input.visibleCount > 0) return { kind: "ready", reason, checkedAt, retryable };
  if (input.unreadable) {
    return { kind: "temporarily_unavailable", reason, checkedAt, retryable };
  }
  return { kind: "genuinely_empty", reason: null, checkedAt, retryable: false };
}

/** True while the state is holding rows the reader may still act on. */
export function picksStateShowsRows(state: PicksState, visibleCount: number): boolean {
  if (visibleCount <= 0) return false;
  return state.kind === "ready" || state.kind === "refreshing";
}

/**
 * True when the section owes the reader a way onward that is not an event.
 *
 * Both honest absences do. A refresh does not, because the rows it is holding
 * are still on screen and a first load has nothing to say yet.
 */
export function picksStateOffersAlternative(state: PicksState): boolean {
  return state.kind === "genuinely_empty" || state.kind === "temporarily_unavailable";
}

/**
 * Only a lane we could not read may be asked again, and only when asking could
 * change the answer. A lane nobody switched on is told, never offered a button
 * that would re-ask the same unasked question.
 */
export function picksStateOffersRetry(state: PicksState): boolean {
  return state.kind === "temporarily_unavailable" && state.retryable;
}

// ── Words ────────────────────────────────────────────────────────────────

/**
 * The line over a section we could not read.
 *
 * It says what happened to US. It may never be swapped for the quiet-night
 * sentence, and the quiet-night sentence may never be printed beside it.
 */
export const PICKS_UNAVAILABLE_LINE = "We could not reach tonight's listings just now.";

/** Named on the control that asks the lane again. */
export const PICKS_RETRY_LABEL = "Retry listings";

/**
 * What a held answer says while the next read runs.
 *
 * The rows stay put and keep their own date, so this names the re-read and
 * nothing more. It is never printed over a first load, which holds no rows to
 * date and gets a skeleton.
 */
export const PICKS_REFRESHING_LINE = "Checking again.";

/**
 * The eyebrow over the two doors an empty section offers.
 *
 * It has to say in the label itself that what follows is not a listing, or a
 * reader meets two links under "nothing on tonight" and reads them as events
 * we found after all.
 */
export const PICKS_ALTERNATIVE_LABEL = "No event needed";

type PicksAlternativeKey = "pubs-near" | "plan";

export type PicksAlternativeWay = {
  key: PicksAlternativeKey;
  label: string;
  href: Route;
};

/**
 * The context a fallback link must not drop.
 *
 * A reader who chose an area and an occasion chose them for the night they are
 * planning, and a door out of an empty section is still that night. Both are
 * optional, and an absent one simply leaves its parameter off rather than
 * inventing a default: `/near` and `/plan` both answer without one.
 */
export type PicksContext = {
  /** A resolved night-patch id, already validated by the caller. */
  patchId?: string | null;
  /** A closed plan occasion id, already validated by the caller. */
  occasion?: string | null;
};

function withParam(path: "/near" | "/plan", key: string, value: string | null | undefined): Route {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return path;
  return `${path}?${new URLSearchParams({ [key]: trimmed }).toString()}`;
}

/**
 * The two non-event doors, in order, carrying the reader's own context.
 *
 * Pubs near you first: it is the nearer answer and the one a reader standing
 * in a patch with nothing on actually wants. The plan door is second because
 * it asks more of them. Neither is a listing and the label above them says so.
 *
 * A DOOR MAY PROMISE ONLY WHAT THE SURFACE BEHIND IT ANSWERS.
 *
 * Astra F02 (6 Sep 2026): this door read "Quiet pints near you" and opened
 * /near, which ranks the nearest pubs by listed price, cheapest first. It has
 * no crowd signal at all. The word was not a small imprecision: the only quiet
 * reading this product holds is `estimateBusyness`, and its typical-pattern
 * half is a function of the HOUR alone, identical for every pub in London, so
 * a per-venue quiet list cannot be built from it honestly. A community
 * occupancy report (lib/occupancy.ts) is per venue and real, but a venue
 * nobody has reported has an UNKNOWN crowd state, and unknown is never quiet.
 * So the door names what /near does. The quiet answer this product CAN make
 * still exists and is unmoved: lib/quietPint.ts, which only appears in a
 * genuinely quiet window and prints its own "usual pattern for the hour, not
 * the door" caveat, on the same two screens this door renders on.
 */
export function picksAlternativeWays(context: PicksContext = {}): PicksAlternativeWay[] {
  return [
    {
      key: "pubs-near",
      label: "Pubs near you",
      href: withParam("/near", "patch", context.patchId),
    },
    {
      key: "plan",
      label: "Plan the night instead",
      href: withParam("/plan", "occasion", context.occasion),
    },
  ];
}

/**
 * "Checked 3 Sep", or null when the evidence carries no date we can print.
 *
 * Deliberately the same shape `checkedLabel` prints beside a listing, so a
 * held answer and the cards inside it are dated in one vocabulary. Written
 * here rather than imported, because this module stays a leaf.
 */
export function picksCheckedLabel(checkedAt: string | null): string | null {
  if (!checkedAt) return null;
  const ms = Date.parse(checkedAt);
  if (!Number.isFinite(ms)) return null;
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "numeric",
      month: "short",
    }).format(new Date(ms));
    return `Checked ${formatted.replace(/,/g, "")}`;
  } catch {
    return null;
  }
}
