import { planStopCountPhrase } from "@/lib/planStopCount";

/**
 * What the phone map's planning pill says.
 *
 * The pill is the one control on the map that names the reader's plan, and
 * it used to read the wrong plan: after one "Plan stop" it said "6-stop plan",
 * because the tap mapped the SUGGESTED six-stop route rather than the one pub
 * the reader had picked (verify-preview-4, J04). The pill now speaks in this
 * order: the crawl the reader is building on this map, then a route that is
 * mapped or on tonight, then the invitation to describe an outing.
 *
 * Pure: a table of words over three numbers, so the shell prints and never
 * decides.
 */
export type PlanActivationPill = {
  /** Painted as active (the raised surface) rather than as the invitation. */
  active: boolean;
  strong: string;
  small: string | null;
  /** The accessible name; the two visible lines are decoration over it. */
  label: string;
};

export const DESCRIBE_OUTING_LABEL = "Describe the outing";

export function planActivationPill(input: {
  /** A mapped route of two or more stops, or the plan on tonight. */
  planActive: boolean;
  planStopCount: number;
  /** Stops picked by hand on this map, when nothing is mapped yet. */
  builtStopCount: number;
}): PlanActivationPill {
  if (input.builtStopCount > 0) {
    const picked = planStopCountPhrase(input.builtStopCount);
    return {
      active: true,
      strong: `${picked} picked`,
      small: "Add stops",
      label: `Edit your crawl, ${picked} picked`,
    };
  }
  if (input.planActive) {
    return {
      active: true,
      strong: `${input.planStopCount}-stop plan`,
      small: "Edit route",
      label: `Edit active ${input.planStopCount}-stop plan`,
    };
  }
  return { active: false, strong: DESCRIBE_OUTING_LABEL, small: null, label: DESCRIBE_OUTING_LABEL };
}
