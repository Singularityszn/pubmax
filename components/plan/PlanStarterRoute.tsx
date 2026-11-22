import PlanPintPriceCaption from "@/components/plan/PlanPintPriceCaption";
import { formatPence } from "@/lib/formatGbp";
import type { PlanStarterView } from "@/lib/planStarter";
import { priceBand, priceBandAreaForVenue, priceBandClass } from "@/lib/priceBand";

import "./planStarterRoute.css";

/** The priced route /plan leads with (lib/planStarter.ts): each stop's listed pint with its own record. */
export default function PlanStarterRoute({ starter }: { starter: PlanStarterView }) {
  return (
    <section className="planStarter" aria-labelledby="plan-starter-title">
      <h2 id="plan-starter-title" className="planStarter__title">{starter.heading}</h2>
      <p className="planStarter__summary">{starter.summary}</p>
      <ol className="planStarter__stops">
        {starter.stops.map((stop, index) => {
          const evidence = stop.pintPriceEvidence ?? null;
          const pence = evidence?.pence ?? 0;
          const band = evidence?.serving === "pint" ? priceBand(pence / 100, priceBandAreaForVenue(stop.venueId)) : null;
          return (
            <li key={stop.venueId} className="planStarter__stop">
              <span className="planStarter__number" aria-hidden="true">{index + 1}</span>
              <span className="planStarter__name">{stop.venueName}</span>
              <strong className={`planStarter__price ${priceBandClass(band)}`.trim()}>{formatPence(pence)}</strong>
              <small className="planStarter__source"><PlanPintPriceCaption evidence={evidence} /></small>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
