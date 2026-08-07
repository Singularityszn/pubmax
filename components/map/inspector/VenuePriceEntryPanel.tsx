"use client";

import { useEffect, useRef } from "react";

import VenueCommunitySignals from "@/components/map/VenueCommunitySignals";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import { trackEvent } from "@/lib/analytics";
import {
  DEFAULT_SUBMIT_CATEGORY,
  type CommunityPriceMapReach,
} from "@/lib/communityPrice";

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
  /** When false, omit the signals block (Overview mounts its own read-first copy). */
  includeSignals?: boolean;
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
  includeSignals = true,
}: VenuePriceEntryPanelProps) {
  const viewedVenueId = useRef<string | null>(null);
  useEffect(() => {
    if (viewedVenueId.current === venueId) return;
    viewedVenueId.current = venueId;
    trackEvent("price_submit_viewed", { category: DEFAULT_SUBMIT_CATEGORY });
  }, [venueId]);

  const loadVenue = communityPrices.loadVenue;
  useEffect(() => {
    loadVenue(venueId);
  }, [loadVenue, venueId]);

  const priceEntry = canSubmitPrice ? (
    <VenuePriceSubmit
      key={venueId}
      venueId={venueId}
      venueName={venueName}
      communityPrices={communityPrices}
      baselinePriceGbp={baselinePriceGbp}
      latestPintDropAt={latestPintDropAt}
      mapReach={mapReach}
      focusRequest={focusRequest}
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
      {includeSignals ? (
        <VenueCommunitySignals
          venueId={venueId}
          venueName={venueName}
          signals={communityPrices.signalsByVenueId.get(venueId) ?? []}
          readStatus={communityPrices.venuePriceStatus.get(venueId) ?? "idle"}
          submitting={communityPrices.submitting}
          onSubmit={communityPrices.submitVenueSignal}
          canSubmit={canSubmitPrice}
        />
      ) : null}
    </div>
  );
}
