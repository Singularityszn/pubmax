"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { CrewMemberDTO } from "@/lib/crew";
import type { PlanState, PlanStopDTO } from "@/lib/plan";
import { readPlanReportLine } from "@/lib/planReportLine";
import { stopRound, stopRoundTotalLine, type RoundLine } from "@/lib/planRoundForecast";
import { parsePlanCapabilitySnapshot, planCapabilityEvent, readPlanCapabilitySnapshot } from "@/lib/planSessionCapability";
import {
  cleanPlanUsualDrink,
  PLAN_ROUND_BASIS_LINE,
  PLAN_ROUND_HEADING,
  PLAN_ROUND_NOT_LISTED,
  PLAN_USUAL_DRINK_ASK,
  PLAN_USUAL_DRINK_LABEL,
  PLAN_USUAL_DRINKS,
  type PlanUsualDrink,
} from "@/lib/planUsualDrink";
import { discardBody } from "@/lib/responseBody";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { formatTrustDay } from "@/lib/trustPill";
import type { Venue } from "@/lib/venues";

// WHAT'S OUR ROUND HERE? (review item B6), and the planner's report line.
//
// Each member picks a usual drink once. Until one of them has, the round stays
// off and the card shows only the ask. Once one has, each stop prints the round
// from the prices the pub LISTS, with the day each was read, "not listed" where
// it lists none, and a total that says how many of the drinks it covers. It is
// a forecast of listed prices: no payment, no settlement, no split.
//
// Under the stops sits the planner's own report line ("Short walks", "Tube"),
// when the device that built the route kept one (lib/planReportLine.ts).

const PICK_KEY = "pubmax:plan-usual-drink:";

function readRememberedPick(planId: string): PlanUsualDrink | null {
  try {
    return cleanPlanUsualDrink(window.localStorage.getItem(`${PICK_KEY}${planId}`));
  } catch {
    return null;
  }
}

function rememberPick(planId: string, drink: PlanUsualDrink): void {
  try {
    window.localStorage.setItem(`${PICK_KEY}${planId}`, drink);
  } catch {
    // Blocked storage: the pick is saved on the plan, only the highlight is lost on reload.
  }
}

function venueFromBody(body: unknown): Venue | null {
  if (!body || typeof body !== "object") return null;
  const venue = (body as { venue?: unknown }).venue;
  return venue && typeof venue === "object" && typeof (venue as { id?: unknown }).id === "string"
    ? (venue as Venue)
    : null;
}

/** Each stop's venue detail, read only while the round is on. */
function useStopVenues(venueIds: readonly string[], enabled: boolean): ReadonlyMap<string, Venue> {
  const [venues, setVenues] = useState<ReadonlyMap<string, Venue>>(new Map());
  const key = venueIds.join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    const controller = new AbortController();
    for (const venueId of new Set(key.split(","))) {
      void loadSurfaceJson<unknown>(
        `/api/venue/${encodeURIComponent(venueId)}`,
        { signal: controller.signal, validate: (body) => venueFromBody(body) !== null },
        (body) => {
          const venue = venueFromBody(body);
          if (!venue) return;
          setVenues((previous) => {
            const next = new Map(previous);
            next.set(venueId, venue);
            return next;
          });
        },
      ).catch(() => undefined);
    }
    return () => controller.abort();
  }, [enabled, key]);
  return venues;
}

function readDay(observedAt: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(observedAt) ? `${observedAt}T12:00:00.000Z` : observedAt;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? formatTrustDay(at) : null;
}

/** "Sam: Wine (175 ml) £7.50, listed 3 Oct" or "Sam: Soft drink, not listed". */
function roundLineText(line: RoundLine): string {
  const label = PLAN_USUAL_DRINK_LABEL[line.drink];
  if (!line.price) return `${line.memberName}: ${label}, ${PLAN_ROUND_NOT_LISTED}`;
  const day = readDay(line.price.observedAt);
  const named = line.price.drinkName ? `, ${line.price.drinkName}` : "";
  return `${line.memberName}: ${label}${named} £${line.price.priceGbp.toFixed(2)}${day ? `, listed ${day}` : ", listed"}`;
}

