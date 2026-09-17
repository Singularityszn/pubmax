import styles from "./listingsSkeleton.module.css";

const LOADING_LABEL = "Loading listings";

export default function ListingsSkeleton() {
  return (
    <div
      className={styles.listingsSkeleton}
      data-testid="listings-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className={styles.listingsSkeletonLabel}>{LOADING_LABEL}</span>
      <div className={styles.listingsSkeletonCard} aria-hidden="true">
        <span className={styles.listingsSkeletonTitle} />
        <span className={styles.listingsSkeletonMeta} />
      </div>
      <div className={styles.listingsSkeletonCard} aria-hidden="true">
        <span className={styles.listingsSkeletonTitle} />
        <span className={styles.listingsSkeletonMeta} />
      </div>
      <div className={styles.listingsSkeletonCard} aria-hidden="true">
        <span className={styles.listingsSkeletonTitle} />
        <span className={styles.listingsSkeletonMeta} />
      </div>
    </div>
  );
}
