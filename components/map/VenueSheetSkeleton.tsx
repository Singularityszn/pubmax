// Structured skeleton for the venue sheet while `/api/venue/[id]` hydrates.
// Matches the sheet's tab + stamp layout so the loading state feels like the
// real panel, not a bare "Loading…" line.

export default function VenueSheetSkeleton() {
  return (
    <div className="venueSheetSkeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="venueSheetSkeletonLabel">Loading full pub details…</span>
      <div className="venueSheetSkeletonTitle" aria-hidden="true" />
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
