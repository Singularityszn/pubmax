"use client";

import { useEffect, useRef } from "react";

import { trackEvent } from "@/lib/analytics";
import type { VenueSheetLayer } from "@/lib/analyticsEvents";

/**
 * The ONE emitter of `venue_sheet_opened`.
 *
 * The Map has two venue sheets, one per pub layer (AGENTS.md, "Two pub layers,
 * and only one of them is the product"): `VenueInspector` over the curated
 * index and `UnverifiedPubSheet` over the UK base layer. The release funnel
 * asks whether a landing reached a pub at all, so both must answer it the same
 * way, and a second copy of this guard is how the two would drift.
 *
 * One event per venue: both sheets persist across selections, so the effect
 * re-runs whenever the reader moves to another pub and must not re-fire for the
 * pub already on screen. `trackEvent` is the ordinary consent-gated beacon, so
 * nothing leaves the device without explicit analytics consent.
 */
export function useVenueSheetOpened(venueId: string, layer: VenueSheetLayer): void {
  const reportedVenueId = useRef<string | null>(null);
  useEffect(() => {
    if (!venueId || reportedVenueId.current === venueId) return;
    reportedVenueId.current = venueId;
    trackEvent("venue_sheet_opened", { layer });
  }, [layer, venueId]);
}
