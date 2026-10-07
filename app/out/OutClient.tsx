"use client";

import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { OutCardBody } from "@/components/out/OutCard";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import { OutOpenPlanCard } from "@/components/out/OutOpenPlanCard";
import ListingsSkeleton from "@/components/out/ListingsSkeleton";
import EditorialRail from "@/components/out/EditorialRail";
import { useOutListings } from "@/components/out/useOutListings";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import { trackEvent } from "@/lib/analytics";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { readPreferredCity, subscribePreferredCity } from "@/lib/cityPreference";
import { outCardSource } from "@/lib/out/attribution";
import {
  groupOutListings,
  outOpenPlansSectionVisible,
  outVenueMatchNotice,
  sendableOpenPlans,
} from "@/lib/outDesktopGrouping";
import { OUT_NOT_ON_MAP_HEADING, outListingLead } from "@/lib/out/listingRoute";
import {
  OUT_DAY_WINDOWS,
  OUT_OPEN_PLANS_WAY_LABEL,
  outListingsSectionTitle,
  type OutDayWindow,
} from "@/lib/outListings";
import {
  OUT_MAP_WAY,
  OUT_RETRY_LABEL,
  outEmptyLane,
  outStatusLines,
} from "@/lib/out/outStatus";
import { handleSegmentLinkKeyDown } from "@/lib/segmentLinkKeys";
import type { WhatsOnRow } from "@/lib/whatsOn";

import "./out.css";

const DAY_LABEL: Record<OutDayWindow, string> = {
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  weekend: "Weekend",
};

