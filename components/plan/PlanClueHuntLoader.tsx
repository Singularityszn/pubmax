"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import PlanClueHunt from "@/components/plan/PlanClueHunt";
import type { PlanStopDTO } from "@/lib/plan";
import { planClueScopeKey, selectPlanClues, type PlanClue, type PlanClueScope } from "@/lib/planClues";
import { loadPlanClueLegs } from "@/lib/planCluesClient";

import "./planClueHunt.css";

export type PlanClueHuntLoaderProps = PlanClueScope & { stops: readonly PlanStopDTO[] };

function ScopedClueHunt({ planId, stops }: PlanClueHuntLoaderProps) {
  const headingId = useId();
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<"off" | "loading" | "ready" | "unavailable">("off");
  const [clues, setClues] = useState<readonly PlanClue[]>([]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  function turnOff() {
    controllerRef.current?.abort();
    setClues([]);
    setState("off");
  }

  async function enable() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState("loading");
    const legs = await loadPlanClueLegs(stops, controller.signal);
    if (controller.signal.aborted) return;
    const next = selectPlanClues(stops.map((stop) => stop.venueId), legs);
    setClues(next);
    setState(next.length ? "ready" : "unavailable");
  }

  if (state === "ready") return <PlanClueHunt planId={planId} clues={clues} onDisable={turnOff} />;

  return (
    <section className="planClues" aria-labelledby={headingId}>
      <h3 id={headingId}>London clue hunt</h3>
      <p>Try a few questions about London landmarks near your walk. Your stops stay the same.</p>
      <p className="planClues__note">Optional and just for you. We check the walking route when you turn clues on. We do not use your location.</p>
      {state === "unavailable" ? <p role="status">No sourced clues are available for this walk. Carry on with your route.</p> : null}
      {state === "loading" ? <p role="status">Checking for clues beside your walking route.</p> : null}
      <div className="planClues__actions">
        <Button variant="secondary" disabled={state === "loading"} onClick={() => void enable()}>
          {state === "unavailable" ? "Check for clues again" : "Turn clues on"}
        </Button>
        {state === "loading" ? <Button variant="ghost" onClick={turnOff}>Cancel clue check</Button> : null}
      </div>
    </section>
  );
}

/** Only a capability-authorised plan member may receive these props. No bearer token belongs in memberId. */
export default function PlanClueHuntLoader(props: PlanClueHuntLoaderProps) {
  if (!props.memberId || !props.planId || props.stops.length < 2) return null;
  const key = planClueScopeKey(props, props.stops.map((stop) => stop.venueId));
  return <ScopedClueHunt key={key} {...props} />;
}
