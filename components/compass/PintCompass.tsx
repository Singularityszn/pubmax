"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Footprints } from "lucide-react";

import SiteNav from "@/components/nav/SiteNav";
import PriceBadge from "@/components/PriceBadge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ReadyButton } from "@/components/ui/ready-button";
import Screen from "@/components/ui/screen";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { mapHrefForCity } from "@/lib/cityPreference";
import { haptic } from "@/lib/nativeHaptics";
import { formatNearDistance } from "@/lib/nearMeAnswer";
import { nearMeLocationMessage } from "@/lib/nearMeLocation";
import { NEAR_PRICE_TRUST_CAPTION } from "@/lib/nearPriceTrust";
import { NIGHT_PATCHES, type NightPatch } from "@/lib/nightPatches";
import {
  COMPASS_WALK_MINUTES,
  DEFAULT_COMPASS_WALK_MINUTES,
  bearingText,
  NOT_ALIGNED,
  nextAlignment,
  nextNeedleRotation,
  rankCompassTargets,
  relativeBearing,
  remeasureTarget,
  shouldRerank,
  stepTarget,
  turnText,
  type CompassAlignment,
  type CompassAnswer,
  type CompassPoint,
  type CompassTarget,
  type CompassWalkMinutes,
} from "@/lib/pintCompass";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { formatPrice } from "@/lib/venues";
import { loadSlimVenuesForCityResult, type SlimVenue } from "@/lib/venuesSlim";

import { useCompassSensors, type HeadingSensor, type LocationState } from "./useCompassSensors";
import "./pintCompass.css";

// /compass: a needle that points at the cheapest listed pint inside a short
// walk. The arithmetic is lib/pintCompass.ts; the sensors are
// useCompassSensors. This file only decides what to paint.

/** A swipe shorter than this is a tap. */
const SWIPE_MIN_PX = 40;
/** Past this, the fix is too rough to point with confidence, and we say so. */
const ROUGH_FIX_M = 100;

type VenueRead =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; rows: SlimVenue[] }
  | { kind: "unavailable" };

/**
 * A drawn angle that never spins the long way round. The value is kept in
 * state and moved during render (React's "adjust state while rendering"), so
 * the CSS transition always runs the short way.
 */
function useUnwrappedAngle(angle: number): number {
  const [state, setState] = useState({ target: angle, drawn: angle });
  if (state.target !== angle) {
    const next = { target: angle, drawn: nextNeedleRotation(state.drawn, angle) };
    setState(next);
    return next.drawn;
  }
  return state.drawn;
}

function CompassDial({
  ringRotation,
  needleRotation,
  aligned,
  live,
  label,
}: {
  ringRotation: number;
  needleRotation: number;
  aligned: boolean;
  live: boolean;
  label: string;
}) {
  return (
    <div
      className="pcDial"
      role="img"
      aria-label={label}
      data-aligned={aligned ? "true" : "false"}
      data-live={live ? "true" : "false"}
    >
      <svg viewBox="-100 -100 200 200" className="pcDialSvg" aria-hidden="true">
        <circle className="pcDialFace" r="96" />
        <g className="pcRing" style={{ transform: `rotate(${ringRotation}deg)` }}>
          {Array.from({ length: 36 }, (_, index) => (
            <line
              key={index}
              className={index % 9 === 0 ? "pcTick pcTickMajor" : "pcTick"}
              x1="0"
              y1="-94"
              x2="0"
              y2={index % 9 === 0 ? -80 : -87}
              transform={`rotate(${index * 10})`}
            />
          ))}
          <text className="pcNorth" x="0" y="-62" textAnchor="middle" dominantBaseline="middle">
            N
          </text>
          <g className="pcNeedle" style={{ transform: `rotate(${needleRotation}deg)` }}>
            <path className="pcNeedleHead" d="M0 -74 L11 -6 L0 4 L-11 -6 Z" />
            <path className="pcNeedleTail" d="M0 4 L7 34 L0 40 L-7 34 Z" />
          </g>
        </g>
        <circle className="pcHub" r="7" />
      </svg>
      <span className="pcPhoneMark" aria-hidden="true" />
    </div>
  );
}

function AreaPicker({
  onPick,
  selectedId,
}: {
  onPick: (patch: NightPatch) => void;
  selectedId: string | null;
}) {
  return (
    <div className="pcAreas" role="group" aria-label="Pick an area">
      {NIGHT_PATCHES.map((patch) => (
        <Chip
          key={patch.id}
          aria-pressed={selectedId === patch.id}
          className="pcChip"
          onClick={() => onPick(patch)}
        >
          {patch.label}
        </Chip>
      ))}
    </div>
  );
}

