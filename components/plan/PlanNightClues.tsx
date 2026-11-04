"use client";

import type { PlanStopDTO } from "@/lib/plan";
import PlanClueHuntLoader from "@/components/plan/PlanClueHuntLoader";
import { usePlanNightPresentation } from "@/components/plan/PlanNightPresentation";

export default function PlanNightClues({ planId, ownerKey, stops }: {
  planId: string; ownerKey: string; stops: readonly PlanStopDTO[];
}) {
  const presentation = usePlanNightPresentation();
  if (!presentation?.value) return null;
  return <PlanClueHuntLoader planId={planId} memberId={presentation.value.memberId}
    accountId={ownerKey} revision={presentation.value.routeRevision} stops={stops} />;
}
