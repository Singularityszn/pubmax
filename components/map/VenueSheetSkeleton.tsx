// Structured skeleton for the venue sheet while `/api/venue/[id]` hydrates.
// Matches the sheet's tab + stamp layout so the loading state feels like the
// real panel, not a bare "Loading…" line.

import type { VenueRevealForm } from "@/lib/venueReveal";

export default function VenueSheetSkeleton({
  loadingLabel = "Loading full venue details…",
  revealForm = null,
}: {
  loadingLabel?: string;
  revealForm?: VenueRevealForm | null;
}) {
  const revealClasses = revealForm ? ` venueReveal venueReveal--${revealForm}` : "";
  return (
    <div
      className={`venueSheetSkeleton${revealClasses}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="venueSheetSkeletonLabel">{loadingLabel}</span>
      <div
        className={`venueSheetSkeletonTitle${revealForm ? " venueRevealBloom" : ""}`}
        aria-hidden="true"
      />
      <div className="venueSheetSkeletonMeta" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="venueSheetSkeletonTabs" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="venueSheetSkeletonStamp" aria-hidden="true" />
      <div className="venueSheetSkeletonBody" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
