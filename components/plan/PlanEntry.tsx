"use client";

import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { parsePlanDescribeFromSearch } from "@/lib/planOccasion";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import { initialComposerDraftFields, readPlanComposerRecovery, type PlanComposerRecovery } from "@/components/plan/PlanComposerRecovery";
import type { PlanStopCount } from "@/lib/planStopCount";
import type FullPlanComposer from "@/components/plan/PlanComposer";

export type PlanEntryRequest = {
  mode: "wizard" | "submit";
  query: string;
  startTime: string;
  stopCount?: PlanStopCount;
};

function PlanEntryForm({ recovery }: { recovery: PlanComposerRecovery | null }) {
  const [query, setQuery] = useState("");
  const [stopCount, setStopCount] = useState<PlanStopCount>();
  const [startTime] = useState(initialComposerDraftFields(null, null).startTime);
  const [request, setRequest] = useState<PlanEntryRequest | null>(null);
  const [Composer, setComposer] = useState<typeof FullPlanComposer | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pathname = usePathname();
  const [liveUrlRequiresFull, setLiveUrlRequiresFull] = useState(false);
  const requiresFull = Boolean(recovery?.requiresFullComposer) || liveUrlRequiresFull;
  useLayoutEffect(() => {
    if (!recovery || !parsePlanDescribeFromSearch(window.location.search)) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setLiveUrlRequiresFull(true); });
    return () => { cancelled = true; };
  }, [recovery, pathname]);
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
    setRequest({ mode, query: nextQuery, startTime, stopCount });
    setAttempt((current) => current + 1);
  }
  if (Composer && recovery) return <Composer recovery={recovery} entryRequest={request ?? undefined} />;
  return (
    <form id="plan-composer" className="planComposer" noValidate onSubmit={(event) => event.preventDefault()}>
      {requiresFull ? null : (
        <PlanDescribeFirst
          initialQuery={query}
          ready={Boolean(recovery) && (!needsFull || loadError)}
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
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const recovery = useMemo(() => hydrated ? readPlanComposerRecovery() : null, [hydrated]);
  // The server field is protected until this new, recovered form owns input.
  return <PlanEntryForm key={hydrated ? "hydrated" : "server"} recovery={recovery} />;
}