function AnswerNotes({
  waitingForFix,
  waitingForList,
  listUnavailable,
  onRetryList,
  chosenMinutes,
  answer,
}: {
  waitingForFix: boolean;
  waitingForList: boolean;
  listUnavailable: boolean;
  onRetryList: () => void;
  chosenMinutes: number;
  answer: CompassAnswer | null;
}) {
  return (
    <>
      {waitingForFix ? <p className="pcNote">Finding where you are.</p> : null}
      {waitingForList ? <p className="pcNote">Loading the pub list.</p> : null}
      {listUnavailable ? (
        <p className="pcNote" role="status">
          The pub list did not load.{" "}
          <button type="button" className="pcTextButton" onClick={onRetryList}>
            Try again.
          </button>
        </p>
      ) : null}
      {answer && answer.widened && answer.targets.length > 0 ? (
        <p className="pcNote" role="status">
          Nothing priced inside {chosenMinutes} min. Showing pubs up to {answer.minutes} min away.
        </p>
      ) : null}
      {answer && answer.targets.length === 0 ? (
        <p className="pcNote" role="status">
          No listed pint price within a {answer.minutes} min walk.{" "}
          <Link href={mapHrefForCity(DEFAULT_CITY_ID)} prefetch={false} className="pcTextLink">
            Open the map
          </Link>
        </p>
      ) : null}
    </>
  );
}

/** The pub the needle points at. A sideways swipe steps through the list. */
function TargetCard({
  target,
  index,
  count,
  direction,
  aligned,
  noSensor,
  roughFixM,
  onStep,
}: {
  target: CompassTarget;
  index: number;
  count: number;
  direction: string;
  aligned: boolean;
  noSensor: boolean;
  roughFixM: number | null;
  onStep: (direction: 1 | -1) => void;
}) {
  const [swipeFrom, setSwipeFrom] = useState<number | null>(null);
  const distance = formatNearDistance(target.distanceKm);
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (swipeFrom === null) return;
    const dx = event.clientX - swipeFrom;
    setSwipeFrom(null);
    if (Math.abs(dx) >= SWIPE_MIN_PX) onStep(dx < 0 ? 1 : -1);
  };
  return (
    <article
      className="pcCard"
      aria-roledescription="carousel item"
      aria-label={`${index + 1} of ${count}`}
      data-bearing={Math.round(target.bearing)}
      onPointerDown={(event) => setSwipeFrom(event.clientX)}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setSwipeFrom(null)}
    >
      <p className={aligned ? "pcDirection pcDirectionAligned" : "pcDirection"} data-testid="compass-direction">
        {direction}
      </p>
      {noSensor ? (
        <p className="pcHint">This phone is not sharing a compass heading, so follow the words.</p>
      ) : null}
      <h2 className="pcName">{target.name}</h2>
      <div className="pcPriceRow">
        <PriceBadge band={priceBand(target.price, priceBandAreaForVenue(target.id))}>
          {formatPrice(target.price)}
        </PriceBadge>
        <span className="pcWalkMeta">
          <Footprints size={14} aria-hidden="true" />
          <span className="pcFigure">{target.walkMinutes}</span> min
          {distance ? (
            <>
              {" · "}
              <span className="pcFigure">{distance}</span>
            </>
          ) : null}
        </span>
      </div>
      <p className="pcTrust">{target.priceLabel}</p>
      {roughFixM !== null ? (
        <p className="pcHint">
          Your location is rough, about <span className="pcFigure">{Math.round(roughFixM)}</span> m, so the
          needle is too.
        </p>
      ) : null}
      <div className="pcSteps">
        <Button
          variant="secondary"
          type="button"
          onClick={() => onStep(-1)}
          disabled={count < 2}
          aria-label="Previous pub"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Button>
        <span className="pcCount">
          <span className="pcFigure">{index + 1}</span> of <span className="pcFigure">{count}</span>
        </span>
        <Button variant="secondary" type="button" onClick={() => onStep(1)} disabled={count < 2}>
          Next cheapest
          <ChevronRight size={16} aria-hidden="true" />
        </Button>
      </div>
      <Link href={venueMapUrl(target.id)} prefetch={false} className="pcTextLink">
        Open on the map
      </Link>
    </article>
  );
}

