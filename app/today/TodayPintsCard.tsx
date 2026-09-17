"use client";

// The map's Area-button derivation surfaced on the morning brief. The server
// precomputes a tight five for every area, so this reads the viewer's remembered
// area and swaps to the matching precomputed list (no venue data ships to the
// browser, the swap is instant, and the first paint always matches SSR: the
// central default).
//
// Copy claims "near you" only for a resolved remembered patch. The baseline
// collection date stays visible on every render. Every row deep-links to its venue on
// the map. Fail-soft: an area with no verified prices renders nothing, never an
// empty box.

import Link from "next/link";
import PriceBadge from "@/components/PriceBadge";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { useEffect, useState } from "react";
import { ArrowRight, Beer } from "lucide-react";

import { formatPintDatasetSnapshot } from "@/lib/dataFreshness";
import { readRememberedArea } from "@/lib/nightPatches";
import { AREA_NEARBY_ROW_TAG } from "@/lib/venueTruth";

import { todayTextButtonClass } from "./todayTextButton";
import styles from "./Today.module.css";

import {
  resolveTodayPintsPatchId,
  todayPintsHeading,
  type TodayPintsIndex,
  type TodayPintsModule,
} from "./todayPints";

type Props = {
  index: TodayPintsIndex;
};

type TodayPintsView = {
  pints: TodayPintsModule | null;
  hasRememberedLocality: boolean;
};

function viewFor(
  index: TodayPintsIndex,
  remembered: Parameters<typeof resolveTodayPintsPatchId>[0],
): TodayPintsView {
  const id = resolveTodayPintsPatchId(remembered, index);
  return {
    pints: id ? index[id] : null,
    hasRememberedLocality:
      remembered?.kind === "patch" && id === remembered.id,
  };
}

function eyebrow(hasRememberedLocality: boolean): string {
  const scope = hasRememberedLocality
    ? "Lowest listed prices near you"
    : "Lowest listed prices in central London";
  // The bundle is named as a snapshot, never dressed up as tonight's reading:
  // "Last collected" invited a reader to take a months-old figure as current.
  return `${scope}. ${formatPintDatasetSnapshot()}.`;
}

export default function TodayPintsCard({ index }: Props) {
  const [view, setView] = useState<TodayPintsView>(() => viewFor(index, null));

  useEffect(() => {
    // Deferred read (matches PicksCard): localStorage is the external sync, so the
    // first paint stays on the central default from SSR, then settles to the
    // remembered area on the next microtask.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setView(viewFor(index, readRememberedArea()));
    });
    return () => {
      cancelled = true;
    };
  }, [index]);

  if (!view.pints) return null;
  const { pints, hasRememberedLocality } = view;

  return (
    <section className={styles.todayCard} aria-labelledby="today-pints-title" data-testid="today-pints">
      <div className={styles.todayCardHead}>
        <span className={styles.todayCardIcon} aria-hidden="true">
          <Beer size={18} />
        </span>
        <div>
          <p className={styles.todayCardEyebrow}>
            {eyebrow(hasRememberedLocality)}
          </p>
          <h2 className={styles.todayCardTitle} id="today-pints-title">
            {todayPintsHeading(pints)}
          </h2>
        </div>
      </div>

      <ul className={styles.todayPintList}>
        {pints.rows.map((row) => (
          <li key={row.id} className={styles.todayPintRow}>
            <Link className={`${styles.todayPintLink} pressable`} href={row.mapHref}>
              <span className={styles.todayPintName}>
                {/* The name carries the hover underline on its own. Text
                    decoration propagates to in-flow children and a child cannot
                    cancel it, so underlining the whole row would drag the
                    qualifier under with it. */}
                <span className={styles.todayPintNameText}>{row.name}</span>
                {/* The heading names one area. A row that only sits NEAR it says
                    so on its own row rather than borrowing the heading's claim
                    (lib/venueTruth.ts, "nearby is not inside"). */}
                {row.areaRelation === "nearby" ? (
                  <span className={styles.todayPintNearby}>{AREA_NEARBY_ROW_TAG}</span>
                ) : null}
              </span>
              <PriceBadge
                className={styles.todayPintPrice}
                band={priceBand(row.price, priceBandAreaForVenue(row.id))}
              >
                {row.priceLabel}
              </PriceBadge>
            </Link>
          </li>
        ))}
      </ul>

      {/* ONE sentence about what these prices are, and it is the dated one in
          the eyebrow above. The footer used to repeat it undated over a
          different geography, so a reader met the same claim twice and only
          one copy said which day it was collected. */}
      <p className={styles.todayCardFootRow}>
        <Link href="/map" className={todayTextButtonClass(styles.todayTextButton)}>
          Change area
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}
