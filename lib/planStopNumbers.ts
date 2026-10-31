// One way to number a plan's stops, shared by every surface that prints them.
// The plan card (components/plan/PlanRoute.tsx) counts from the first stop in
// route order: the first stop is 1, whatever its stored `position` says. A
// stored position can start at 1, or skip a number after a stop was removed,
// so printing `position + 1` made the invite say 2, 3, 4 where the plan card
// said 1, 2, 3. Pure and browser-safe.

/** The stops in route order, each with the number a person reads beside it. */
export function numberPlanStops<T extends { position: number }>(
  stops: readonly T[],
): Array<T & { number: number }> {
  return [...stops]
    .sort((a, b) => a.position - b.position)
    .map((stop, index) => ({ ...stop, number: index + 1 }));
}
