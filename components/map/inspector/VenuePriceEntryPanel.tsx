"use client";

import type { CommunityPriceMapReach } from "@/lib/communityPrice";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";

import VenuePriceSignInGate from "./VenuePriceSignInGate";

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
}: VenuePriceEntryPanelProps) {
  if (canSubmitPrice) {
    return (
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
    );
  }

  if (!showSignInGate) return null;

  return (
    <VenuePriceSignInGate
      venueName={venueName}
      loading={authLoading}
    />
  );
}
