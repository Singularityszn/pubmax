"use client";

import { Chip } from "@/components/ui/chip";
import { PLAN_STOP_COUNTS, normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";

/**
 * How many pubs the night visits. The visible label says PUB stops, not
 * "Stops", because in the guided flow this row sits a thumb's width above
 * "How many people?" and its own row of small numbers: two bare number rows
 * one under the other is how a group of two got read as a two-pub night.
 *
 * Each count is the shared number square (`Chip variant="number"`), the same
 * component the /pubs fare-zone picker renders: one family for every square a
 * reader taps a figure on, rather than two look-alikes at 10px and 6px.
 */
export default function PlanStopCountPicker({
  value,
  onChange,
  ready = true,
}: {
  value: unknown;
  onChange: (value: PlanStopCount) => void;
  ready?: boolean;
}) {
  const selected = normalizePlanStopCount(value);
  return (
    <div className="planStopCount" role="group" aria-label="Number of pub stops">
      <span className="planStopCount__label">Pub stops</span>
      <div className="planStopCount__choices">
        {PLAN_STOP_COUNTS.map((count) => (
          <Chip
            key={count}
            variant="number"
            aria-pressed={selected === count}
            aria-disabled={ready ? undefined : true}
            onClick={() => { if (ready) onChange(count); }}
          >
            {count}
          </Chip>
        ))}
      </div>
    </div>
  );
}
