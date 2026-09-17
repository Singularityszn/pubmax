// Instant held frame while a primary-tab route's RSC/client tree arrives.
// Same paper/ink tokens as the real pages — no design change, just a skeleton
// so cold tab taps paint something within the transition budget.

import SiteNav from "@/components/nav/SiteNav";

import styles from "./mobileNav.module.css";

type RouteLoadingShellProps = {
  /** Short status label for AT + quiet on-screen copy (e.g. "Tonight"). */
  label: string;
};

export default function RouteLoadingShell({ label }: RouteLoadingShellProps) {
  return (
    <main id="main"
      className={styles.routeLoadingShell}
      aria-busy="true"
      aria-live="polite"
      aria-label={`Loading ${label}`}
    >
      <SiteNav />
      <div className={styles.routeLoadingShellInner}>
        <span className={styles.routeLoadingShellBar} aria-hidden="true" />
        <span className={`${styles.routeLoadingShellBar} ${styles.routeLoadingShellBarShort}`} aria-hidden="true" />
        <span className={styles.routeLoadingShellCard} aria-hidden="true" />
        <span className={styles.routeLoadingShellCard} aria-hidden="true" />
        <p className={styles.routeLoadingShellLabel}>{label}</p>
      </div>
    </main>
  );
}
