"use client";

// Everything the Tonight list says ABOUT its own read, lifted out of
// TonightClient whole: the wait, the failed read, the lane that answered short
// beside the cards, and the quiet night.
//
// It branches on ONE state (lib/picksState.ts) and nothing else, the same four
// words /today's picks card reads, so the two surfaces cannot describe one
// night two ways:
//
//   refreshing               skeleton on a first load; over held rows, one
//                            quiet line naming the re-read and the day those
//                            rows were checked. A wait is never a sentence
//                            about the city.
//   ready                    cards, plus the short-lane note when one applies.
//   genuinely_empty          the quiet-night sentence, its map exit, and the
//                            two non-event doors.
//   temporarily_unavailable  what happened to US, a retry, and the SAME two
//                            doors. Never the quiet-night sentence: we did not
//                            look, so we cannot say the city is quiet.
//
// Presentation only. Which state this is, why, and when the held rows were
// checked are all decided before they get here.

import Link from "next/link";
import { RefreshCw } from "lucide-react";

import ListingsSkeleton from "@/components/out/ListingsSkeleton";
import PicksAlternatives from "@/components/picks/PicksAlternatives";
import {
  PICKS_REFRESHING_LINE,
  PICKS_RETRY_LABEL,
  PICKS_UNAVAILABLE_LINE,
  picksCheckedLabel,
  picksStateOffersAlternative,
  picksStateOffersRetry,
  type PicksContext,
  type PicksState,
} from "@/lib/picksState";

export default function TonightListingsNotice({
  state,
  note,
  noteOffersRetry,
  emptyLead,
  heldRowCount,
  context,
  onRetry,
}: {
  state: PicksState;
  /** Names a lane that could not answer, or null when both were fine. */
  note: string | null;
  noteOffersRetry: boolean;
  /** The sentence a night with no rows gets, already scoped to the lanes that answered. */
  emptyLead: string;
  /** Rows already on screen. A refresh over these keeps them and dates them. */
  heldRowCount: number;
  /** The area and occasion the reader chose, carried into both fallback doors. */
  context?: PicksContext;
  onRetry: () => void;
}) {
  const refreshing = state.kind === "refreshing";
  const unavailable = state.kind === "temporarily_unavailable";
  const empty = state.kind === "genuinely_empty";
  // A first load holds nothing to date, so it gets the skeleton and says
  // nothing. A re-read over real rows leaves them where they are.
  const firstLoad = refreshing && heldRowCount === 0;
  const checked = refreshing ? picksCheckedLabel(state.checkedAt) : null;

  return (
    <>
      {firstLoad ? <ListingsSkeleton /> : null}

      {refreshing && !firstLoad ? (
        <p
          className="tonightStatus tonightStatusNote"
          role="status"
          data-tonight-listings-note="refreshing"
        >
          {PICKS_REFRESHING_LINE}
          {checked ? ` ${checked}.` : ""}
        </p>
      ) : null}

      {unavailable ? (
        <div className="tonightStatus tonightStatusError">
          <p role="status">{state.reason ?? PICKS_UNAVAILABLE_LINE}</p>
          {picksStateOffersRetry(state) ? (
            <button type="button" className="tonightRetry" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              {PICKS_RETRY_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}

      {!unavailable && !refreshing && note ? (
        <div
          className="tonightStatus tonightStatusNote"
          data-tonight-listings-note="partial"
        >
          <p role="status">{note}</p>
          {noteOffersRetry ? (
            <button type="button" className="tonightRetry" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              {PICKS_RETRY_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}

      {empty ? (
        <p className="tonightStatus" role="status">
          {emptyLead}{" "}
          <Link href="/map" className="tonightStatusLink">
            The map still knows where the cheap pints are
          </Link>
          .
        </p>
      ) : null}

      {picksStateOffersAlternative(state) ? (
        <PicksAlternatives context={context} className="tonightAlternatives" />
      ) : null}
    </>
  );
}