export default function PlanRoundForecast({
  planId,
  stops,
  crew,
  onPlan,
}: {
  planId: string;
  stops: readonly PlanStopDTO[];
  crew: readonly CrewMemberDTO[];
  onPlan: (state: PlanState) => void;
}) {
  const tokenEvent = planCapabilityEvent(planId);
  const capability = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => window.removeEventListener(tokenEvent, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const memberToken = parsePlanCapabilitySnapshot(capability).token;
  const remembered = useSyncExternalStore(
    () => () => undefined,
    () => readRememberedPick(planId),
    () => null,
  );
  const reportLine = useSyncExternalStore(
    () => () => undefined,
    () => readPlanReportLine(planId),
    () => null,
  );
  const [picked, setPicked] = useState<PlanUsualDrink | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const myPick = picked ?? remembered;

  const ordered = useMemo(() => stops.slice().sort((a, b) => a.position - b.position), [stops]);
  const roundOn = crew.some((member) => Boolean(member.usualDrink));
  const venues = useStopVenues(ordered.map((stop) => stop.venueId), roundOn);

  async function pick(drink: PlanUsualDrink) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/usual-drink`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ usualDrink: drink, ...(memberToken ? { memberToken } : {}) }),
      });
      if (!response.ok) {
        discardBody(response);
        setError("Could not save your usual. Try again.");
        return;
      }
      const body = (await response.json().catch(() => null)) as PlanState | null;
      setPicked(drink);
      rememberPick(planId, drink);
      if (body && Array.isArray(body.stops) && Array.isArray(body.crew)) onPlan(body);
    } catch {
      setError("Could not save your usual. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="planRound" aria-labelledby={`plan-round-${planId}`} data-testid="plan-round">
      <h2 id={`plan-round-${planId}`} className="planRound__heading">{PLAN_ROUND_HEADING}</h2>
      <div className="planRound__ask">
        <span className="planRound__askLabel" id={`plan-round-ask-${planId}`}>{PLAN_USUAL_DRINK_ASK}</span>
        <div className="planRound__choices" role="radiogroup" aria-labelledby={`plan-round-ask-${planId}`}>
          {PLAN_USUAL_DRINKS.map((drink) => (
            <button
              key={drink}
              type="button"
              role="radio"
              aria-checked={myPick === drink}
              className={myPick === drink ? "planRound__choice selected" : "planRound__choice"}
              disabled={pending}
              onClick={() => void pick(drink)}
            >
              {PLAN_USUAL_DRINK_LABEL[drink]}
            </button>
          ))}
        </div>
        {error ? <p className="planRound__error" role="alert">{error}</p> : null}
      </div>
      {roundOn ? (
        <>
          <ol className="planRound__stops">
            {ordered.map((stop) => {
              const round = stopRound(venues.get(stop.venueId) ?? null, crew);
              const total = stopRoundTotalLine(round);
              return (
                <li key={`${stop.position}-${stop.venueId}`} className="planRound__stop">
                  <span className="planRound__stopName">{stop.venueName}</span>
                  <ul className="planRound__lines">
                    {round.lines.map((line) => (
                      <li key={line.memberId}>{roundLineText(line)}</li>
                    ))}
                  </ul>
                  <p className="planRound__total">
                    {total ?? `None of the ${round.drinkCount} ${round.drinkCount === 1 ? "drink is" : "drinks are"} listed here`}
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="planRound__basis">{PLAN_ROUND_BASIS_LINE}</p>
        </>
      ) : null}
      {reportLine ? <p className="planRound__report" data-testid="plan-report-line">{reportLine}</p> : null}
    </section>
  );
}
