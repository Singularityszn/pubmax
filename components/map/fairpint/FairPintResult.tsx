"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useFairPintSave } from "./useFairPintSave";
import { DEFAULT_PLAN_COMPOSER_TITLE } from "@/lib/plan";
import type { CityId } from "@/lib/cities";
import { Sheet } from "@/components/ui/sheet";
import { useSheetFooterSlot } from "@/components/mobile/sheetFooterContext";
import PintLine from "@/components/wild/PintLine";
import { Button } from "@/components/ui/button";
import ActivePlanMarker from "@/components/plan/ActivePlanMarker";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { type FairPintDrawn } from "@/lib/fairPint";
import { priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { WildCrawl } from "@/lib/wildPintLineCrawl";
import { planningConfidenceLabel } from "@/lib/planIntelligence";
import { categoryLabel, isDrinkCategory } from "@/lib/drinks";
import { formatPence } from "@/lib/formatGbp";
import FairPintStops, { listedFairPintStops } from "./FairPintStops";
import { whenBottomSheetSettles } from "@/components/map/canvas/bottomSheetGeometry";
import { fairPintNeedsPeek } from "./fairPintRouteInsets";
import "./fairPint.css";
type ResultProps = {
  typedName: string | null;
  onName: (value: string) => void;
  last: FairPintDrawn;
  venues: readonly SlimVenue[];
  start: string;
  busy: boolean;
  error: string;
  mobile: boolean;
  cityId: CityId;
  onLineReady: (operationKey: string) => void;
  onEditStart: (value: string) => void;
  onStart: (value: string) => void;
  onBack: () => void;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
};
function ResultActions({ children }: { children: ReactNode }) {
  const footer = useSheetFooterSlot();
  const actions = <div className="fairPintResultActions">{children}</div>;
  return footer ? createPortal(actions, footer) : actions;
}
const readDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
export default function FairPintResult({
  typedName,
  onName,
  last,
  venues,
  start,
  busy,
  error,
  onStart,
  onEditStart,
  onLineReady,
  onBack,
  onClose,
  returnFocus,
  mobile,
  cityId,
}: ResultProps) {
  useEffect(() => {
    if (!mobile) return () => { returnFocus()?.focus({ preventScroll: true }); };
  }, [mobile, returnFocus]);
  const heading = useRef<HTMLHeadingElement>(null);
  const handle = useViewerHandle();
  const nameField = useRef<HTMLInputElement>(null),
    lockedLine = useRef<HTMLParagraphElement>(null);
  const [nameAttempted, setNameAttempted] = useState(false);
  const [diagramReady, setDiagramReady] = useState(false);
  const [snap, setSnap] = useState<"half" | "peek">("half");
  const name = typedName ?? handle ?? "";
  const { generated } = last;
  const save = useFairPintSave(last);
  useEffect(() => {
    if (!mobile) {
      if (diagramReady) onLineReady(generated.operationKey);
      return;
    }
    return whenBottomSheetSettles(0, () => {
      const container = document.querySelector<HTMLElement>(".maplibreMap");
      if (container && snap !== "peek" && fairPintNeedsPeek(container)) {
        setSnap("peek");
        return;
      }
      if (diagramReady) onLineReady(generated.operationKey);
    }, { waitForSheet: true });
  }, [mobile, snap, diagramReady, generated.operationKey, onLineReady]);
  const saveState = save.state;
  const locked = saveState.phase === "locked";
  const close = locked ? onClose : onBack;
  useEffect(() => {
    if (locked) lockedLine.current?.focus();
  }, [locked]);
  useEffect(() => {
    queueMicrotask(() => heading.current?.focus());
  }, []);

  const stops = listedFairPintStops(generated.stops);
  const priced = stops.filter((stop) => stop.listed);
  const total = priced.reduce((sum, stop) => sum + stop.listed!.pence!, 0);
  const crawl = useMemo<WildCrawl>(
    () => ({
      name: DEFAULT_PLAN_COMPOSER_TITLE,
      plannedStops: generated.stops.length,
      totalKm: generated.routeTotals?.straightLineWalkingKm ?? null,
      totalMinutes: generated.routeTotals?.estimatedWalkingMinutes ?? null,
      stops: generated.stops.map((stop, index) => {
        const venue = venues.find((row) => row.id === stop.venueId),
          price = stop.priceEvidence;
        const listed = price && priceEvidenceUsableForCeiling(price) && stop.priceServing === "pint";
        return {
          position: index + 1,
          name: stop.venueName,
          point: venue ? [venue.lng, venue.lat] : null,
          legMinutes: stop.walkingMinutesFromPrevious ?? null,
          pint: listed
            ? {
                priceGbp: price.pence! / 100,
                drink: isDrinkCategory(stop.priceCategory) ? categoryLabel(stop.priceCategory) : "Pint",
                band: null,
                source: price.source!.label,
                readDay: readDay(price.source!.observedAt),
                readDayLabel: readDay(price.source!.observedAt),
              }
            : null,
        };
      }),
    }),
    [generated, venues],
  );
  const actions = (
    <ResultActions>
      {saveState.phase === "locked" ? (
        <>
          <Button
            disabled={!save.url}
            onClick={save.canShare && saveState.share !== "failed" ? save.share : () => void save.copy()}
          >
            {save.canShare && saveState.share !== "failed" ? "Share with the group chat" : "Copy link"}
          </Button>
          {save.canShare && saveState.share !== "failed" ? (
            <Button variant="ghost" disabled={!save.url} onClick={() => void save.copy()}>
              Copy link
            </Button>
          ) : null}
          {saveState.link.phase === "failed" ? (
            <Button variant="ghost" onClick={save.retryLink}>
              Try again
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <>
          <Button
            type="submit"
            form="fair-pint-lock-form"
            disabled={busy || start !== last.start || !!error || save.state.phase === "saving"}
          >
            {save.state.phase === "saving" ? "Locking in…" : "Lock it in"}
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        </>
      )}
    </ResultActions>
  );
  const content = (
    <>
      {saveState.phase === "locked" ? <ActivePlanMarker id={saveState.planId} startTime={last.startIso} /> : null}
      <form
        id="fair-pint-lock-form"
        className="fairPintResultBody"
        aria-labelledby="fair-pint-result-title"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setNameAttempted(true);
            nameField.current?.focus();
            return;
          }
          if (!busy && start === last.start && !error) void save.save(name, cityId);
        }}
      >
        <h2 className={mobile ? "sr-only" : undefined} id="fair-pint-result-title" tabIndex={-1} ref={heading}>
          Your Pint Line
        </h2>
        {locked ? (
          <p ref={lockedLine} tabIndex={-1}>
            Locked in.
          </p>
        ) : null}
        <PintLine
          key={generated.operationKey}
          crawl={crawl}
          presentation
          onDrawn={() => setDiagramReady(true)}
        />
        <p className="fairPintStamp">
          {priced.length === stops.length
            ? `${stops.length} stops · Listed cost: ${formatPence(total)}, one pint per stop`
            : `Prices listed for ${priced.length} of ${stops.length} stops`}
        </p>
        {generated.routeTotals?.estimatedWalkingMinutes != null ? (
          <p>
            {generated.routeTotals.distanceBasis === "straight-line" ? "about " : ""}
            {generated.routeTotals.estimatedWalkingMinutes} min walk
          </p>
        ) : null}
        <FairPintStops stops={stops} />
        <strong>{planningConfidenceLabel(generated.planningConfidence.level)}</strong>
        {generated.planningConfidence.missingEvidence.includes("opening_hours") ? (
          <p>Opening times are not checked.</p>
        ) : null}
        {generated.planningConfidence.warnings.length ? (
          <ul className="fairPintWarnings" aria-label="Route warnings">
            {generated.planningConfidence.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <label htmlFor="fair-pint-start">First pint</label>
        <input
          id="fair-pint-start"
          type="datetime-local"
          disabled={locked || save.state.phase === "saving"}
          value={start}
          onChange={(event) => onEditStart(event.target.value)}
          onBlur={(event) => {
            if (event.target.value !== last.start) onStart(event.target.value);
          }}
        />
        <label htmlFor="fair-pint-name">Your name</label>
        <input
          id="fair-pint-name"
          ref={nameField}
          disabled={locked || save.nameLocked || save.state.phase === "saving"}
          value={name}
          onChange={(event) => onName(event.target.value)}
          aria-describedby="fair-pint-name-hint"
          autoComplete="given-name"
          maxLength={40}
        />
        <p id="fair-pint-name-hint">{nameAttempted && !name.trim() ? "Add your name." : "Shown on the invite"}</p>
        {error ? <p role="alert">{error}</p> : null}
        {save.state.notice ? <p role={locked ? "status" : "alert"}>{save.state.notice}</p> : null}
      </form>
      {actions}
    </>
  );
  return mobile ? (
    <Sheet kind="planner" surface="solid" title="Your Pint Line" initialSnap="half" requestedSnap={snap} returnFocus={returnFocus} onClose={close} backLabel="Back" onBack={close}>
      {content}
    </Sheet>
  ) : (
    <section className="fairPintCard fairPintResult">{content}</section>
  );
}
