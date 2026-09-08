"use client";

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
import { CITIES, DEFAULT_CITY_ID } from "@/lib/cities";
import { readPreferredCity, subscribePreferredCity } from "@/lib/cityPreference";
import { outCardSource } from "@/lib/out/attribution";
import {
  groupOutListings,
  outOpenPlansSectionVisible,
  outVenueMatchNotice,
  sendableOpenPlans,
} from "@/lib/outDesktopGrouping";
import { outPrimaryListingWay } from "@/lib/out/listingRoute";
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
  const listingGroups = groupOutListings(listingRows);
  // The primary is the first listing in the order the page prints them, so the
  // button and the top of the list cannot name two different nights.
  const primaryListing = outPrimaryListingWay(
    listingGroups.flatMap((group) => group.rows),
  );
  // Credit is owed for every row on screen, matched or not, so it is read off
  // the answer's own attribution rather than off the rows we could not place.
  const credits = body?.attribution ?? [];
  const showGroupTitles = listingGroups.length > 1;
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

  return (
    <main id="main" className="outPage" data-testid="out-screen">
      <SiteNav active="out" />

      {/* The head is the Screen primitive (docs/design/LAUNCH_SCREENS.md). The
          kicker names the city the listings follow: London on the server and
          on first paint, then the city Places set. The primary is the FIRST
          LISTING: a reader who came to see what is on should not have to leave
          the list to find out. The map is the quiet second door, and it takes
          the primary back only on a night with nothing to lead with. */}
      <Screen
        as="div"
        className="outScreen"
        kicker={`Out in ${CITIES[cityId].displayName}`}
        title="What’s on, sourced."
        titleId="out-title"
        primary={
          primaryListing ? (
            primaryListing.external ? (
              <a
                className="outPrimaryListing"
                href={primaryListing.href}
                rel="noopener noreferrer"
                target="_blank"
                onClick={() => trackEvent("out_card_opened", { source: outCardSource(primaryListing.sourceLabel) })}
              >
                <span className="outPrimaryListingLabel">{primaryListing.label}</span>
              </a>
            ) : (
              <Link
                prefetch={false}
                className="outPrimaryListing"
                href={primaryListing.href}
                onClick={() => trackEvent("out_card_opened", { source: outCardSource(primaryListing.sourceLabel) })}
              >
                <span className="outPrimaryListingLabel">{primaryListing.label}</span>
              </Link>
            )
          ) : (
            <Link prefetch={false} href={OUT_MAP_WAY.href}>
              {OUT_MAP_WAY.label}
            </Link>
          )
        }
        secondary={
          primaryListing ? (
            <Link prefetch={false} href={OUT_MAP_WAY.href}>
              {OUT_MAP_WAY.label}
            </Link>
          ) : (
            <Link prefetch={false} href="/plan">
              Plan a night
            </Link>
          )
        }
      >
      <nav className="outDayChips" aria-label="When">
        {OUT_DAY_WINDOWS.map((windowKey) => {
          const selected = windowKey === day;
          const href = windowKey === "tonight" ? "/out" : `/out?day=${windowKey}`;
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
        {pending ? <ListingsSkeleton /> : null}
        {emptyLane ? (
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
        ) : (
          outStatusLines({ body, failed }).map((line) => (
            <p className="outStatus" key={line}>
              {line}
            </p>
          ))
        )}
        <div className="outListingSurface" data-testid="out-listing-surface">
          {listingGroups.map((group) => (
            <section
              key={group.key}
              className="outGroup"
              {...(showGroupTitles
                ? { "aria-labelledby": `out-group-${group.key}` }
                : { "aria-label": group.label })}
            >
              {/* One night under a heading that already names it printed
                  "What's on tonight" over "Tonight". The night is named once:
                  by the section title when there is one night, by the group
                  headings when the chip covers several. */}
              {showGroupTitles ? (
                <h3 id={`out-group-${group.key}`} className="outGroupTitle">
                  {group.label}
                </h3>
              ) : null}
              <ul className="outGroupList">
                {group.rows.map((row) => (
                  <li key={row.id} className="outListingRow" data-testid="out-listing-row">
                    <div className="outListingGig">
                      <OutCardBody row={row} onOpen={() => onOpen(row)} titleLevel={4} />
                    </div>
                    <OutListingPubPair row={row} venueMatch={body?.venueMatch} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
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
