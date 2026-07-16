"use client";

import { Mic, MicOff, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useTransientSpeechInput } from "@/components/plan/useTransientSpeechInput";
import type { CityId } from "@/lib/cities";
import { getNightAreasForCity, type NightAreaSlug } from "@/lib/nightAreas";
import { inferNightContext, type NightContext } from "@/lib/nightPlanning";
import type { PlanBudgetSummary, PlanningConfidence } from "@/lib/planIntelligence";

type GeneratedStop = { venueId: string; venueName: string };

export type GeneratedMobilePlan = {
  stops: GeneratedStop[];
  context: NightContext;
  confidence: PlanningConfidence;
  budget: PlanBudgetSummary;
};

const MOODS = ["quiet", "lively", "historic", "music"] as const;
const PACES = ["easy pace", "balanced pace", "fast pace"] as const;

function responseError(body: unknown): string {
  if (!body || typeof body !== "object") return "PUBMAXX could not build that route.";
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "PUBMAXX could not build that route.";
}

export function MobilePlanActivation({
  cityId,
  initialNightArea,
  onGenerated,
}: {
  cityId: CityId;
  initialNightArea: NightAreaSlug;
  onGenerated: (plan: GeneratedMobilePlan) => void;
}) {
  const areas = getNightAreasForCity(cityId);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<NightAreaSlug>(initialNightArea);
  const [areaTouched, setAreaTouched] = useState(false);
  const [daypart, setDaypart] = useState<NightContext["daypart"]>("evening");
  const [daypartTouched, setDaypartTouched] = useState(false);
  const [mood, setMood] = useState<(typeof MOODS)[number]>("lively");
  const [moodTouched, setMoodTouched] = useState(false);
  const [pace, setPace] = useState<(typeof PACES)[number]>("balanced pace");
  const [paceTouched, setPaceTouched] = useState(false);
  const [budgetLimit, setBudgetLimit] = useState("");
  const [groupSize, setGroupSize] = useState(4);
  const [groupSizeTouched, setGroupSizeTouched] = useState(false);
  const [stepFree, setStepFree] = useState(false);
  const [zeroProof, setZeroProof] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ confidence: PlanningConfidence; budget: PlanBudgetSummary } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const speech = useTransientSpeechInput(query, setQuery);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  async function generate() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const inferred = inferNightContext(query);
      const inferredQuery = inferred.context;
      const queryFields = new Set(inferred.reasons.map((reason) => reason.field));
      const atmosphere = [
        ...(moodTouched ? [mood] : []),
        ...(paceTouched ? [pace] : []),
      ];
      const context: Partial<NightContext> = {
        ...(areaTouched || !inferredQuery.nightArea ? { nightArea: area } : {}),
        ...(daypartTouched || !queryFields.has("daypart") ? { daypart } : {}),
        ...(groupSizeTouched || !queryFields.has("groupSize") ? {
          partyType: groupSize === 1 ? "solo" as const : "friends" as const,
          groupSize,
        } : {}),
        ...(budgetLimit ? {
          budget: Number(budgetLimit) <= 22 ? "value" as const : "standard" as const,
          budgetLimitPence: Math.round(Number(budgetLimit) * 100),
        } : {}),
        ...(zeroProof ? { zeroProof: true } : {}),
        ...(atmosphere.length ? { atmosphere } : {}),
        ...(stepFree ? { accessibility: ["step-free"] } : {}),
      };
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cityId, ...(query.trim() ? { query: query.trim() } : {}), context }),
      });
      const body = await response.json() as {
        stops?: GeneratedStop[];
        inferredContext?: NightContext;
        planningConfidence?: PlanningConfidence;
        budgetSummary?: PlanBudgetSummary;
        error?: unknown;
      };
      if (!response.ok || body.stops?.length !== 3 || !body.inferredContext || !body.planningConfidence || !body.budgetSummary) {
        throw new Error(responseError(body));
      }
      const generated = {
        stops: body.stops,
        context: body.inferredContext,
        confidence: body.planningConfidence,
        budget: body.budgetSummary,
      } satisfies GeneratedMobilePlan;
      setResult({ confidence: generated.confidence, budget: generated.budget });
      onGenerated(generated);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "PUBMAXX could not build that route.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <section className="mobilePlannerIntent" aria-labelledby="mobile-plan-intent-title">
      <div className="mobilePlannerIntentHeading">
        <Sparkles size={20} aria-hidden="true" />
        <div>
          <h3 id="mobile-plan-intent-title">Describe your night</h3>
          <p>Three editable stops, grounded in the map.</p>
        </div>
      </div>
      <div className="mobilePlannerIntentInput">
        <label htmlFor="mobile-plan-query">What do you need?</label>
        <div>
          <input id="mobile-plan-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Quiet in Soho, four of us, under £25" maxLength={500} />
          {speech.supported ? <Button type="button" variant="ghost" size="icon" aria-label={speech.listening ? "Stop describing the night" : "Describe the night by voice"} aria-pressed={speech.listening} onClick={speech.toggle}>{speech.listening ? <MicOff size={18} /> : <Mic size={18} />}</Button> : null}
        </div>
        {speech.listening ? <small role="status">Listening. The transcript stays in this field only.</small> : null}
      </div>
      <div className="mobilePlannerIntentGrid">
        <label>Night Area<select value={area} onChange={(event) => { setAreaTouched(true); setArea(event.target.value as NightAreaSlug); }}>{areas.map((nightArea) => <option key={nightArea.slug} value={nightArea.slug}>{nightArea.name}</option>)}</select></label>
        <label>Time<select value={daypart} onChange={(event) => { setDaypartTouched(true); setDaypart(event.target.value as NightContext["daypart"]); }}><option value="daytime">Daytime</option><option value="after_work">After work</option><option value="evening">Evening</option><option value="late_night">Late night</option></select></label>
        <label>People<input type="number" min="1" max="30" value={groupSize} onChange={(event) => { setGroupSizeTouched(true); setGroupSize(Math.max(1, Math.min(30, Number(event.target.value) || 1))); }} /></label>
        <label>Max each<input type="number" inputMode="decimal" min="5" max="500" value={budgetLimit} onChange={(event) => setBudgetLimit(event.target.value)} placeholder="£" /></label>
      </div>
      <div className="mobilePlannerIntentChips" role="group" aria-label="Night mood">
        {MOODS.map((value) => <Chip key={value} aria-pressed={moodTouched && mood === value} onClick={() => { setMoodTouched(true); setMood(value); }}>{value}</Chip>)}
      </div>
      <div className="mobilePlannerIntentChips" role="group" aria-label="Night pace">
        {PACES.map((value) => <Chip key={value} aria-pressed={paceTouched && pace === value} onClick={() => { setPaceTouched(true); setPace(value); }}>{value.replace(" pace", "")}</Chip>)}
      </div>
      <div className="mobilePlannerIntentChips" role="group" aria-label="Route needs">
        <Chip aria-pressed={stepFree} onClick={() => setStepFree((current) => !current)}>Step-free</Chip>
        <Chip aria-pressed={zeroProof} onClick={() => setZeroProof((current) => !current)}>0.0 options</Chip>
      </div>
      <Button type="button" size="large" className="w-full" disabled={loading} aria-busy={loading} onClick={() => void generate()}>{loading ? "Building route" : "Build 3-stop route"}</Button>
      {error ? <p className="mobilePlannerIntentError" role="alert">{error}</p> : null}
      {result ? (
        <div className="mobilePlannerConfidence" data-level={result.confidence.level} role="status">
          <ShieldCheck size={17} aria-hidden="true" />
          <div><strong>{result.confidence.level === "high" ? "Higher confidence" : result.confidence.level === "medium" ? "Plan with checks" : "Low confidence, fully editable"}</strong><span>{result.budget.estimatedPerPersonPence === null ? "Price evidence is incomplete; check each stop before relying on the budget." : `Estimated £${(result.budget.estimatedPerPersonPence / 100).toFixed(2)} each for one recorded pint per stop.`}</span>{result.confidence.warnings[0] ? <small>{result.confidence.warnings[0]}</small> : null}</div>
        </div>
      ) : null}
    </section>
  );
}
