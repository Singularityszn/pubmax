import type { PlanState } from "@/lib/plan";

export type PlanPresentation = {
  memberId: string;
  canEdit: boolean;
  mysteryEnabled: boolean;
  routeRevision: number;
};

type PlanPresentationFailure = "invalid" | "forbidden" | "conflict" | "error";
export type PlanPresentationResult = ({ ok: true } & PlanPresentation) | { ok: false; error: PlanPresentationFailure };

export function isPlanPresentation(value: unknown): value is PlanPresentation {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.memberId === "string" && row.memberId.length > 0
    && typeof row.canEdit === "boolean" && typeof row.mysteryEnabled === "boolean"
    && Number.isInteger(row.routeRevision) && Number(row.routeRevision) >= 1;
}

export function planRevealScope(planId: string, memberId: string, accountId: string, revision: number): string {
  return `pubmax:plan-reveals:v1:${encodeURIComponent(planId)}:${encodeURIComponent(memberId)}:${encodeURIComponent(accountId)}:${revision}`;
}


export function planNightRefreshKey(state: PlanState): string {
  return JSON.stringify([state.plan.routeRevision, state.actions?.at(-1)?.id, state.plan.status]);
}

/** New stamped arrivals keep their venue because every route write preserves the completed prefix. */
export function planVisitedRevealPositions(state: PlanState): number[] {
  const revision = Number(state.plan.routeRevision ?? 1);
  return (state.actions ?? []).filter((action) => typeof action.routeRevision === "number" && action.routeRevision >= 1 && action.routeRevision <= revision
    && (action.type === "arrived" || action.type === "skipped"))
    .flatMap((action) => action.stopPosition === null ? [] : [action.stopPosition]);
}
