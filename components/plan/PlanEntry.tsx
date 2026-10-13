"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { parsePlanDescribeFromSearch } from "@/lib/planOccasion";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import { capturePlanEntryArrival, planArrivalHasStoredContext, type PlanEntryArrival } from "@/components/plan/PlanEntryArrival";
import type { PlanStopCount } from "@/lib/planStopCount";
import type FullPlanComposer from "@/components/plan/PlanComposer";

export type PlanEntryRequest = {
  mode: "wizard" | "submit";
  query: string;
  capturedAt: number;
  stopCount?: PlanStopCount;
};

function PlanEntryForm({ arrival, routeSearch }: { arrival: PlanEntryArrival | null; routeSearch: string }) {
  const [query, setQuery] = useState("");
  const [stopCount, setStopCount] = useState<PlanStopCount>();
  const [request, setRequest] = useState<PlanEntryRequest | null>(null);
  const [Composer, setComposer] = useState<typeof FullPlanComposer | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Next supplies the incoming query before window.location commits it.
  // Resolve that request before the fresh field can accept input.
  const requiresFull = Boolean(arrival && (
    planArrivalHasStoredContext(arrival) || parsePlanDescribeFromSearch(routeSearch)
  ));
  const needsFull = requiresFull || Boolean(request);
  useEffect(() => {
    if (!needsFull) return;
    let cancelled = false;
    void import("@/components/plan/PlanComposer").then((module) => {
      if (!cancelled) setComposer(() => module.default);
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    });
    return () => { cancelled = true; };
  }, [needsFull, attempt]);
  function open(mode: PlanEntryRequest["mode"], nextQuery = query, stopCount?: PlanStopCount) {
    setLoadError(false);
    setQuery(nextQuery);
    if (!arrival) return;
    setRequest({ mode, query: nextQuery, capturedAt: arrival.capturedAt, stopCount });
    setAttempt((current) => current + 1);
  }
  if (Composer && arrival) return <Composer arrival={arrival} routeSearch={routeSearch} entryRequest={request ?? undefined} />;
  return (
    <form id="plan-composer" className="planComposer" noValidate onSubmit={(event) => event.preventDefault()}>
      {requiresFull ? null : (
        <PlanDescribeFirst
          initialQuery={query}
          ready={Boolean(arrival) && (!needsFull || loadError)}
          onQueryChange={setQuery}
          onStopCountChange={setStopCount}
          onSubmit={(nextQuery, stopCount) => open("submit", nextQuery, stopCount)}
          onGuideMeInstead={(stopCount) => open("wizard", query, stopCount)}
        />
      )}
      {needsFull && !loadError ? <p role="status">Opening the plan…</p> : null}
      {loadError ? (
        <p className="planComposer__error" role="alert">
          The plan could not open. Your request is still here.{" "}
          <button type="button" onClick={() => {
            if (request) open(request.mode, query, stopCount ?? request.stopCount);
            else { setLoadError(false); setAttempt((current) => current + 1); }
          }}>Try again</button>
        </p>
      ) : null}
    </form>
  );
}

export default function PlanEntry() {
  const routeSearch = useSearchParams().toString();
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const arrival = useMemo(() => hydrated ? capturePlanEntryArrival() : null, [hydrated]);
  // Keep the field protected until arrival capture resolves which form owns input.
  return <PlanEntryForm arrival={arrival} routeSearch={routeSearch} />;
}
