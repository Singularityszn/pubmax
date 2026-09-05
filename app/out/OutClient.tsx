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
  outUnmatchedListingsNotice,
  sendableOpenPlans,
} from "@/lib/outDesktopGrouping";
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
  const unmatchedNotice = outUnmatchedListingsNotice(
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
          on first paint, then the city Places set. The map is the one primary
          on every day, listed or quiet, because whatever is on tonight the
          pubs are always there; the empty lane's own map link further down
          stays unmarked so the page counts one. */}
      <Screen
        as="div"
        className="outScreen"
        kicker={`Out in ${CITIES[cityId].displayName}`}
        title="What’s on, sourced."
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
        <div className="outListingSurface">
          {listingGroups.map((group) => (
            <section
              key={group.key}
              className="outGroup"
              aria-labelledby={`out-group-${group.key}`}
            >
              <h3 id={`out-group-${group.key}`} className="outGroupTitle">
                {group.label}
              </h3>
              <ul className="outGroupList">
                {group.rows.map((row) => (
                  <li key={row.id} className="outListingRow">
                    <div className="outListingGig">
                      <OutCardBody row={row} onOpen={() => onOpen(row)} titleLevel={4} />
                    </div>
                    <OutListingPubPair row={row} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {/* The honesty line comes AFTER the listings it is honest about. It led
            the page, so a reader met "57 more listings are at places we don't
            list yet" before the one listing we DO have - and the word "more"
            was answering nothing.

            Its ROLE decides how it reads. Under a card it is a footnote about
            the rows that are not on one, and it takes the quiet voice. With no
            card above it there is nothing for it to be a footnote to: it is the
            night's own answer, so it takes the EmptyState idiom, and the
            provider credit stays a footer line under it rather than becoming
            the loudest thing on an otherwise empty page. */}
        {unmatchedNotice ? (
          <div
            className="outListingUnmatched"
            data-role={unmatchedNotice.role}
            role="status"
            data-testid="out-unmatched-notice"
          >
            {unmatchedNotice.role === "lead" ? (
              <EmptyState
                title={unmatchedNotice.line}
                action={
                  <Link prefetch={false} href={unmatchedNotice.way.href}>
                    {unmatchedNotice.way.label}
                  </Link>
                }
              >
                {unmatchedNotice.places || null}
              </EmptyState>
            ) : (
              <p className="outStatus outListingUnmatchedLine">
                {unmatchedNotice.line} {unmatchedNotice.places}
              </p>
            )}
            {unmatchedNotice.credits.length > 0 ? (
              <p className="outListingUnmatchedCredit">
                Listings from{" "}
                {unmatchedNotice.credits.map((credit, index) => (
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
            {unmatchedNotice.role === "aside" ? (
              <p className="outListingUnmatchedWay">
                <Link prefetch={false} href={unmatchedNotice.way.href} className="outPlansFootLink">
                  {unmatchedNotice.way.label}
                </Link>
              </p>
            ) : null}
          </div>
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
