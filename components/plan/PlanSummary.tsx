import type { PlanState } from "@/lib/plan";
import PlanRoute from "@/components/plan/PlanRoute";
import { planViewModel } from "@/components/plan/planPresentation";

export default function PlanSummary({ planId, state }: { planId: string; state: PlanState }) {
  const view = planViewModel(state);
  return (
    <section className="planSummary" aria-labelledby="plan-stops-title">
      <div className="planSummary__rail" aria-hidden="true" />
      <div className="planSummary__heading">
        <p className="planPage__eyebrow">First pint · {view.startLabel}</p>
        <h2 id="plan-stops-title">The route</h2>
      </div>
      <PlanRoute
        planId={planId}
        stops={view.stops.map((stop) => ({
          venueId: stop.venueId,
          venueName: stop.venueName,
          position: stop.position,
        }))}
      />
    </section>
  );
}
