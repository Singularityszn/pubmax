"use client";

import type {
  CultureOpenerDTO,
  CultureOutingCostsDTO,
  CultureUnknownCost,
} from "@/lib/cultureCrawl";
import { formatGbp } from "@/lib/formatGbp";

const UNKNOWN_COST_LABELS: Record<CultureUnknownCost, string> = {
  admission: "Admission",
  drinks: "Drinks",
  food: "Food",
  transport: "Transport",
};

const OBSERVED_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

function pounds(pence: number): string {
  return formatGbp(pence / 100);
}

/**
 * The pub side of the outing, beside the waypoint. Each recorded pint shows its
 * source and date. The sum is a partial subtotal, and the costs nobody has
 * priced are listed by name so the night never reads as fully costed.
 */
function PlanCultureCosts({ costs }: { costs: CultureOutingCostsDTO }) {
  return (
    <div>
      {costs.knownItems.length > 0 ? (
        <ul aria-label="Known costs">
          {costs.knownItems.map((item) => (
            <li key={item.venueId}>
              Pint at {item.venueName}: {pounds(item.pence)}, {item.source.label},{" "}
              <time dateTime={item.source.observedAt}>{OBSERVED_DATE.format(new Date(item.source.observedAt))}</time>
            </li>
          ))}
        </ul>
      ) : null}
      {costs.knownSubtotalPence !== null ? (
        <p>Partial subtotal: {pounds(costs.knownSubtotalPence)} each, before the costs below.</p>
      ) : null}
      {costs.limitPence !== null ? <p>Your limit: {pounds(costs.limitPence)} each.</p> : null}
      <ul aria-label="Costs not known">
        {costs.unknownItems.map((cost) => <li key={cost}>{UNKNOWN_COST_LABELS[cost]}</li>)}
      </ul>
    </div>
  );
}

/**
 * The free-standing thing to see before stop 1.
 *
 * It is deliberately not a Stop: no number, no swap, no remove, no price. The
 * POI layer holds a name, a category and a point and nothing else, so this
 * prints exactly those plus the walk from the first pub, and hands the reader
 * the note that says what we do not know.
 * Any pub costs follow the note, and none of them prices the place itself.
 */
export default function PlanCultureOpener({ opener }: { opener: CultureOpenerDTO | null }) {
  if (!opener) return null;
  return (
    <div className="planComposer__opener" data-testid="plan-culture-opener">
      <span className="planComposer__openerEyebrow">Before the first pint</span>
      {opener.waypoint ? (
        <p className="planComposer__openerPlace">
          <strong>{opener.waypoint.name}</strong>
          <span>
            {opener.waypoint.categoryLabel} · {opener.waypoint.distanceKm.toFixed(1)} km from stop 1
          </span>
        </p>
      ) : null}
      <p className="planComposer__openerNote">{opener.note}</p>
      {opener.costs ? <PlanCultureCosts costs={opener.costs} /> : null}
    </div>
  );
}
