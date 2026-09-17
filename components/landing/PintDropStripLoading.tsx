import { HandCoins } from "lucide-react";
import styles from "./landing.module.css";

// Skeleton shown while the real PintDropStrip lazy-loads. It mirrors the loaded
// strip's outer shape exactly — the same .dropStripHead (eyebrow + hint) and a
// four-card rail — so the section does not jump height/layout when the real
// component swaps in. Purely decorative, so the whole block is aria-hidden.
export default function PintDropStripLoading() {
  return (
    <div className="dropStrip" aria-hidden="true">
      <div className={styles.dropStripHead}>
        <p className="eyebrow">
          <HandCoins size={15} strokeWidth={1.5} aria-hidden="true" />
          Fresh from the taps
        </p>
        <span className={styles.dropStripHint}>Newest community drops →</span>
      </div>
      <div className={styles.dropStripRail}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={`${styles.dropStripCard} ${styles.dropStripCardSkeleton}`} key={index}>
            <span className={`${styles.skelLine} ${styles.skelLineTop}`} />
            <span className={styles.skelLine} />
            <span className={`${styles.skelLine} ${styles.skelLineShort}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
