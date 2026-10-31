"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PlanState } from "@/lib/plan";
import { tryGetNightArea } from "@/lib/nightAreas";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import { slidingDoorsOptions, type SlidingDoorsKind, type SlidingDoorsOption } from "@/lib/slidingDoors";
import { Button } from "@/components/ui/button";
import "./slidingDoors.css";

type Props = {
  planState: PlanState;
  memberToken: string;
  onProposalCreated(): void;
  ownerKey?: string;
};

const TITLES: Record<SlidingDoorsKind, string> = {
  original: "Your saved route",
  "shorter-walk": "A shorter walk",
  "plot-twist": "Plot twist",
};

function generationBody(state: PlanState, kind: "shorter-walk" | "plot-twist") {
  const context = state.context!;
  const cityId = context.nightArea ? tryGetNightArea(context.nightArea)?.cityId : null;
  return {
    context: {
      ...context,
      stopCount: state.stops.length,
      ...(kind === "shorter-walk" ? { transportConstraints: [...new Set([...context.transportConstraints, "walking"])] }
        : { atmosphere: [...new Set([...context.atmosphere, "historic"])] }),
    },
    ...(cityId ? { cityId } : {}),
    ...(state.plan.anchorVenueId && state.plan.anchorSource ? {
      anchor: { venueId: state.plan.anchorVenueId, source: state.plan.anchorSource, acceptedArea: null, startsAt: state.plan.startTime },
    } : {}),
  };
}

async function venuePoints(ids: readonly string[], signal: AbortSignal) {
  const entries = await Promise.all(ids.map(async (id) => {
    try {
      const response = await fetch(`/api/venue/${encodeURIComponent(id)}`, { signal });
      if (!response.ok) { discardBody(response); return null; }
      const body = await response.json() as { venue?: { longitude?: unknown; latitude?: unknown } };
      const { longitude, latitude } = body.venue ?? {};
      return typeof longitude === "number" && typeof latitude === "number" && Number.isFinite(longitude) && Number.isFinite(latitude)
        ? [id, [longitude, latitude] as const] as const : null;
    } catch { return null; }
  }));
  return new Map(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}

export default function SlidingDoors(props: Props) {
  return <SlidingDoorsContent key={`${props.planState.plan.id}:${props.memberToken}:${props.ownerKey ?? "device"}`} {...props} />;
}

function SlidingDoorsContent({ planState, memberToken, onProposalCreated }: Props) {
  const headingId = useId();
  const radioName = useId();
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const proposalKey = useRef<string | null>(null);
  const [comparison, setComparison] = useState<{ revision: string; options: SlidingDoorsOption[] } | null>(null);
  const [selected, setSelected] = useState<SlidingDoorsKind>("original");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const revision = String(planState.plan.routeRevision ?? 1);
  const options = comparison?.revision === revision ? comparison.options : [];
  const choice = options.find((option) => option.kind === selected);
  const ended = ["completed", "abandoned"].includes(planState.plan.status ?? "draft");

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);

  async function compare() {
    if (inFlight.current || !planState.context || ended) return;
    inFlight.current = true;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true); setMessage(""); setError(""); setComparison(null); setSelected("original");
    try {
      const generated: Array<{ kind: "shorter-walk" | "plot-twist"; body: unknown }> = [];
      for (const kind of ["shorter-walk", "plot-twist"] as const) {
        const response = await fetch("/api/plans/generate", {
          method: "POST", signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(generationBody(planState, kind)),
        });
        const body = await response.json();
        if (response.ok) generated.push({ kind, body });
        else if (generated.length === 0 && kind === "plot-twist") throw new Error(errorMessageFrom(body, "No other route could be checked right now."));
      }
      const ids = new Set(planState.stops.map((stop) => stop.venueId));
      for (const candidate of generated) {
        const body = candidate.body as { stops?: Array<{ venueId?: unknown }> };
        for (const stop of body.stops ?? []) if (typeof stop.venueId === "string") ids.add(stop.venueId);
      }
      const points = await venuePoints([...ids], controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      const next = slidingDoorsOptions(planState, generated, points);
      proposalKey.current = crypto.randomUUID();
      setComparison({ revision, options: next });
      setMessage(next.length === 1 ? "Your saved route is still the one to keep. No different route passed these checks." : "Compare the routes. Your saved route stays as it is until the host accepts a proposal.");
    } catch (caught) {
      if (!controller.signal.aborted && alive.current) setError(offlineOrMessage(caught instanceof Error ? caught.message : "Could not compare routes. Try again."));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function propose() {
    if (inFlight.current || !choice || choice.kind === "original" || ended) return;
    inFlight.current = true;
    setBusy(true); setMessage(""); setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(planState.plan.id)}/proposals`, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}`, "idempotency-key": proposalKey.current ??= crypto.randomUUID() },
        body: JSON.stringify({
          reason: choice.kind === "shorter-walk" ? "A shorter walk between these pubs, based on straight-line estimates." : "Plot twist: try a route with more pub history.",
          expectedRouteRevision: Number(revision), stops: choice.stops, resolvedConstraintIds: [],
          groundingProof: choice.groundingProof, operationKey: choice.operationKey,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status === 410) setComparison(null);
        throw new Error(errorMessageFrom(body, "The route was not changed. Compare again and retry."));
      }
      if (!alive.current) return;
      setComparison(null);
      setMessage("Proposal sent. The crew can vote below. Only the host can accept it.");
      onProposalCreated();
    } catch (caught) {
      if (!controller.signal.aborted && alive.current) setError(offlineOrMessage(caught instanceof Error ? caught.message : "Could not send this proposal."));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  if (ended || !planState.context) return null;

  return (
    <section className="slidingDoors" aria-labelledby={headingId}>
      <div className="slidingDoors__heading">
        <div><h4 id={headingId}>How else could tonight go?</h4><p>Keep this route, try less walking, or add some pub history.</p></div>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void compare()}>{busy ? "Checking routes…" : options.length ? "Compare again" : "Compare routes"}</Button>
      </div>
      <p>The host checks the crew&rsquo;s must-haves before accepting a change.</p>
      {options.length ? <fieldset className="slidingDoors__choices"><legend>Choose a route to discuss</legend>
        <div className="slidingDoors__grid">{options.map((option) => <label className="slidingDoors__option" key={option.kind} data-selected={selected === option.kind}>
          <span className="slidingDoors__name"><input type="radio" name={radioName} value={option.kind} checked={selected === option.kind} onChange={() => setSelected(option.kind)} /><strong>{TITLES[option.kind]}</strong></span>
          {option.kind === "plot-twist" ? <p>More weight on pubs with a recorded history.</p> : null}
          <ol>{option.stops.map((stop) => <li key={stop.venueId}>{stop.venueName}</li>)}</ol>
          <p className="slidingDoors__distance">{option.straightLineKm === null ? "Walk distance not known." : `${option.straightLineKm.toFixed(1)} km between pubs, straight-line estimate.`}</p>
          <small>Drink, food and travel totals are not known here.</small>
        </label>)}</div>
        {choice && choice.kind !== "original" ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void propose()}>Send route for crew review</Button> : null}
      </fieldset> : null}
      {comparison && comparison.revision !== revision ? <p role="status">The saved route changed. Compare again before sending a proposal.</p> : null}
      {message ? <p className="slidingDoors__message" role="status">{message}</p> : null}
      {error ? <p className="slidingDoors__error" role="alert">{error}</p> : null}
    </section>
  );
}
