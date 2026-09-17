"use client";

import { useEffect, useState } from "react";

import {
  MAP_LOADING_SLOW_AFTER_MS,
  MAP_LOADING_SLOW_LINE,
  mapLoadingPrimaryLine,
} from "@/lib/mapLoadingCopy";
import styles from "./MapLoadingFrame.module.css";

// The map's own held frame, mounted only while the map is still loading. It
// owns the slow line so the threshold is testable without the MapLibre canvas
// graph, and it leaves with the load: pin reveal unmounts it.
export default function MapLoadingFrame({
  mapDisplayName,
  progress,
  openingLocationPromptActive = false,
}: {
  mapDisplayName: string;
  progress: number;
  openingLocationPromptActive?: boolean;
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), MAP_LOADING_SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className={`${styles.mapLoading} mapLoading`}
      role="status"
      aria-busy="true"
      aria-live="polite"
      // Accessible name stays literal on purpose: the visible line below
      // carries the dry aside, the announced one states the fact.
      aria-label={`Loading the ${mapDisplayName} pub map.`}
    >
      <div className={styles.mapLoadingScene} aria-hidden="true">
        <span className={`${styles.mapLoadingStreet} ${styles['mapLoadingStreet--one']}`} />
        <span className={`${styles.mapLoadingStreet} ${styles['mapLoadingStreet--two']}`} />
        <span className={styles.mapLoadingRiver} />
        <span className={`${styles.mapLoadingPin} ${styles['mapLoadingPin--pint']} ${styles['mapLoadingPin--one']}`} />
        <span className={`${styles.mapLoadingPin} ${styles['mapLoadingPin--amber']} ${styles['mapLoadingPin--two']}`} />
        <span className={`${styles.mapLoadingPin} ${styles['mapLoadingPin--brick']} ${styles['mapLoadingPin--three']}`} />
        <span className={`${styles.mapLoadingPin} ${styles['mapLoadingPin--pint']} ${styles['mapLoadingPin--four']}`} />
      </div>
      <div className={styles.mapLoadingCopy}>
        <div className={styles.mapLoadingLines}>
          <span className={styles.mapLoadingEyebrow}>{mapDisplayName} pub map</span>
          <span>
            {openingLocationPromptActive
              ? "Using your location to find nearby pints."
              : mapLoadingPrimaryLine(mapDisplayName)}
          </span>
          {slow ? <span className={styles.mapLoadingSlow}>{MAP_LOADING_SLOW_LINE}</span> : null}
        </div>
      </div>
      {/* Decorative: this sits inside a polite live region, and a stepping
          aria-valuenow would announce the same load four more times over the
          container's own label and the slow line. */}
      <div className={styles.mapLoadingProgress} aria-hidden="true" data-progress={progress}>
        <span className={styles.mapLoadingProgressBar} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
