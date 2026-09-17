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
import { DEFAULT_DRINK_LANE } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";

import type { VenuePriceSubmitMission } from "@/components/map/VenuePriceSubmit";
import type { PriceEvidenceMission } from "@/lib/priceEvidenceMissions";
import { missionAnalyticsProps, missionHeading } from "@/lib/priceEvidenceMissions";

import VenuePriceSignInGate from "./VenuePriceSignInGate";
import "../venuePriceSubmit.css";
import "@/components/nearme/priceEvidenceMission.css";

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
  /**
   * Whether the form (or its sign-in gate) is on screen. The Overview folds
   * the composer behind its one price door (lib/pintTrust.ts,
   * `overviewPriceDoor`) and passes false until the door is taken; every other
   * surface leaves it at the default and keeps the form open. The effects
   * above the form run either way, so a folded panel still reads the venue's
   * community prices and still counts as viewed.
   */
  open?: boolean;
  /** The drink the map is under. The composer opens on it. */
  laneCategory?: DrinkCategory;
  mission?: PriceEvidenceMission | null;
  missionPending?: boolean;
  onDismissMission?: (mission: PriceEvidenceMission) => void;
  /**
   * The mission's own ask has been answered by a logged price. The card leaves
   * on this, never on the dismissal, because a drinker who did the thing did
   * not skip it (lib/priceEvidenceMissionDismiss.ts).
   */
  onMissionFulfilled?: (mission: PriceEvidenceMission) => void;
  /** Refresh Pint Drops for this venue after a successful Log it. */
  onLogged?: (venueId: string) => void;
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
  open = true,
  laneCategory = DEFAULT_DRINK_LANE,
  mission = null,
  missionPending = false,
  onDismissMission,
  onMissionFulfilled,
  onLogged,
}: VenuePriceEntryPanelProps) {
  const viewedVenueId = useRef<string | null>(null);
  const openedMissionKey = useRef<string | null>(null);
  useEffect(() => {
    if (viewedVenueId.current === venueId) return;
    viewedVenueId.current = venueId;
    trackEvent("price_submit_viewed", { category: DEFAULT_SUBMIT_CATEGORY });
  }, [venueId]);
  useEffect(() => {
    if (!mission || !canSubmitPrice) return;
    const key = `${mission.venueId}:${mission.reason}:${mission.drinkCategory ?? ""}`;
    if (openedMissionKey.current === key) return;
    openedMissionKey.current = key;
    trackEvent("mission_opened", missionAnalyticsProps("map", mission));
  }, [canSubmitPrice, mission]);

  const loadVenue = communityPrices.loadVenue;
  useEffect(() => {
    loadVenue(venueId);
  }, [loadVenue, venueId]);

  const priceEntry = !open ? null : canSubmitPrice ? (
    <VenuePriceSubmit
      key={venueId}
      venueId={venueId}
      venueName={venueName}
      communityPrices={communityPrices}
      baselinePriceGbp={baselinePriceGbp}
      latestPintDropAt={latestPintDropAt}
      mapReach={mapReach}
      focusRequest={focusRequest}
      laneCategory={laneCategory}
      mission={
        mission
          ? ({
              reason: mission.reason,
              drinkCategory: mission.drinkCategory,
              surface: "map",
            } satisfies VenuePriceSubmitMission)
          : null
      }
      missionPending={missionPending}
      onLogged={(loggedVenueId) => {
        // The mission asked for THIS pub's price and now has it, so the card
        // above the receipt goes: leaving it there asks again for what the
        // reader just answered, over the answer itself.
        if (mission && loggedVenueId === mission.venueId) onMissionFulfilled?.(mission);
        onLogged?.(loggedVenueId);
      }}
    />
  ) : showSignInGate ? (
    <VenuePriceSignInGate
      venueName={venueName}
      loading={authLoading}
    />
  ) : null;

  const missionSlot =
    open && mission && canSubmitPrice ? (
      <div className="pemSlot pemSlotSheet">
        <div className="pemHead">
          <h3 className="pemHeading">
            {missionHeading({
              reason: mission.reason,
              venueName,
              drinkCategory: mission.drinkCategory,
            })}
          </h3>
          {onDismissMission ? (
            <div className="pemActions">
              <button
                type="button"
                className="pemSkip"
                onClick={() => onDismissMission(mission)}
              >
                Not now
              </button>
            </div>
          ) : null}
        </div>
      </div>
    ) : null;

  const signals = includeSignals ? (
    <VenueCommunitySignals
      venueId={venueId}
      venueName={venueName}
      signals={communityPrices.signalsByVenueId.get(venueId) ?? []}
      readStatus={communityPrices.venuePriceStatus.get(venueId) ?? "idle"}
      submitting={communityPrices.submitting}
      onSubmit={communityPrices.submitVenueSignal}
      canSubmit={canSubmitPrice}
    />
  ) : null;

  // The panel is a BORDERED BOX, so an empty one is a bordered strip with
  // nothing in it. On the Overview it mounts with includeSignals false, and a
  // signed-out reader who has not asked to contribute gets no mission, no
  // composer and no gate either - three nulls inside a frame. The frame is
  // decoration on a trust surface, so the panel renders nothing at all rather
  // than an empty one. The effects above still run: this reads the venue's
  // community prices for the Overview's own read-first signals block, and that
  // read may not depend on whether anything is drawn here.
  if (!missionSlot && !priceEntry && !signals) return null;

  return (
    <div className="venuePriceEntryPanel">
      {missionSlot}
      {priceEntry}
      {signals}
    </div>
  );
}
