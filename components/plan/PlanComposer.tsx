"use client";

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { laneSourceFromSearch, trackEvent } from "@/lib/analytics";
import { CREW_NAME_MAX } from "@/lib/crew";
import { isNightAreaRouteReady, NIGHT_AREAS, type NightArea } from "@/lib/nightAreas";
import { PLAN_TEMPLATES, type PlanTemplate } from "@/lib/planTemplates";
import { cleanNightContext, type NightContext } from "@/lib/nightPlanning";
import { parsePlanDraft, PLAN_DRAFT_KEY } from "@/lib/planDraft";
import { writePlanCapability } from "@/lib/planSessionCapability";
import { markPalRouteActivation } from "@/lib/pubPal";

export type RouteRevision = string | number;
export type RouteAlternative = { venueId: string; venueName: string };
export type DraftStop = {
  key: number;
  venueId: string;
  venueName: string;
  reason?: string;
  alternatives: RouteAlternative[];
};
type VenueOption = { id: string; name: string; address?: string };

export const PLAN_ROUTE_DRAFT_KEY = "pubmaxx:plan-route-draft:v1";

export type StoredRouteDraft = {
  stops: DraftStop[];
  nightContext: NightContext | null;
  routeRevision: RouteRevision | null;
  routeStale: boolean;
};

function cleanRouteRevision(value: unknown): RouteRevision | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return null;
}

/** Read the revision wherever the canonical PlanState places it. */
export function routeRevisionFromState(value: unknown): RouteRevision | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { routeRevision?: unknown; revision?: unknown; plan?: unknown };
  const direct = cleanRouteRevision(row.routeRevision ?? row.revision);
  if (direct !== null) return direct;
  if (row.plan && typeof row.plan === "object") {
    const plan = row.plan as { routeRevision?: unknown; revision?: unknown };
    return cleanRouteRevision(plan.routeRevision ?? plan.revision);
  }
  return null;
}

function cleanRouteAlternative(value: unknown): RouteAlternative | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { venueId?: unknown; venueName?: unknown; name?: unknown };
  const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
  const venueName = typeof row.venueName === "string"
    ? row.venueName.trim()
    : typeof row.name === "string" ? row.name.trim() : "";
  return venueId && venueName ? { venueId, venueName } : null;
}

function routeAlternatives(value: unknown): RouteAlternative[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const cleaned = cleanRouteAlternative(candidate);
    return cleaned ? [cleaned] : [];
  });
}

/** Keep the generator's alternatives attached to their stop for preview swaps. */
export function routeStopsFromGenerated(value: unknown, alternativePool?: unknown): DraftStop[] {
  if (!Array.isArray(value)) return [];
  const candidates = value.slice(0, 3);
  const currentVenueIds = new Set(candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as { venueId?: unknown };
    return typeof row.venueId === "string" && row.venueId.trim() ? [row.venueId.trim()] : [];
  }));
  const pool = routeAlternatives(alternativePool).filter((alternative, index, all) => (
    !currentVenueIds.has(alternative.venueId)
    && all.findIndex((candidate) => candidate.venueId === alternative.venueId) === index
  ));
  return candidates.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as {
      venueId?: unknown;
      venueName?: unknown;
      name?: unknown;
      reason?: unknown;
      alternatives?: unknown;
      options?: unknown;
    };
    const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
    const venueName = typeof row.venueName === "string"
      ? row.venueName.trim()
      : typeof row.name === "string" ? row.name.trim() : "";
    if (!venueId || !venueName) return [];
    const nested = routeAlternatives(row.alternatives ?? row.options);
    const alternatives = [...nested, ...pool].filter((alternative, alternativeIndex, all) => (
      !currentVenueIds.has(alternative.venueId)
      && all.findIndex((candidate) => candidate.venueId === alternative.venueId) === alternativeIndex
    ));
    return [{
      key: index + 1,
      venueId,
      venueName,
      ...(typeof row.reason === "string" && row.reason.trim() ? { reason: row.reason.trim() } : {}),
      alternatives,
    }];
  });
}