/** Why the reader is asked, before anything is asked. */
function Explainer() {
  return (
    <ul className="pcExplainer">
      <li>Tap Start and your phone asks for your location.</li>
      <li>An iPhone also asks for motion, so the needle can turn with you.</li>
      <li>
        The direction is worked out on this phone. We do not send your location to our server,
        and we do not store it.
      </li>
    </ul>
  );
}

function WalkChoice({
  minutes,
  onChoose,
}: {
  minutes: CompassWalkMinutes;
  onChoose: (minutes: CompassWalkMinutes) => void;
}) {
  return (
    <div className="pcWalk" role="group" aria-label="Walk">
      <span className="pcWalkLabel">Walk</span>
      {COMPASS_WALK_MINUTES.map((choice) => (
        <Chip key={choice} className="pcChip" aria-pressed={minutes === choice} onClick={() => onChoose(choice)}>
          <span className="pcFigure">{choice}</span> min
        </Chip>
      ))}
    </div>
  );
}

/** The words and the accessible name for where the needle points. */
function describeAim(
  target: CompassTarget | null,
  relative: number | null,
  aligned: boolean,
): { direction: string; dialLabel: string } {
  if (!target) return { direction: "", dialLabel: "Compass needle, waiting for a pub." };
  if (relative === null) {
    return {
      direction: bearingText(target),
      dialLabel: `Needle pointing ${bearingText(target)}, with north at the top.`,
    };
  }
  const direction = turnText(relative, aligned);
  return { direction, dialLabel: `Needle pointing at ${target.name}. ${direction}` };
}

function roughFix(location: LocationState): number | null {
  if (location.kind !== "fixed" || location.accuracyM === null) return null;
  return location.accuracyM > ROUGH_FIX_M ? location.accuracyM : null;
}

/**
 * The dial and the pub it points at, for one origin. The list is ranked from
 * one point and kept while the reader walks; it is read again only after a
 * real move (lib/pintCompass.ts shouldRerank).
 */
