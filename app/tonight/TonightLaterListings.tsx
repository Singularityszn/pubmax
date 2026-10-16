"use client";

// Tomorrow and the weekend, on /tonight.
//
// The old /out page carried a Tonight | Tomorrow | Weekend switch over the same
// sourced listings (GET /api/out). When /out became a redirect to /tonight
// (product owner, 16 Oct 2026) Tonight already held tonight's rows, so this
// section carries the other two windows and nothing else.
//
// THREE RULES.
//   1. NOTHING IS ASKED UNTIL A DAY IS CHOSEN. /tonight is prerendered and its
//      first answer is tonight; a reader who never taps Tomorrow pays no
//      request for it.
//   2. A LISTING WE HOLD IS A LISTING WE SHOW. Every sourced row renders, the
//      pub answer is a footnote on the row, and the rows at a pub of ours lead
//      (outListingLead). That is the law /out was fenced to, kept here.
//   3. A READ THAT IS RUNNING, EMPTY OR FAILED IS ONE LINE, never a skeleton
//      left standing and never a block of reserved space.
//   4. AN OLD LINK KEEPS ITS DAY. proxy.ts sends /out?day=weekend to
//      /tonight?day=weekend with the query kept, so a day named in the URL is a
//      day already chosen. It is read after mount because the page is
//      prerendered; ?day=tonight is the page itself and picks nothing.

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";

import { OutCardBody } from "@/components/out/OutCard";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import { useOutListings } from "@/components/out/useOutListings";
import { trackEvent } from "@/lib/analytics";
import { outCardSource } from "@/lib/out/attribution";
import { OUT_NOT_ON_MAP_HEADING, outListingLead } from "@/lib/out/listingRoute";
import { OUT_RETRY_LABEL, outEmptyLane, outStatusLines } from "@/lib/out/outStatus";
import { groupOutListings, outVenueMatchNotice } from "@/lib/outDesktopGrouping";
import { parseOutDayWindow, type OutDayWindow } from "@/lib/outListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

import "./tonightLater.css";

/** The windows this section offers. Tonight is the page itself. */
const TONIGHT_LATER_WINDOWS = ["tomorrow", "weekend"] as const;
type TonightLaterWindow = (typeof TONIGHT_LATER_WINDOWS)[number];

function isTonightLaterWindow(value: OutDayWindow): value is TonightLaterWindow {
  return (TONIGHT_LATER_WINDOWS as readonly string[]).includes(value);
}

/** The later window an old /out link named, read from the URL once in the browser. */
function linkedDay(): TonightLaterWindow | null {
  const named = parseOutDayWindow(new URLSearchParams(window.location.search).get("day"));
  return isTonightLaterWindow(named) ? named : null;
}

/** The prerendered page names no day. */
function noLinkedDay(): null {
  return null;
}

/** The URL's day is read once; a tap, not a navigation, moves it after that. */
function subscribeToNothing(): () => void {
  return () => {};
}

const DAY_LABEL: Record<TonightLaterWindow, string> = {
  tomorrow: "Tomorrow",
  weekend: "Weekend",
};

/** The section heading. It names both windows, so a chip need not repeat it. */
const TONIGHT_LATER_TITLE = "Tomorrow and the weekend";

/** What the section says while its one read runs. */
export const TONIGHT_LATER_PENDING_LINE = "Checking the listings…";

export default function TonightLaterListings() {
  const [chosen, setDay] = useState<TonightLaterWindow | null>(null);
  const linked = useSyncExternalStore(subscribeToNothing, linkedDay, noLinkedDay);
  const day = chosen ?? linked;
  return (
    <section
      className="tonightLater"
      aria-labelledby="tonight-later-heading"
      data-testid="tonight-later"
    >
      <h2 id="tonight-later-heading" className="outSectionTitle">
        {TONIGHT_LATER_TITLE}
      </h2>
      <div className="outDayChips" role="group" aria-label="When">
        {TONIGHT_LATER_WINDOWS.map((windowKey) => (
          <button
            key={windowKey}
            type="button"
            className="outDayChip"
            aria-pressed={day === windowKey}
            onClick={() => {
              setDay(windowKey);
              trackEvent("out_filter_select", { kind: windowKey });
            }}
          >
            {DAY_LABEL[windowKey]}
          </button>
        ))}
      </div>
      {day ? <OutListingsRead key={day} day={day} /> : null}
    </section>
  );
}

function OutListingCount({
  count,
  lead,
}: {
  count: number;
  lead: ReturnType<typeof outListingLead>;
}) {
  if (count === 0) return null;
  const matchedCount = lead.split ? lead.matched.length : null;
  return (
    <p className="outStatus" data-testid="out-listing-count">
      {count} {count === 1 ? "listing" : "listings"} shown.
      {matchedCount !== null ? (
        <> {matchedCount} linked to {matchedCount === 1 ? "a venue" : "venues"} on our map.</>
      ) : null}
    </p>
  );
}

/**
 * One window's sourced listings: the read, its count, the rows (ours first),
 * then the two footnotes under them. Exported so the listing law can be
 * fenced on any window, tonight included.
 */
