"use client";

import { lazy, Suspense, useEffect, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";

import VenueSheetSkeleton from "@/components/map/VenueSheetSkeleton";
import { useSheetFooterSlot } from "@/components/mobile/sheetFooterContext";
import { shouldWarmMapIntent } from "@/lib/mapWarmup";
import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";
import "./inspector/venueActionCard.css";

// The panel is its own chunk, and on a throttled phone a tap fetches it behind
// the basemap tiles: 202 KB landed 11.9 s after the tap on Slow 4G. The price
// row is already read by the map, so the footer shows it while the chunk is
// out, in the card's own frame, and the real card replaces it in place. The
// pub's price read starts here too: an estimate reads "Checking prices…" until
// it lands, and inside the chunk it started 12 s after the tap.
const VenueInspector = lazy(() => import("@/components/map/VenueInspector"));

// A tap fetched the chunk behind the basemap tiles. Fetched at the first idle
// moment after the pins show, it is in hand for most taps: on Slow 4G a tap
// 5 s after the first priced pin drew the full panel in 0.6 s, not 5.4 s, and
// the first priced pin did not move.
if (typeof window !== "undefined") {
  window.addEventListener(
    PINS_VISIBLE_EVENT,
    () => {
      if (!shouldWarmMapIntent(navigator)) return;
      const warm = () => void import("@/components/map/VenueInspector").catch(() => {});
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(warm, { timeout: 4000 });
      else setTimeout(warm, 0);
    },
    { once: true },
  );
}

type Props = ComponentProps<typeof VenueInspector>;

function PendingActionCard({ venueName, summary }: { venueName: string; summary: ReactNode }) {
  const footerSlot = useSheetFooterSlot();
  if (!footerSlot || !summary) return null;
  return createPortal(
    <div className="venueActionCard" role="group" aria-label={`${venueName}, price and actions`}>
      {summary}
      <div className="venueActionCardPendingActions" aria-hidden="true" />
    </div>,
    footerSlot,
  );
}

export default function LazyVenueInspector(props: Props) {
  const loadVenue = props.communityPrices.loadVenue;
  const venueId = props.venue.id;
  useEffect(() => {
    loadVenue(venueId);
  }, [loadVenue, venueId]);
  return (
    <Suspense
      fallback={
        <>
          <VenueSheetSkeleton />
          <PendingActionCard venueName={props.venue.name} summary={props.actionSummary} />
        </>
      }
    >
      <VenueInspector {...props} />
    </Suspense>
  );
}
