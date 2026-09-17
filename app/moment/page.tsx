import type { Metadata } from "next";
import { Suspense } from "react";

import MomentCapture from "@/components/moment/MomentCapture";
import styles from "@/components/moment/moment.module.css";

export const metadata: Metadata = {
  title: "Save a Moment",
  description: "Keep a private PUBMAXX Moment, then decide if it belongs in a Story.",
};

export default function MomentPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <main id="main" className={styles.momentPage} aria-busy="true" aria-label="Loading Moment composer">
          <div className={styles.momentMain}>
            <div className={styles.momentSkeleton} aria-hidden="true">
              <span className={styles.momentSkeletonEyebrow} />
              <span className={styles.momentSkeletonTitle} />
              <span className={styles.momentSkeletonCanvas} />
              <span className={styles.momentSkeletonRow} />
            </div>
          </div>
        </main>
      }
    >
      <MomentCapture />
    </Suspense>
  );
}
