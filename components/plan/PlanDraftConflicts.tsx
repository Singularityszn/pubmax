import { londonServiceDateLabel } from "@/lib/planComposerHandoff";
import type { DraftArbitrationConflict, DraftArbitrationSide } from "@/lib/planDraftArbitration";
import type { PlanningIntentArea } from "@/lib/planningIntent";
import type { PlanVenueOption } from "@/lib/planVenueOptions";

type AreaLabel = (area: Exclude<PlanningIntentArea, null>) => string;
type VenueNames = readonly Pick<PlanVenueOption, "id" | "name">[];

function sideParts(side: DraftArbitrationSide, unnamedVenue: string, areaLabel: AreaLabel, venues: VenueNames): string[] {
  return [
    ...("venueId" in side
      ? [side.venueName?.trim() || venues.find((venue) => venue.id === side.venueId)?.name.trim() || unnamedVenue]
      : []),
    ...("area" in side ? [side.area ? areaLabel(side.area) : "No area set"] : []),
    ...("startsAt" in side ? [londonServiceDateLabel(side.startsAt ?? null) ?? "No time set"] : []),
  ];
}

/**
 * The outcomes of draft arbitration, in the person's terms: what the Plan
 * still uses, what it did not use, and what they can change. Arbitration
 * clears nothing, so this never offers a restart it cannot honour.
 */
export default function PlanDraftConflicts({
  conflicts,
  areaLabel,
  venues = [],
}: {
  conflicts: readonly DraftArbitrationConflict[];
  areaLabel: AreaLabel;
  venues?: VenueNames;
}) {
  if (conflicts.length === 0) return null;
  const editable = conflicts.some((conflict) => conflict.recoveryAction === "review-existing-plan"
    || conflict.recoveryAction === "review-plan-details");
  return (
    <section className="planComposer__conflicts" aria-label="Plan changes we kept safe">
      {conflicts.map((conflict, index) => {
        const kept = conflict.kept ? sideParts(conflict.kept, "Your first stop", areaLabel, venues) : [];
        const setAside = conflict.setAside ? sideParts(conflict.setAside, "The pub you picked", areaLabel, venues) : [];
        return (
          <div className="planComposer__conflict" key={`${conflict.code}-${index}`}>
            <p>{conflict.message}</p>
            {kept.length > 0 && setAside.length > 0 ? (
              <dl className="planComposer__conflictSides">
                <div><dt>Kept</dt><dd>{kept.join(" · ")}</dd></div>
                <div><dt>Not used</dt><dd>{setAside.join(" · ")}</dd></div>
              </dl>
            ) : null}
          </div>
        );
      })}
      {editable ? (
        <p className="planComposer__conflictNext">You can change the area, the date and the stops below.</p>
      ) : null}
    </section>
  );
}
