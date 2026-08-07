"use client";

import { useEffect, useRef } from "react";

import VenueCommunitySignals from "@/components/map/VenueCommunitySignals";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import { trackEvent } from "@/lib/analytics";
import {
  resolveSubmitCategory,
  type CommunityPriceMapReach,
} from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

import VenuePriceSignInGate from "./VenuePriceSignInGate";
import "../venuePriceSubmit.css";

type VenuePriceEntryPanelProps = {
  venueId: string;
  venueName: string;
  communityPrices: CommunityPricesState;
  canSubmitPrice: boolean;
  showSignInGate: boolean;
  authLoading: boolean;
  baselinePriceGbp?: number | null;
  latestPintDropAt?: number | null;
  mapReach?: CommunityPriceMapReach;
  focusRequest?: number;
  /**
   * Active map drink lens when present. Preselects that category on the form
   * when it is submittable; ignored otherwise.
   */
  initialCategory?: DrinkCategory | null;
};

/**
 * Auth-aware switch around the one existing price form.
 *
 * Auth state stays injectable here so tests can cover signed-in and signed-out
 * destinations without simulating Supabase transport in a browser.
 */
export default function VenuePriceEntryPanel({
  venueId,
  venueName,
  communityPrices,
  canSubmitPrice,
  showSignInGate,
  authLoading,
  baselinePriceGbp = null,
  latestPintDropAt = null,
  mapReach = "paint",
  focusRequest = 0,
  initialCategory = null,
}: VenuePriceEntryPanelProps) {
  const shownCategory = resolveSubmitCategory(initialCategory);
  const viewedVenueId = useRef<string | null>(null);
  useEffect(() => {
    if (viewedVenueId.current === venueId) return;
    viewedVenueId.current = venueId;
    trackEvent("price_submit_viewed", { category: shownCategory });
  }, [shownCategory, venueId]);

  const loadVenue = communityPrices.loadVenue;
  useEffect(() => {
    loadVenue(venueId);
  }, [loadVenue, venueId]);

  const priceEntry = canSubmitPrice ? (
    <VenuePriceSubmit
      key={`${venueId}:${shownCategory}`}
      venueId={venueId}
      venueName={venueName}
      communityPrices={communityPrices}
      baselinePriceGbp={baselinePriceGbp}
      latestPintDropAt={latestPintDropAt}
      mapReach={mapReach}
      focusRequest={focusRequest}
      initialCategory={shownCategory}
    />
  ) : showSignInGate ? (
    <VenuePriceSignInGate
      venueName={venueName}
      loading={authLoading}
    />
  ) : null;

  return (
    <div className="venuePriceEntryPanel">
      {priceEntry}
      <VenueCommunitySignals
        venueId={venueId}
        venueName={venueName}
        signals={communityPrices.signalsByVenueId.get(venueId) ?? []}
        readStatus={communityPrices.venuePriceStatus.get(venueId) ?? "idle"}
        submitting={communityPrices.submitting}
        onSubmit={communityPrices.submitVenueSignal}
        canSubmit={canSubmitPrice}
      />
    </div>
  );
}
