"use client";

import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";

import VenueSheetSkeleton from "@/components/map/VenueSheetSkeleton";
import { useSheetFooterSlot } from "@/components/mobile/sheetFooterContext";
import "./inspector/venueActionCard.css";

// The panel is its own chunk, and on a throttled phone a tap fetches it behind
// the basemap tiles: 202 KB landed 11.9 s after the tap on Slow 4G. The price
// row is already read by the map, so the footer shows it while the chunk is
// out, in the card's own frame, and the real card replaces it in place.
const VenueInspector = lazy(() => import("@/components/map/VenueInspector"));

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