/** Cycle to the next grounded alternative and keep the old venue swappable. */
export function swapDraftStop(stop: DraftStop, excludedVenueIds: ReadonlySet<string> = new Set()): DraftStop {
  const nextIndex = stop.alternatives.findIndex((alternative) => !excludedVenueIds.has(alternative.venueId));
  if (nextIndex < 0) return stop;
  const next = stop.alternatives[nextIndex];
  const remaining = stop.alternatives.filter((_, index) => index !== nextIndex);
  if (!next) return stop;
  return {
    ...stop,
    venueId: next.venueId,
    venueName: next.venueName,
    alternatives: [
      ...remaining,
      { venueId: stop.venueId, venueName: stop.venueName },
    ],
  };
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function nightContextChanged(before: NightContext | null, after: NightContext | null): boolean {
  if (!before || !after) return before !== after;
  return before.nightArea !== after.nightArea
    || before.daypart !== after.daypart
    || before.partyType !== after.partyType
    || before.groupSize !== after.groupSize
    || before.budget !== after.budget
    || before.budgetLimitPence !== after.budgetLimitPence
    || before.zeroProof !== after.zeroProof
    || !sameList(before.atmosphere, after.atmosphere)
    || !sameList(before.foodNeeds, after.foodNeeds)
    || !sameList(before.accessibility, after.accessibility)
    || !sameList(before.transportConstraints, after.transportConstraints);
}

export function parsePlanRouteDraft(raw: string | null): StoredRouteDraft | null {
  if (!raw || raw.length > 30_000) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredRouteDraft>;
    const stops = routeStopsFromGenerated(value.stops);
    if (!stops.length) return null;
    return {
      stops,
      nightContext: cleanNightContext(value.nightContext) ?? null,
      routeRevision: cleanRouteRevision(value.routeRevision),
      routeStale: value.routeStale === true,
    };
  } catch {
    return null;
  }
}

export type NightAreaSelectorGroup = {
  label: "Higher confidence" | "Plan with warnings";
  disabled: boolean;
  areas: NightArea[];
};

export function nightAreaSelectorGroups(now = new Date()): NightAreaSelectorGroup[] {
  return [
    {
      label: "Higher confidence",
      disabled: false,
      areas: NIGHT_AREAS.filter((area) => isNightAreaRouteReady(area, now)),
    },
    {
      label: "Plan with warnings",
      disabled: false,
      areas: NIGHT_AREAS.filter((area) => !isNightAreaRouteReady(area, now)),
    },
  ];
}

export function nightAreaOptionLabel(area: NightArea, disabled: boolean): string {
  return disabled || !isNightAreaRouteReady(area) ? `${area.name} - plan with evidence gaps` : area.name;
}

export function nightAreaMapHref(area: NightArea): string {
  return `/map?q=${encodeURIComponent(area.name)}`;
}

export function errorMessageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const structuredError = error as { code?: unknown; message?: unknown };
    const message = structuredError.message;
    if (
      structuredError.code === "NIGHT_AREA_ROUTE_NOT_READY" ||
      structuredError.code === "DISTRICT_ROUTE_NOT_READY"
    ) {
      const payload = body as {
        nightArea?: { id?: unknown };
        district?: { id?: unknown };
      };
      const areaId = payload.nightArea?.id ?? payload.district?.id;
      const area = NIGHT_AREAS.find((candidate) => candidate.slug === areaId);
      const areaName = area?.name ?? "This Night Area";
      const serverMessage = typeof message === "string" && message.trim()
        ? message.trim()
        : "We're still checking this Night Area before planning a Crawl Route.";
      return `${areaName} is not ready for route planning yet. ${serverMessage} Choose a ready area to continue.`;
    }
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

type NightAreaCoverageTone = "ready" | "review" | "capture" | "discovery" | "paused";

export type NightAreaCoverageSummary = {
  label: string;
  detail: string;
  tone: NightAreaCoverageTone;
};

const GATE_LABELS: Partial<Record<NightArea["missingEvidence"][number], string>> = {
  venue_density: "venue density",
  identity_conflict: "venue identity checks",
  opening_hours: "opening hours",
  price_coverage: "price coverage",
  amenity_coverage: "amenity coverage",
  transport_anchor: "a transport anchor",
  route_feasibility: "route feasibility",
  terminal_get_home: "the route home",
  terminal_food: "a food ending",
  stale_review: "a fresh review",
  unreviewed_source: "reviewed sources",
};

function formatGateCode(code: NightArea["missingEvidence"][number]): string {
  return GATE_LABELS[code] ?? code.replaceAll("_", " ");
}

