import "./listingsSkeleton.css";

const LOADING_LABEL = "Loading listings";

/**
 * The listings wait: ONE quiet row, not a stack of grey cards (UX audit, 16 Oct
 * 2026), and invisible for its first 600ms (listingsSkeleton.css) so a read
 * that answers quickly never flashes a placeholder at all. Screen readers
 * still hear "Loading listings" at once.
 */
export default function ListingsSkeleton() {
  return (
    <div
      className="listingsSkeleton"
      data-testid="listings-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="listingsSkeletonLabel">{LOADING_LABEL}</span>
      <div className="listingsSkeletonCard" aria-hidden="true">
        <span className="listingsSkeletonTitle" />
        <span className="listingsSkeletonMeta" />
      </div>
    </div>
  );
}
