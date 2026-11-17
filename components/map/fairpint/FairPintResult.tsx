"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sheet } from "@/components/ui/sheet";
import { useSheetFooterSlot } from "@/components/mobile/sheetFooterContext";
import PintLine from "@/components/wild/PintLine";
import { Button } from "@/components/ui/button";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { type FairPintDrawn } from "@/lib/fairPint";
import { priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { WildCrawl } from "@/lib/wildPintLineCrawl";
import { planningConfidenceLabel } from "@/lib/planIntelligence";
import { formatPence } from "@/lib/formatGbp";
import "./fairPint.css";
type ResultProps = {
  last: FairPintDrawn; venues: readonly SlimVenue[]; start: string; busy: boolean; error: string; mobile: boolean;
  onStart: (value: string) => void; onBack: () => void;
};
export default function FairPintResult(props: ResultProps) {
  return props.mobile ? <Sheet kind="planner" title="Your Pint Line" initialSnap="half" onClose={props.onBack} backLabel="Back" onBack={props.onBack}><ResultBody {...props} /></Sheet>
    : <section className="fairPintCard fairPintResult"><ResultBody {...props} /></section>;
}
function ResultBody({ last, venues, start, busy, error, onStart, onBack, mobile }: ResultProps) {
  const footer = useSheetFooterSlot();
  const heading = useRef<HTMLHeadingElement>(null);
  const handle = useViewerHandle();
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? handle ?? "";
  const { generated } = last;
  useEffect(() => { heading.current?.focus(); }, []);
  const stops = generated.stops.map((stop) => ({ ...stop, listed: stop.priceEvidence && priceEvidenceUsableForCeiling(stop.priceEvidence) && stop.priceServing === "pint" ? stop.priceEvidence : null }));
  const priced = stops.filter((stop) => stop.listed);
  const total = priced.reduce((sum, stop) => sum + stop.listed!.pence!, 0);
  const crawl = useMemo<WildCrawl>(() => ({ name: "Tonight, sorted", plannedStops: generated.stops.length, totalKm: generated.routeTotals?.straightLineWalkingKm ?? null, totalMinutes: generated.routeTotals?.estimatedWalkingMinutes ?? null,
    stops: generated.stops.map((stop, index) => {
      const venue = venues.find((row) => row.id === stop.venueId), price = stop.priceEvidence;
      const listed = price && priceEvidenceUsableForCeiling(price) && stop.priceServing === "pint";
      return { position: index + 1, name: stop.venueName, point: venue ? [venue.lng, venue.lat] : null, legMinutes: stop.walkingMinutesFromPrevious ?? null, pint: listed ? { priceGbp: price.pence! / 100, drink: "Beer", band: null, source: price.source!.label, readDay: price.source!.observedAt.slice(0, 10), readDayLabel: price.source!.observedAt.slice(0, 10) } : null };
    }) }), [generated, venues]);
  const actions = <div className="fairPintResultActions"><Button disabled>Lock it in</Button><Button variant="ghost" onClick={onBack}>Back</Button></div>;
  return <><div className="fairPintResultBody" aria-labelledby="fair-pint-result-title" aria-busy={busy}>
    <h2 className={mobile ? "sr-only" : undefined} id="fair-pint-result-title" tabIndex={-1} ref={heading}>Your Pint Line</h2>
    <PintLine crawl={crawl} presentation />
    <p className="fairPintStamp">{priced.length === stops.length ? `${stops.length} stops · Listed cost: ${formatPence(total)}, one pint per stop` : `Prices listed for ${priced.length} of ${stops.length} stops`}</p>
    {generated.routeTotals?.estimatedWalkingMinutes != null ? <p>{generated.routeTotals.distanceBasis === "straight-line" ? "about " : ""}{generated.routeTotals.estimatedWalkingMinutes} min walk</p> : null}
    <ol className="fairPintStops">{stops.map((stop) => <li key={stop.venueId}><strong>{stop.venueName}</strong>{stop.listed ? <><span>Beer · pint · {formatPence(stop.listed.pence!)}</span><a href={stop.listed.source!.url} target="_blank" rel="noopener noreferrer">{stop.listed.source!.label}</a><span>Read {new Date(stop.listed.source!.observedAt).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" })}</span></> : <span>No listed price</span>}</li>)}</ol>
    <strong>{planningConfidenceLabel(generated.planningConfidence.level)}</strong>
    {generated.planningConfidence.missingEvidence.includes("opening_hours") ? <p>Opening times are not checked.</p> : null}
    <ul className="fairPintWarnings" aria-label="Route warnings">{generated.planningConfidence.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
    <label htmlFor="fair-pint-start">First pint</label><input id="fair-pint-start" type="datetime-local" value={start} onChange={(event) => onStart(event.target.value)} />
    <label htmlFor="fair-pint-name">Your name</label><input id="fair-pint-name" value={name} onChange={(event) => setName(event.target.value)} aria-describedby="fair-pint-name-hint" autoComplete="given-name" maxLength={40} /><p id="fair-pint-name-hint">Shown on the invite</p>
    {error ? <p role="alert">{error}</p> : null}
  </div>{footer ? createPortal(actions, footer) : actions}</>;
}
