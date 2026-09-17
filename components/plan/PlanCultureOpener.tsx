"use client";

import type { CultureOpenerDTO } from "@/lib/cultureCrawl";
import planStyles from "@/app/plan/Plan.module.css";

/**
 * The free-standing thing to see before stop 1.
 *
 * It is deliberately not a Stop: no number, no swap, no remove, no price. The
 * POI layer holds a name, a category and a point and nothing else, so this
 * prints exactly those plus the walk from the first pub, and hands the reader
 * the note that says what we do not know.
 */
export default function PlanCultureOpener({ opener }: { opener: CultureOpenerDTO | null }) {
  if (!opener) return null;
  return (
    <div className={planStyles.planComposer__opener} data-testid="plan-culture-opener">
      <span className={planStyles.planComposer__openerEyebrow}>Before the first pint</span>
      {opener.waypoint ? (
        <p className={planStyles.planComposer__openerPlace}>
          <strong>{opener.waypoint.name}</strong>
          <span>
            {opener.waypoint.categoryLabel} · {opener.waypoint.distanceKm.toFixed(1)} km from stop 1
          </span>
        </p>
      ) : null}
      <p className={planStyles.planComposer__openerNote}>{opener.note}</p>
    </div>
  );
}