function OutListingCount({ count, lead }: { count: number; lead: ReturnType<typeof outListingLead> }) {
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

export default function OutClient({ day }: { day: OutDayWindow }) {
  // Out follows the city Places set. The server snapshot is null, so the first
  // paint asks for London and the browser's own answer takes over after mount:
  // this page is CDN-eligible by way of nothing personal being in its document,
  // and a city read at render time would put a stranger's choice in it.
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const cityId = preferredCity ?? DEFAULT_CITY_ID;
  const { body, failed, pending, retry } = useOutListings(day, cityId);

  useEffect(() => {
    trackEvent("out_screen_view");
  }, []);

  const onOpen = useCallback((row: WhatsOnRow) => {
    trackEvent("out_card_opened", { source: outCardSource(row.source.label) });
  }, []);

  const listingRows = body?.events ?? [];
  // Listings at a pub of ours lead; the rest follow under their own heading. On
  // a night the match placed none, the honest line leads instead of a listing.
  const lead = outListingLead(listingRows, body?.venueMatch, day);
  // Credit is owed for every row on screen, matched or not, so it is read off
  // the answer's own attribution rather than off the rows we could not place.
  const credits = body?.attribution ?? [];
  const venueMatchNotice = outVenueMatchNotice(
    listingRows,
    day,
    body?.venueMatch,
    {
      unmatchedCount: body?.unmatchedCount,
      unmatchedPlaces: body?.unmatchedPlaces,
      unmatchedPlaceCount: body?.unmatchedPlaceCount,
      unmatchedSources: body?.unmatchedSources,
    },
  );
  const openPlansPreview = body?.openPlansStatus === "preview";
  const openPlansDegraded = body?.openPlansStatus === "degraded";
  const sendablePlans = sendableOpenPlans(body?.openPlans ?? []);
  // A lane with nothing in it is a card with one way onward, never a bare
  // sentence over an empty page. The lines are the ones the lane already said.
  const emptyLane = outEmptyLane({ body, failed, pending });
  const showOpenPlans =
    !openPlansPreview &&
    !openPlansDegraded &&
    outOpenPlansSectionVisible(body?.openPlans ?? []);

  // One night under a heading that already names it printed "What's on
  // tonight" over "Tonight". The night is named once: by the heading above
  // when the rows cover one night, by the group headings when they cover
  // several.
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
    <main id="main" className="outPage" data-testid="out-screen">
      <SiteNav active="out" />

      {/* The head is the Screen primitive (docs/design/LAUNCH_SCREENS.md). The
          heading names the night; the city follows the Places choice in the
          listings below. The primary is a PRODUCT
          ACTION on every night, listed or quiet: a listing is a publisher's
          sale, and on 13 Sep 2026 the first one ("Burlesque") wore the fill on
          a night none of 25 listings was at a pub we list. Each listing opens
          from its own card. */}
      <Screen
        as="div"
        className="outScreen"
        title={`${outListingsSectionTitle(day).replace("'", "’")}.`}
        titleId="out-title"
        primary={
          <Link prefetch={false} href={OUT_MAP_WAY.href}>
            {OUT_MAP_WAY.label}
          </Link>
        }
        secondary={
          <Link prefetch={false} href="/plan">
            Plan a night
          </Link>
        }
      >
      <nav className="outDayChips" aria-label="When">
        {OUT_DAY_WINDOWS.map((windowKey) => {
          const selected = windowKey === day;
          const href: Route = windowKey === "tonight" ? "/out" : `/out?day=${windowKey}`;
          return (
            <Link prefetch={false}
              key={windowKey}
              href={href}
              className="outDayChip"
              aria-current={selected ? "page" : undefined}
              onKeyDown={handleSegmentLinkKeyDown}
              onClick={() => trackEvent("out_filter_select", { kind: windowKey })}
            >
              {DAY_LABEL[windowKey]}
            </Link>
          );
        })}
      </nav>

      <section className="outListings" aria-labelledby="out-listings-heading">
        <h2 id="out-listings-heading" className="outSectionTitle">
          {outListingsSectionTitle(day)}
        </h2>
        <OutListingCount
          count={listingRows.length}
          lead={lead}
        />
        {pending ? <ListingsSkeleton /> : null}
        {emptyLane ? (
          <div
            data-testid="out-empty-lane"
            data-out-state={emptyLane.way === "retry" ? "error" : "empty"}
            role={emptyLane.way === "retry" ? "alert" : "status"}
          >
            <EmptyState
              title={emptyLane.lines[0]}
              action={
                emptyLane.way === "retry" ? (
                  <button type="button" onClick={retry}>
                    {OUT_RETRY_LABEL}
                  </button>
                ) : (
                  <Link prefetch={false} href={OUT_MAP_WAY.href}>
                    {OUT_MAP_WAY.label}
                  </Link>
                )
              }
            >
              {emptyLane.lines.slice(1).join(" ") || null}
            </EmptyState>
          </div>
        ) : (
          outStatusLines({ body, failed }).map((line) => (
            <p className="outStatus" key={line}>
              {line}
            </p>
          ))
        )}
        <div className="outListingSurface" data-testid="out-listing-surface">
          {lead.honestEmpty ? (
            <div className="outHonestEmpty" data-testid="out-honest-empty">
              <EmptyState
                title={lead.honestEmpty.line}
                action={
                  lead.honestEmpty.way ? (
                    <Link prefetch={false} href={lead.honestEmpty.way.href}>
                      {lead.honestEmpty.way.label}
                    </Link>
                  ) : null
                }
              />
            </div>
          ) : null}
          {lead.split ? (
            <>
              {listingGroups(lead.matched, "out-group-", "h3")}
              {lead.unmatched.length > 0 ? (
                <section className="outUnmatchedBlock" aria-labelledby="out-unmatched-heading">
                  <h3 id="out-unmatched-heading" className="outUnmatchedTitle">
                    {OUT_NOT_ON_MAP_HEADING}
                  </h3>
                  {listingGroups(lead.unmatched, "out-group-unmatched-", "h4")}
                </section>
              ) : null}
            </>
          ) : (
            listingGroups(lead.unmatched, "out-group-", "h3")
          )}
        </div>
        {/* Two footnotes under the list, in this order, and never above it.

            The FIRST is the one finding a row cannot state for itself: the
            venue match never ran, so "not on our map yet" on a row would be a
            claim about a lookup nobody performed. It is silent when the match
            was healthy - every row now says its own pub answer on its own line.

            The SECOND is the credit owed to whoever published these listings.
            It is a footer under the answer, not the heading of the page. */}
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
      </section>

      <section className="outWallDiscovery" aria-labelledby="out-wall-discovery-heading">
        <h2 id="out-wall-discovery-heading" className="outSectionTitle">
          Drink Wall
        </h2>
        <p className="outStatus">
          Pints, pub fronts and London views from drinkers on the map.{" "}
          <Link prefetch={false} href="/wall" className="outPlansFootLink">
            Browse the wall
          </Link>
        </p>
      </section>

      <EditorialRail />

      {openPlansPreview ? (
        <section className="outPlans" aria-labelledby="out-plans-heading">
          <h2 id="out-plans-heading" className="outSectionTitle outPlansSectionTitle">
            Open plans
          </h2>
          <p className="outStatus" role="status">Open plans are in preview.</p>
        </section>
      ) : openPlansDegraded ? (
        <section className="outPlans" aria-labelledby="out-plans-heading">
          <h2 id="out-plans-heading" className="outSectionTitle outPlansSectionTitle">
            Open plans
          </h2>
          <div role="alert">
            <EmptyState
              title="Open plans could not be checked."
              action={
                <button type="button" onClick={retry}>
                  {OUT_RETRY_LABEL}
                </button>
              }
            />
          </div>
        </section>
      ) : showOpenPlans ? (
        <section className="outPlans" aria-labelledby="out-plans-heading">
          <h2 id="out-plans-heading" className="outSectionTitle outPlansSectionTitle">
            Open plans
          </h2>
          <ul className="outOpenPlanList">
            {sendablePlans.map((plan) => (
              <OutOpenPlanCard key={plan.crewId} plan={plan} />
            ))}
          </ul>
          <p className="outPlansFoot">
            <Link prefetch={false} href="/plan" className="outPlansFootLink">
              {OUT_OPEN_PLANS_WAY_LABEL}
            </Link>
          </p>
        </section>
      ) : null}
      </Screen>
    </main>
  );
}