export function nightAreaCoverageSummary(
  area: NightArea,
  now = new Date(),
): NightAreaCoverageSummary {
  if (isNightAreaRouteReady(area, now)) {
    return {
      label: "Route-ready",
      detail: "Crawl Routes can be planned here now.",
      tone: "ready",
    };
  }

  const missing = area.missingEvidence.slice(0, 2).map(formatGateCode);
  const remaining = area.missingEvidence.length - missing.length;
  const missingEvidenceDetail = missing.length > 0
    ? `missing ${missing.join(" and ")}${remaining > 0 ? ` + ${remaining} more` : ""}.`
    : "Coverage is being checked before route planning opens.";

  switch (area.coverageStatus) {
    case "captured":
      return { label: "Plan with warnings", detail: `Captured coverage, ${missingEvidenceDetail}`, tone: "capture" };
    case "discovered":
      return { label: "Low confidence", detail: "Evidence capture has not started. The route stays editable.", tone: "discovery" };
    case "reviewed":
      return { label: "Plan with warnings", detail: `Reviewed coverage, ${missingEvidenceDetail}`, tone: "review" };
    case "paused":
      return { label: "Review expired", detail: "Planning remains available with low confidence until evidence is refreshed.", tone: "paused" };
    default:
      return { label: "Plan with warnings", detail: `Review in progress, ${missingEvidenceDetail}`, tone: "review" };
  }
}

function formatCoverageDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

/** Keep the evidence window visible anywhere coverage is presented. */
export function nightAreaCoverageMeta(area: NightArea, now = new Date()): string {
  const reviewed = formatCoverageDate(area.lastReviewedAt);
  const expires = formatCoverageDate(area.reviewExpiresAt);
  if (!reviewed) return "No reviewed snapshot yet.";
  if (!expires) return `Last checked ${reviewed}.`;
  const expiry = Date.parse(area.reviewExpiresAt ?? "");
  if (Number.isFinite(expiry) && expiry <= now.getTime()) {
    return `Last checked ${reviewed} · review expired ${expires}.`;
  }
  return `Last checked ${reviewed} · review through ${expires}.`;
}

