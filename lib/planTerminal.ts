// A PURE LEAF: the always-mounted plan outbox reads this, and lib/plan.ts
// pulls the night areas behind it.
import type { PlannedNightStatus } from "@/lib/plan";

/** A completed or abandoned Plan takes no more route or presentation edits. */
export function isPlanTerminal(status: PlannedNightStatus | undefined): boolean {
  return status === "completed" || status === "abandoned";
}
