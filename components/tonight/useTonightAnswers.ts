"use client";

// Everything Tonight's three answer cards need, composed from what the page
// already holds (components/tonight/TonightAnswerCards.tsx). One hook, so the
// page passes its reads in and gets the cards' props back.

import { useMemo } from "react";

import type {
  TonightAnswerListing,
  TonightLastTrainView,
  TonightRegularNightsView,
} from "@/components/tonight/TonightAnswerCards";
import {
  useLastTrainSummary,
  useRegularNights,
  useTonightNearbyVenues,
} from "@/components/tonight/useTonightAnswerReads";
import type { PicksStateKind } from "@/lib/picksState";
import { regularNightsForWeekday, regularNightsWeekday } from "@/lib/regularNights";
import type { TonightNear } from "@/lib/tonight";
import {
  tonightCheapestAnswer,
  tonightOnTonightListing,
  type TonightCheapestAnswer,
} from "@/lib/tonightAnswers";
import type { TonightCheapPint } from "@/lib/tonightCheapPints";
import { tonightRowLinks } from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { laneTimeLabel } from "@/lib/whatsOnBadges";

type Coord = { lat: number; lng: number };
type TonightSelectableVenueIds = Parameters<typeof tonightRowLinks>[1];

function listingView(
  row: WhatsOnRow | null,
  selectable: TonightSelectableVenueIds,
): TonightAnswerListing | null {
  if (!row) return null;
  const links = tonightRowLinks(row, selectable);
  return {
    title: row.title,
    placeName: row.placeName,
    when: laneTimeLabel(row),
    sourceLabel: links.sourceLabel,
    href: links.primary?.href ?? null,
    external: links.primary?.external ?? false,
  };
}

export function useTonightAnswers(input: {
  origin: Coord | null;
  tonightNear: TonightNear | null;
  /** The ordered primary listing rows the list below paints. */
  listingRows: readonly WhatsOnRow[];
  listingsStateKind: PicksStateKind;
  selectableVenueIds: TonightSelectableVenueIds;
  cheapPints: readonly TonightCheapPint[] | undefined;
  /** The server render's instant while its answer is on screen. */
  renderedAt: number | undefined;
}): {
  cheapest: TonightCheapestAnswer | null;
  listing: TonightAnswerListing | null;
  regular: TonightRegularNightsView | null;
  lastTrain: TonightLastTrainView;
} {
  const { origin, tonightNear, listingRows, listingsStateKind, selectableVenueIds, cheapPints, renderedAt } = input;
  const patch =
    !origin && tonightNear?.patchLabel ? { label: tonightNear.patchLabel, near: tonightNear.near } : null;
  const nearby = useTonightNearbyVenues(origin ?? patch?.near ?? null);
  const cheapest = tonightCheapestAnswer({ origin, patch, nearby, cityRows: cheapPints ?? [] });

  const row = useMemo(() => tonightOnTonightListing(listingRows), [listingRows]);
  const listing = useMemo(() => listingView(row, selectableVenueIds), [row, selectableVenueIds]);

  // Regular nights stand in only when the read holds no confirmed listing,
  // and never while a read is still running: they are not tonight's listing.
  const wantRegular = !row && listingsStateKind !== "refreshing";
  const regularRead = useRegularNights(wantRegular);
  const near = tonightNear?.near ?? null;
  const regular = useMemo<TonightRegularNightsView | null>(() => {
    if (!wantRegular) return null;
    if (regularRead.status === "failed") return { status: "failed" };
    if (regularRead.status !== "ready") return { status: "loading" };
    // eslint-disable-next-line react-hooks/purity -- deliberate clock read
    const now = new Date(renderedAt ?? Date.now());
    return {
      status: "ready",
      answer: regularNightsForWeekday(regularRead.nights, regularNightsWeekday(now), near),
    };
  }, [wantRegular, regularRead, renderedAt, near]);

  const lastTrain = useLastTrainSummary(origin);
  return { cheapest, listing, regular, lastTrain };
}
