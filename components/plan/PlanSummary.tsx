import Link from "next/link";

import type { PlanState } from "@/lib/plan";
import { planViewModel } from "@/components/plan/planPresentation";

export default function PlanSummary({ state }: { state: PlanState }) {
  const view = planViewModel(state);
  return (
    <section className="planSummary" aria-labelledby="plan-stops-title">
      <div className="planSummary__rail" aria-hidden="true" />
      <div className="planSummary__heading">
        <p className="planPage__eyebrow">First pint · {view.startLabel}</p>
        <h2 id="plan-stops-title">The route</h2>
      </div>
      <ol className="planSummary__stops">
        {view.stops.map((stop, index) => (
          <li key={`${stop.position}-${stop.venueId}`}>
            <span className="planSummary__marker">{index + 1}</span>
            <div>
              <strong>{stop.venueName}</strong>
              <Link href={`/map?venue=${encodeURIComponent(stop.venueId)}`}>Open on the map</Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