function nextEvening(): string {
  const date = new Date();
  date.setMinutes(Math.ceil((date.getMinutes() + 15) / 15) * 15, 0, 0);
  if (date.getHours() < 17) date.setHours(18, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function PlanComposerForm({
  recoveredDraft,
  recoveredRouteDraft,
}: {
  recoveredDraft: ReturnType<typeof parsePlanDraft>;
  recoveredRouteDraft: StoredRouteDraft | null;
}) {
  const router = useRouter();
  const areaGroups = nightAreaSelectorGroups();
  const readyAreas = areaGroups[0]?.areas ?? [];
  const areasInProgress = areaGroups[1]?.areas ?? [];
  const [title, setTitle] = useState(recoveredDraft?.title ?? "Tonight, sorted");
  const [creatorName, setCreatorName] = useState(recoveredDraft?.creatorName ?? "");
  const [startTime, setStartTime] = useState(recoveredDraft?.startTime ?? nextEvening);
  const [stops, setStops] = useState<DraftStop[]>(recoveredRouteDraft?.stops ?? recoveredDraft?.stops.map((stop) => ({
    ...stop,
    alternatives: [],
  })) ?? [
    { key: 1, venueId: "", venueName: "", alternatives: [] },
    { key: 2, venueId: "", venueName: "", alternatives: [] },
  ]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [conciergeQuery, setConciergeQuery] = useState(recoveredDraft?.conciergeQuery ?? "");
  const [conciergeNote, setConciergeNote] = useState("");
  const [nightContext, setNightContext] = useState<NightContext | null>(recoveredRouteDraft?.nightContext ?? null);
  const [routeRevision, setRouteRevision] = useState<RouteRevision | null>(recoveredRouteDraft?.routeRevision ?? null);
  const [routeStale, setRouteStale] = useState(recoveredRouteDraft?.routeStale ?? false);
  const [sorting, setSorting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [routeStatus, setRouteStatus] = useState(
    recoveredRouteDraft
      ? recoveredRouteDraft.routeStale
        ? "Recovered a route that needs refreshing before it can be locked."
        : "Recovered your route preview. Nothing is published until you lock it in."
      : "",
  );

  const completeStops = useMemo(
    () => stops.filter((stop) => stop.venueName.trim() && stop.venueId.trim()),
    [stops],
  );

  useEffect(() => {
    let active = true;
    fetch("/data/venues_slim.json")
      .then((response) => response.json())
      .then((rows: VenueOption[]) => { if (active && Array.isArray(rows)) setVenues(rows); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (recoveredDraft) trackEvent("draft_recovered", { kind: "plan", surface: "plan" });
  }, [recoveredDraft]);

  useEffect(() => {
    try {
      sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
        title,
        creatorName,
        startTime,
        conciergeQuery,
        stops,
      }));
    } catch {
      // Storage can be unavailable in private mode; planning still works in-memory.
    }
  }, [title, creatorName, startTime, conciergeQuery, stops]);

  useEffect(() => {
    if (!nightContext && routeRevision === null && !stops.some((stop) => stop.alternatives.length > 0)) return;
    try {
      localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({
        stops,
        nightContext,
        routeRevision,
        routeStale,
      } satisfies StoredRouteDraft));
    } catch {
      // A blocked localStorage should not make the route editor unusable.
    }
  }, [nightContext, routeRevision, routeStale, stops]);

  function chooseVenue(key: number, venueName: string) {
    const match = venues.find((venue) => venue.name.toLocaleLowerCase() === venueName.trim().toLocaleLowerCase());
    setStops((current) => current.map((stop) => stop.key === key
      ? { ...stop, venueName, venueId: match?.id ?? "", alternatives: [] }
      : stop));
    setRouteStatus("Stop edited in the route preview. Review it before locking.");
  }

  function updateNightContext(patch: Partial<NightContext>) {
    if (!nightContext) return;
    const next = { ...nightContext, ...patch };
    if (nightContextChanged(nightContext, next)) {
      setRouteStale(true);
      setRouteStatus("Route needs refreshing after that context change.");
    }
    setNightContext(next);
  }

  function swapStop(key: number) {
    const current = stops.find((stop) => stop.key === key);
    if (!current?.alternatives.length) return;
    const usedByOtherStops = new Set(stops.filter((stop) => stop.key !== key).map((stop) => stop.venueId));
    const next = swapDraftStop(current, usedByOtherStops);
    if (next === current) {
      setRouteStatus("No distinct grounded alternative is available for that stop yet.");
      return;
    }
    setStops((existing) => existing.map((stop) => stop.key === key ? next : stop));
    setRouteStatus(`Stop ${stops.findIndex((stop) => stop.key === key) + 1} swapped to ${next.venueName}.`);
  }

  async function sortWithConcierge() {
    if (!conciergeQuery.trim() && !nightContext) return;
    setSorting(true);
    setError("");
    setRouteStatus("Refreshing the route, checking the updated context and grounded stops.");
    try {
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(conciergeQuery.trim() ? { query: conciergeQuery } : {}), ...(nightContext ? { context: nightContext } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFromBody(body, "PUBMAXX could not sort this one."));
      const suggested = routeStopsFromGenerated(body.stops, body.alternatives);
      if (!suggested.length) throw new Error("No grounded venues matched that request. Try a nearby area or a broader mood.");
      setStops(suggested);
      if (body.inferredContext) setNightContext(body.inferredContext as NightContext);
      setRouteRevision(routeRevisionFromState(body));
      setRouteStale(false);
      markPalRouteActivation();
      setConciergeNote("Three grounded stops, shaped by the editable context below.");
      setRouteStatus("Route refreshed. Review the preview, then lock it in when it feels right.");
      if (body.inferredContext) {
        trackEvent("night_description_submitted", { area: body.inferredContext.nightArea, daypart: body.inferredContext.daypart });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The concierge could not sort this one.";
      setError(message);
      setRouteStale(true);
      setRouteStatus(`The previous route is still here. ${message}`);
    } finally {
      setSorting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creatorName.trim() || !startTime || completeStops.length === 0) {
      setError("Add your name, a start time, and choose at least one venue from the list.");
      return;
    }
    if (new Set(completeStops.map((stop) => stop.venueId)).size !== completeStops.length) {
      setError("Choose distinct venues for every stop.");
      return;
    }
    if (nightContext && completeStops.length !== 3) {
      setError("A generated Crawl Route needs exactly three grounded stops before you lock it in.");
      return;
    }
    if (routeStale) {
      setError("Refresh the route before locking it in. Your previous preview is still safe.");
      setRouteStatus("The route is still a preview because its context changed. Refresh it before locking.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          creatorName,
          startTime: new Date(startTime).toISOString(),
          stops: completeStops.map(({ venueId, venueName }) => ({ venueId, venueName })),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body?.plan?.plan?.id) {
        throw new Error(body?.error || "The plan could not be created.");
      }
      // lane_to_plan only counts creations with lane provenance (?src=…, set
      // by lane surfaces such as the W1 Tonight lane). window.location is read
      // at submit time — not via useSearchParams — so this client component
      // needs no Suspense boundary on the server-rendered /plan page. Without
      // a known src the event stays silent: honest zero > invented signal.
      const laneSource = laneSourceFromSearch(window.location.search);
      if (laneSource) {
        trackEvent("lane_to_plan", { source: laneSource, stops: completeStops.length });
      }
      trackEvent("plan_created", { count: completeStops.length });
      if (body.memberToken) {
        const planId = body.plan.plan.id as string;
        writePlanCapability(planId, { token: body.memberToken, collaborationAuthorized: true });
        sessionStorage.setItem(`pubmaxx:plan-creator-token:v1:${planId}`, body.memberToken);
        const metadataResponse = await fetch(`/api/plans/${planId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${body.memberToken}`,
          },
          body: JSON.stringify({ status: "ready", ...(nightContext ? { context: nightContext } : {}) }),
        });
        if (!metadataResponse.ok) throw new Error("The route was created, but its Night Context could not be saved. Please try again.");
      }
      try {
        sessionStorage.removeItem(PLAN_DRAFT_KEY);
        localStorage.removeItem(PLAN_ROUTE_DRAFT_KEY);
      } catch { /* best effort */ }
      router.push(`/plan/${body.plan.plan.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The plan could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="planComposer" onSubmit={submit}>
      <section className="planComposer__concierge" aria-labelledby="plan-concierge-title" aria-busy={sorting}>
        <div>
          <span className="planPage__eyebrow">Describe your night</span>
          <h2 id="plan-concierge-title">Say what you need. Get three useful stops.</h2>
        </div>
        <div className="planComposer__conciergeInput">
          <label className="planComposer__srOnly" htmlFor="plan-concierge-query">Describe the night</label>
          <input id="plan-concierge-query" aria-describedby="plan-concierge-status" value={conciergeQuery} onChange={(event) => setConciergeQuery(event.target.value)} placeholder="Quiet-ish in Clapham, 4 of us, not pricey" maxLength={500} />
          <button type="button" onClick={sortWithConcierge} disabled={sorting || !conciergeQuery.trim()} aria-busy={sorting}>{sorting ? "Planning…" : "Plan my night"}</button>
        </div>
        <p id="plan-concierge-status" className="planComposer__conciergeStatus" role="status" aria-live="polite">
          {sorting ? "Planning your night, checking confidence and finding grounded stops." : conciergeNote}
        </p>
        {routeStale ? (
          <div className="planComposer__routeStale" role="group" aria-labelledby="plan-route-stale-title">
            <div>
              <strong id="plan-route-stale-title">This route needs a refresh</strong>
              <span>Context changed, so the preview may no longer fit the night you described.</span>
            </div>
            <button
              type="button"
              className="planComposer__regenerate"
              onClick={sortWithConcierge}
              disabled={sorting || (!conciergeQuery.trim() && !nightContext)}
              aria-busy={sorting}
            >
              {sorting ? "Refreshing…" : "Regenerate route"}
            </button>
          </div>
        ) : null}
        {nightContext ? (
          <fieldset className="planComposer__context">
            <legend>What PUBMAXX understood. Edit anything.</legend>
            <p id="plan-context-note" className="planComposer__contextNote">Every listed area can be planned. Evidence gaps stay visible so you can judge the route.</p>
            <label htmlFor="plan-context-area">Area<select id="plan-context-area" aria-describedby="plan-context-note plan-route-status" value={nightContext.nightArea ?? ""} onChange={(event) => updateNightContext({ nightArea: event.target.value as NightContext["nightArea"] })}>
              {areaGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.areas.map((area) => (
                    <option key={area.slug} value={area.slug}>
                      {nightAreaOptionLabel(area, group.disabled)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select></label>
            <label htmlFor="plan-context-time">Time<select id="plan-context-time" aria-describedby="plan-route-status" value={nightContext.daypart} onChange={(event) => updateNightContext({ daypart: event.target.value as NightContext["daypart"] })}>
              <option value="daytime">Daytime</option><option value="after_work">After work</option><option value="evening">Evening</option><option value="late_night">Late night</option><option value="get_home">Get home</option>
            </select></label>
            <label htmlFor="plan-context-group">Group<select id="plan-context-group" aria-describedby="plan-route-status" value={nightContext.partyType} onChange={(event) => updateNightContext({ partyType: event.target.value as NightContext["partyType"] })}>
              <option value="solo">Solo</option><option value="friends">Friends</option><option value="work">Work</option>
            </select></label>
            <label htmlFor="plan-context-people">People<input id="plan-context-people" aria-describedby="plan-route-status" type="number" min="1" max="30" value={nightContext.groupSize ?? ""} onChange={(event) => updateNightContext({ groupSize: event.target.value ? Number(event.target.value) : null })} /></label>
            <label htmlFor="plan-context-budget">Budget<select id="plan-context-budget" aria-describedby="plan-route-status" value={nightContext.budget} onChange={(event) => updateNightContext({ budget: event.target.value as NightContext["budget"] })}>
              <option value="value">Value</option><option value="standard">Standard</option><option value="treat">Treat</option>
            </select></label>
            <label htmlFor="plan-context-budget-limit">Max per person<input id="plan-context-budget-limit" aria-describedby="plan-route-status" type="number" inputMode="decimal" min="5" max="500" step="1" value={nightContext.budgetLimitPence === null ? "" : nightContext.budgetLimitPence / 100} onChange={(event) => updateNightContext({ budgetLimitPence: event.target.value ? Math.round(Number(event.target.value) * 100) : null })} /></label>
            <label htmlFor="plan-context-zero-proof">Drinks<select id="plan-context-zero-proof" aria-describedby="plan-route-status" value={nightContext.zeroProof ? "zero-proof" : "any"} onChange={(event) => updateNightContext({ zeroProof: event.target.value === "zero-proof" })}>
              <option value="any">Any drinks</option><option value="zero-proof">0.0 options</option>
            </select></label>
          </fieldset>
        ) : null}
      </section>
      <section className="planComposer__templates" aria-labelledby="plan-templates-title">
        <h2 id="plan-templates-title">Need a starting point?</h2>
        <p className="planComposer__templatesLead">
          Optional occasion prompts fill the description — still editable.
        </p>
        <div className="planComposer__templateRow">
          {PLAN_TEMPLATES.map((template: PlanTemplate) => (
            <button
              key={template.id}
              type="button"
              className="planComposer__template"
              title={template.blurb}
              onClick={() => {
                setTitle(template.title);
                setConciergeQuery(template.conciergeQuery);
                setConciergeNote(template.blurb);
              }}
            >
              {template.label}
            </button>
          ))}
        </div>
      </section>
      <section className="planComposer__coverage" aria-labelledby="plan-coverage-title">
        <details>
          <summary>
            <span id="plan-coverage-title">Night Area coverage</span>
            <span className="planComposer__coverageMeta">
              {readyAreas.length} higher confidence · {areasInProgress.length} with warnings
            </span>
          </summary>
          <p className="planComposer__coverageIntro">
            Browse the current London capture state. Higher-confidence areas have completed the evidence gate. Every area can still produce an editable route, with missing evidence shown before you rely on it.
          </p>
          <div className="planComposer__coverageGroups">
            <section aria-labelledby="plan-coverage-ready">
              <h3 id="plan-coverage-ready">Higher-confidence planning</h3>
              <ul>
                {readyAreas.map((area) => {
                  const summary = nightAreaCoverageSummary(area);
                  return (
                    <li key={area.slug} data-tone={summary.tone} data-coverage-status={area.coverageStatus}>
                      <div>
                        <strong>{area.name}</strong>
                        <small>{summary.detail}</small>
                        <small className="planComposer__coverageMetaLine">{nightAreaCoverageMeta(area)}</small>
                      </div>
                      <div className="planComposer__coverageActions">
                        <span>{summary.label}</span>
                        <Link className="planComposer__coverageMapLink" href={nightAreaMapHref(area)} aria-label={`Explore ${area.name} pubs on the map`}>Explore map</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section aria-labelledby="plan-coverage-progress">
              <h3 id="plan-coverage-progress">Plan with warnings</h3>
              <ul>
                {areasInProgress.map((area) => {
                  const summary = nightAreaCoverageSummary(area);
                  return (
                    <li key={area.slug} data-tone={summary.tone} data-coverage-status={area.coverageStatus}>
                      <div>
                        <strong>{area.name}</strong>
                        <small>{summary.detail}</small>
                        <small className="planComposer__coverageMetaLine">{nightAreaCoverageMeta(area)}</small>
                      </div>
                      <div className="planComposer__coverageActions">
                        <span>{summary.label}</span>
                        <Link className="planComposer__coverageMapLink" href={nightAreaMapHref(area)} aria-label={`Explore ${area.name} pubs on the map`}>Explore map</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </details>
      </section>
      <div className="planComposer__field planComposer__field--wide">
        <label htmlFor="plan-title">Name the night</label>
        <input id="plan-title" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="planComposer__field">
        <label htmlFor="plan-name">Your name</label>
        <input id="plan-name" autoComplete="name" maxLength={CREW_NAME_MAX} required value={creatorName} onChange={(event) => setCreatorName(event.target.value)} placeholder="Karan" />
      </div>
      <div className="planComposer__field">
        <label htmlFor="plan-time">First pint</label>
        <input id="plan-time" type="datetime-local" required value={startTime} onChange={(event) => setStartTime(event.target.value)} />
      </div>

      <fieldset className="planComposer__stops">
        <legend>The crawl <span className="planComposer__previewLabel">{routeRevision === null ? "Preview" : `Preview · revision ${routeRevision}`}</span></legend>
        <p id="plan-route-status" className="planComposer__routeStatus" role="status" aria-live="polite">
          {routeStatus || (routeStale ? "The route needs refreshing before it can be locked." : "Review the route preview. It stays private until you lock it in.")}
        </p>
        {stops.map((stop, index) => (
          <div className="planComposer__stop" key={stop.key}>
            <span className="planComposer__number" aria-hidden="true">{index + 1}</span>
            <div>
              <label htmlFor={`venue-name-${stop.key}`}>Venue name</label>
              <input id={`venue-name-${stop.key}`} list="plan-venue-options" value={stop.venueName} onChange={(event) => chooseVenue(stop.key, event.target.value)} placeholder="Start typing a pub" />
              {stop.reason ? <small className="planComposer__stopReason">{stop.reason}</small> : null}
            </div>
            <div className="planComposer__stopActions">
              <button
                className="planComposer__swap"
                type="button"
                onClick={() => swapStop(stop.key)}
                disabled={stop.alternatives.length === 0}
                aria-label={stop.alternatives.length > 0 ? `Swap stop ${index + 1}, currently ${stop.venueName}` : `No alternatives for stop ${index + 1}`}
              >
                Swap{stop.alternatives.length > 0 ? ` · ${stop.alternatives.length}` : ""}
              </button>
              {stops.length > 1 ? (
                <button className="planComposer__remove" type="button" onClick={() => setStops((current) => current.filter((item) => item.key !== stop.key))} aria-label={`Remove stop ${index + 1}`}>Remove</button>
              ) : null}
            </div>
          </div>
        ))}
        <datalist id="plan-venue-options">
          {venues.map((venue) => <option key={venue.id} value={venue.name}>{venue.address}</option>)}
        </datalist>
        <button className="planComposer__add" type="button" onClick={() => setStops((current) => [...current, { key: Math.max(0, ...current.map((stop) => stop.key)) + 1, venueId: "", venueName: "", alternatives: [] }])}>Add another stop</button>
      </fieldset>

      {error ? <p className="planComposer__error" role="alert">{error}</p> : null}
      <button className="planComposer__submit" type="submit" disabled={submitting || sorting}>{submitting ? "Locking it in…" : "Lock it in"}</button>
      <p className="planComposer__trust">Anyone with the link can see the plan. Joining only asks for a name.</p>
    </form>
  );
}

export default function PlanComposer() {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const recoveredDraft = useMemo(() => {
    if (!hydrated) return null;
    try { return parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY)); } catch { return null; }
  }, [hydrated]);
  const recoveredRouteDraft = useMemo(() => {
    if (!hydrated) return null;
    try { return parsePlanRouteDraft(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)); } catch { return null; }
  }, [hydrated]);
  return <PlanComposerForm key={hydrated ? "hydrated" : "server"} recoveredDraft={recoveredDraft} recoveredRouteDraft={recoveredRouteDraft} />;
}
