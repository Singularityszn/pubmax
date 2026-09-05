"use client";

import { PLAN_STOP_COUNTS, normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";

/**
 * How many pubs the night visits. The visible label says PUB stops, not
 * "Stops", because in the guided flow this row sits a thumb's width above
 * "How many people?" and its own row of small numbers: two bare number rows
 * one under the other is how a group of two got read as a two-pub night.
 */
export default function PlanStopCountPicker({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: PlanStopCount) => void;
}) {
  const selected = normalizePlanStopCount(value);
  return (
    <div className="planStopCount" role="group" aria-label="Number of pub stops">
      <span className="planStopCount__label">Pub stops</span>
      <div className="planStopCount__choices">
        {PLAN_STOP_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={selected === count}
            onClick={() => onChange(count)}
          >
            {count}
          </button>
        ))}
      </div>
    </div>
  );
}