function CompassAnswerView({
  origin,
  fromArea,
  location,
  heading,
  sensor,
  venues,
  minutes,
  onRetryList,
}: {
  origin: CompassPoint | null;
  fromArea: boolean;
  location: LocationState;
  heading: number | null;
  sensor: HeadingSensor;
  venues: VenueRead;
  minutes: CompassWalkMinutes;
  onRetryList: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<CompassPoint | null>(null);
  const [alignment, setAlignment] = useState<CompassAlignment>(NOT_ALIGNED);

  if (origin && shouldRerank(anchor, origin)) setAnchor(origin);
  const rankedFrom = anchor ?? origin;

  const answer = useMemo(() => {
    if (!rankedFrom || venues.kind !== "ready") return null;
    return rankCompassTargets(rankedFrom, venues.rows, minutes);
  }, [rankedFrom, venues, minutes]);

  const targets = answer?.targets ?? [];
  const foundIndex = targets.findIndex((target) => target.id === selectedId);
  const index = Math.max(0, foundIndex);
  const ranked = targets[index] ?? null;
  const target = ranked && origin ? remeasureTarget(origin, ranked) : null;

  const live = sensor === "live" && heading !== null;
  const relative = target && live ? relativeBearing(target.bearing, heading) : null;
  // The facing state belongs to ONE pub: stepping to the next one starts it
  // again, so the wider leave band never carries over to a pub it was not
  // earned on (lib/pintCompass.ts nextAlignment).
  const nextAlignmentState = nextAlignment(alignment, target?.id ?? null, relative);
  if (nextAlignmentState.id !== alignment.id || nextAlignmentState.aligned !== alignment.aligned) {
    setAlignment(nextAlignmentState);
  }
  const aligned = nextAlignmentState.aligned;
  const alignedOn = aligned ? nextAlignmentState.id : null;

  // The soft tick, once per line-up. lib/nativeHaptics.ts is the ONE place a
  // phone buzzes: native only, silent under reduced motion, never on the web.
  useEffect(() => {
    if (alignedOn) haptic("heading-aligned");
  }, [alignedOn]);

  const ringRotation = useUnwrappedAngle(live ? -heading : 0);
  const needleRotation = useUnwrappedAngle(target?.bearing ?? 0);
  const { direction, dialLabel } = describeAim(target, relative, aligned);

  const step = (way: 1 | -1) => {
    const next = targets[stepTarget(index, targets.length, way)];
    if (next) setSelectedId(next.id);
  };

  return (
    <section className="pcAnswer" aria-label="Pint compass" data-state={target ? "target" : "waiting"}>
      <CompassDial
        ringRotation={ringRotation}
        needleRotation={needleRotation}
        aligned={aligned}
        live={live}
        label={dialLabel}
      />
      <p className="pcSrOnly" aria-live="polite">
        {aligned && target ? `You are facing ${target.name}.` : ""}
      </p>
      <AnswerNotes
        waitingForFix={!fromArea && location.kind === "locating"}
        waitingForList={origin !== null && (venues.kind === "loading" || venues.kind === "idle")}
        listUnavailable={venues.kind === "unavailable"}
        onRetryList={onRetryList}
        chosenMinutes={minutes}
        answer={answer}
      />
      {target ? (
        <TargetCard
          target={target}
          index={index}
          count={targets.length}
          direction={direction}
          aligned={aligned}
          noSensor={sensor === "none"}
          roughFixM={fromArea ? null : roughFix(location)}
          onStep={step}
        />
      ) : null}
      {targets.length > 0 ? <p className="pcCaption">{NEAR_PRICE_TRUST_CAPTION}</p> : null}
    </section>
  );
}

export default function PintCompass() {
  const { location, heading, sensor, start } = useCompassSensors();
  const [started, setStarted] = useState(false);
  const [area, setArea] = useState<NightPatch | null>(null);
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [minutes, setMinutes] = useState<CompassWalkMinutes>(DEFAULT_COMPASS_WALK_MINUTES);
  const [venues, setVenues] = useState<VenueRead>({ kind: "idle" });

  // The pub list is asked for only once the reader has asked for an answer.
  const loadVenues = useCallback(() => {
    setVenues((current) =>
      current.kind === "ready" || current.kind === "loading" ? current : { kind: "loading" },
    );
    void loadSlimVenuesForCityResult(DEFAULT_CITY_ID).then(
      (result) =>
        setVenues(result.status === "ready" ? { kind: "ready", rows: result.rows } : { kind: "unavailable" }),
      () => setVenues({ kind: "unavailable" }),
    );
  }, []);

  const begin = useCallback(() => {
    // The sensor asks first: iOS honours its prompt only inside this tap.
    start();
    setStarted(true);
    setArea(null);
    setAreaPickerOpen(false);
    loadVenues();
  }, [loadVenues, start]);

  const pickArea = useCallback(
    (patch: NightPatch) => {
      setArea(patch);
      loadVenues();
    },
    [loadVenues],
  );

  const origin: CompassPoint | null = area ?? (location.kind === "fixed" ? location.point : null);
  const locationFailed = location.kind === "failed" && !area;
  const showAreaPicker = areaPickerOpen || locationFailed || area !== null;
  const intro = !started && !area;

  return (
    <div className="pcPage">
      <SiteNav />
      <main id="main" className="pcBody">
        <Screen
          kicker="Pint compass"
          title="Point me at a cheap pint"
          lede={intro ? "The needle points at the cheapest listed pint within a short walk." : undefined}
          primary={
            intro ? (
              <ReadyButton type="button" onClick={begin}>
                Start the compass
              </ReadyButton>
            ) : undefined
          }
          secondary={
            intro && !areaPickerOpen ? (
              <ReadyButton type="button" onClick={() => setAreaPickerOpen(true)}>
                Pick an area instead
              </ReadyButton>
            ) : undefined
          }
        >
          {intro ? <Explainer /> : null}
          <WalkChoice minutes={minutes} onChoose={setMinutes} />
          {locationFailed ? (
            <p className="pcNote" role="status">
              {nearMeLocationMessage(location.failure)}
            </p>
          ) : null}
          {showAreaPicker ? (
            <section className="pcAreaBlock" aria-label="Areas">
              <p className="pcNote">{area ? `From the middle of ${area.label}.` : "Pick where you are."}</p>
              <AreaPicker onPick={pickArea} selectedId={area?.id ?? null} />
            </section>
          ) : null}
          {intro ? null : (
            <CompassAnswerView
              key={`${area?.id ?? "fix"}:${minutes}`}
              origin={origin}
              fromArea={area !== null}
              location={location}
              heading={heading}
              sensor={sensor}
              venues={venues}
              minutes={minutes}
              onRetryList={loadVenues}
            />
          )}
          {!intro && !showAreaPicker ? (
            <button type="button" className="pcTextButton pcAreaDoor" onClick={() => setAreaPickerOpen(true)}>
              Pick an area instead
            </button>
          ) : null}
        </Screen>
      </main>
    </div>
  );
}
