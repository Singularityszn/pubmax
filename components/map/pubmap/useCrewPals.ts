"use client";

import { useEffect, useState } from "react";

import { isPlanActiveNow, readActivePlan, subscribeActivePlan } from "@/lib/activePlan";
import { crewPalsFromBody, type CrewPal } from "@/lib/crewPals";

// Pals walk together: the opted-in Pals of the crew of the plan that is on
// tonight, read once per plan from GET /api/plans/[id]/pals. The plan's own
// HttpOnly session rides the request (its cookie path is /api/plans/<id>), so
// only a member learns anything; a preview, a failure or no plan is no crew.

const NO_CREW: readonly CrewPal[] = [];

export function useCrewPals(): readonly CrewPal[] {
  const [pals, setPals] = useState<readonly CrewPal[]>(NO_CREW);

  useEffect(() => {
    let active = true;
    let loadedPlanId = "";
    let controller: AbortController | null = null;

    const load = () => {
      const ref = readActivePlan();
      if (!ref || !isPlanActiveNow(ref, Date.now())) {
        controller?.abort();
        loadedPlanId = "";
        if (active) setPals(NO_CREW);
        return;
      }
      if (ref.id === loadedPlanId) return;
      loadedPlanId = ref.id;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      if (active) setPals(NO_CREW);
      fetch(`/api/plans/${ref.id}/pals`, { cache: "no-store", signal: request.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: unknown) => {
          if (active && controller === request) setPals(crewPalsFromBody(body));
        })
        .catch(() => {
          // No crew Pals is the honest answer to a failed read.
        });
    };

    load();
    const unsubscribe = subscribeActivePlan(load);
    return () => {
      active = false;
      controller?.abort();
      unsubscribe();
    };
  }, []);

  return pals;
}