export function OutListingsRead({ day }: { day: OutDayWindow }) {
  const { body, failed, pending, retry } = useOutListings(day);
  const onOpen = useCallback((row: WhatsOnRow) => {
    trackEvent("out_card_opened", { source: outCardSource(row.source.label) });
  }, []);

  if (pending) {
    return (
      <p className="outStatus" role="status" data-testid="out-listings-pending">
        {TONIGHT_LATER_PENDING_LINE}
      </p>
    );
  }

  const listingRows = body?.events ?? [];
  // Listings at a pub of ours lead; the rest follow under their own heading. On
  // a night the match placed none, the honest line leads instead of a listing.
  const lead = outListingLead(listingRows, body?.venueMatch, day);
  // Credit is owed for every row on screen, matched or not, so it is read off
  // the answer's own attribution rather than off the rows we could not place.
  const credits = body?.attribution ?? [];
  const venueMatchNotice = outVenueMatchNotice(listingRows, day, body?.venueMatch, {
    unmatchedCount: body?.unmatchedCount,
    unmatchedPlaces: body?.unmatchedPlaces,
    unmatchedPlaceCount: body?.unmatchedPlaceCount,
    unmatchedSources: body?.unmatchedSources,
  });
  // An empty or unreadable window is one line, with a retry only when the
  // read failed. The page's own map link is the way onward otherwise.
  const emptyLane = outEmptyLane({ body, failed, pending });

  if (emptyLane) {
    return (
      <p
        className="outStatus"
        data-testid="out-empty-lane"
        data-out-state={emptyLane.way === "retry" ? "error" : "empty"}
        role={emptyLane.way === "retry" ? "alert" : "status"}
      >
        {emptyLane.lines.join(" ")}
        {emptyLane.way === "retry" ? (
          <>
            {" "}
            <button type="button" className="tonightInlineReset" onClick={retry}>
              {OUT_RETRY_LABEL}
            </button>
          </>
        ) : null}
      </p>
    );
  }

  // One window under a heading that already names it needs no group headings.
  // A weekend covers several nights, so each gets its own.
  function listingGroups(
    rows: readonly WhatsOnRow[],
    idPrefix: string,
    GroupTitle: "h3" | "h4",
  ) {
    const groups = groupOutListings(rows);
    const showGroupTitles = groups.length > 1;
    const rowTitleLevel = showGroupTitles && GroupTitle === "h4" ? 5 : 4;
    return groups.map((group) => (
      <section
        key={`${idPrefix}${group.key}`}
        className="outGroup"
        {...(showGroupTitles
          ? { "aria-labelledby": `${idPrefix}${group.key}` }
          : { "aria-label": group.label })}
      >
        {showGroupTitles ? (
          <GroupTitle id={`${idPrefix}${group.key}`} className="outGroupTitle">
            {group.label}
          </GroupTitle>
        ) : null}
        <ul className="outGroupList">
          {group.rows.map((row) => (
            <li key={row.id} className="outListingRow" data-testid="out-listing-row">
              <div className="outListingGig">
                <OutCardBody row={row} onOpen={() => onOpen(row)} titleLevel={rowTitleLevel} />
              </div>
              <OutListingPubPair row={row} />
            </li>
          ))}
        </ul>
      </section>
    ));
  }

  return (
    <div className="outListings" data-day={day}>
      <OutListingCount count={listingRows.length} lead={lead} />
      {outStatusLines({ body, failed }).map((line) => (
        <p className="outStatus" key={line}>
          {line}
        </p>
      ))}
      <div className="outListingSurface" data-testid="out-listing-surface">
        {lead.honestEmpty ? (
          <p className="outStatus" data-testid="out-honest-empty">
            {lead.honestEmpty.line}
            {lead.honestEmpty.way ? (
              <>
                {" "}
                <Link prefetch={false} href={lead.honestEmpty.way.href}>
                  {lead.honestEmpty.way.label}
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        {lead.split ? (
          <>
            {listingGroups(lead.matched, `out-${day}-group-`, "h3")}
            {lead.unmatched.length > 0 ? (
              <section
                className="outUnmatchedBlock"
                aria-labelledby={`out-${day}-unmatched-heading`}
              >
                <h3 id={`out-${day}-unmatched-heading`} className="outUnmatchedTitle">
                  {OUT_NOT_ON_MAP_HEADING}
                </h3>
                {listingGroups(lead.unmatched, `out-${day}-group-unmatched-`, "h4")}
              </section>
            ) : null}
          </>
        ) : (
          listingGroups(lead.unmatched, `out-${day}-group-`, "h3")
        )}
      </div>
      {/* Two footnotes under the list, in this order, and never above it.
          The FIRST is the one finding a row cannot state for itself: the venue
          match never ran. The SECOND is the credit owed to whoever published
          these listings. */}
      {venueMatchNotice ? (
        <p
          className="outStatus outListingUnmatchedLine"
          role="status"
          data-testid="out-venue-match-notice"
        >
          {venueMatchNotice.line} {venueMatchNotice.places}
        </p>
      ) : null}
      {credits.length > 0 ? (
        <p className="outListingUnmatchedCredit" data-testid="out-listing-credit">
          Listings from{" "}
          {credits.map((credit, index) => (
            <span key={credit.label}>
              {index > 0 ? " and " : ""}
              <a href={credit.url} rel="noopener noreferrer" target="_blank">
                {credit.label}
              </a>
            </span>
          ))}
          .
        </p>
      ) : null}
    </div>
  );
}
