"use client";

import { useOwnedActivePlan } from "@/components/night/useOwnedActivePlan";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import VenueImage from "@/components/media/VenueImage";
import OpenItUp from "@/components/plan/OpenItUp";
import { canonicalStateFromBody } from "@/components/plan/PlanSummary";
import PlanRoundForecast from "@/components/plan/PlanRoundForecast";
import { readPlanMemberProjection, usePlanMemberRead } from "@/components/plan/usePlanMemberRead";
import { Button } from "@/components/ui/button";
import { isPlanActiveNow, subscribeActivePlan } from "@/lib/activePlan";
import { NIGHT_CRAWL_ENGAGE_EVENT } from "@/lib/nightCrawlEngage";
import type { PlanState } from "@/lib/plan";
import { planVisitedRevealPositions } from "@/lib/planPresentation";
import { isPlanPreviewProjection } from "@/lib/planPrivacy";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { venueDirectionsUrl } from "@/lib/venueJourney";

// THE PLAN AS ONE CARD (PlanAstra 7.4; launch UX variations, V2 "Plan").
//
// A member opens their plan on a phone and reads the whole night before the
// route: the first stop's photograph, the plan's own name, when it starts in
// words, who is coming, and three ways onward. The server never renders it:
// the page's HTML carries only the privacy preview (§4.10), so the card
// appears once the capability-gated member read answers, through the SAME
// shared read the route and the crew spend (usePlanMemberRead, F-34). A read
// that comes back as the preview takes the card down again.
//
// Coral is spent once here. Before the night, "Send to the crew" is the card's
// one filled action. While the night is on, "Night mode" takes it and the
// invite is ink. While the card stands the page head (which paints the same
// action) steps aside in app/plan/plan.css. "Who's in" and "Directions" are
// ink.

/** The id the crew block carries, so "Who's in" lands on it. */
const PLAN_CREW_ANCHOR = "crew";

/**
 * When the night starts, in the words a person would text: "Friday, 7pm",
 * "Saturday, 7:30pm". London time, because every plan is a London night.
 * Null when the plan has no readable start, so the card says nothing rather
 * than a wrong day.
 */
export function planStartInWords(startTime: string): string | null {
  const parsed = Date.parse(startTime);
  if (!Number.isFinite(parsed)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(parsed));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  const weekday = part("weekday");
  const hour = String(Number(part("hour")) || 12);
  const minute = part("minute");
  const period = part("dayPeriod").replace(/[\s.]/g, "").toLowerCase();
  if (!weekday || !period) return null;
  return `${weekday}, ${hour}${minute && minute !== "00" ? `:${minute}` : ""}${period}`;
}

type Cover = { imageUrl: string; kind: string; point: { lat: number; lng: number } | null };

function coverFromVenueBody(body: unknown): Cover | null {
  if (!body || typeof body !== "object") return null;
  const venue = (body as { venue?: unknown }).venue;
  if (!venue || typeof venue !== "object") return null;
  const row = venue as { imageUrl?: unknown; kind?: unknown; latitude?: unknown; longitude?: unknown };
  return {
    imageUrl: typeof row.imageUrl === "string" ? row.imageUrl.trim() : "",
    kind: typeof row.kind === "string" && row.kind ? row.kind : "pub",
    point: typeof row.latitude === "number" && Number.isFinite(row.latitude)
      && typeof row.longitude === "number" && Number.isFinite(row.longitude)
      ? { lat: row.latitude, lng: row.longitude }
      : null,
  };
}

/**
 * The first stop's own photograph, through the venue image path every pub
 * surface uses (VenueImage proxies a scraped photo and labels its source).
 * A pub with no photo, or a read that does not land, is the plain panel tinted
 * by the pub's kind, never a stranger's picture.
 */
function usePlanCover(venueId: string | null): Cover | null {
  const [cover, setCover] = useState<{ venueId: string; value: Cover } | null>(null);
  useEffect(() => {
    if (!venueId) return;
    const controller = new AbortController();
    void loadSurfaceJson<unknown>(
      `/api/venue/${encodeURIComponent(venueId)}`,
      { signal: controller.signal, validate: (body) => coverFromVenueBody(body) !== null },
      (body) => {
        const value = coverFromVenueBody(body);
        if (value) setCover({ venueId, value });
      },
    ).catch(() => undefined);
    return () => controller.abort();
  }, [venueId]);
  return cover && cover.venueId === venueId ? cover.value : null;
}

/** Is this plan's night on right now? The same pointer Night mode reads. */
function usePlanOnTonight(planId: string): boolean {
  const ref = useOwnedActivePlan();
  return useSyncExternalStore(
    (onChange) => {
      const unsubscribe = subscribeActivePlan(onChange);
      const timer = window.setInterval(onChange, 60_000);
      return () => {
        unsubscribe();
        window.clearInterval(timer);
      };
    },
    () => {
      return Boolean(ref && ref.id === planId && isPlanActiveNow(ref, Date.now()));
    },
    () => false,
  );
}

export default function PlanCard({ planId, completed = false }: { planId: string; completed?: boolean }) {
  const [state, setState] = useState<PlanState | null>(null);
  const readPlan = useCallback((isActive: () => boolean) => {
    void readPlanMemberProjection(planId).then((body) => {
      if (!isActive()) return;
      const canonical = canonicalStateFromBody(body);
      if (canonical) setState(canonical);
      else if (isPlanPreviewProjection(body)) setState(null);
    });
  }, [planId]);
  usePlanMemberRead(planId, readPlan);
  const onTonight = usePlanOnTonight(planId);
  // The card leads with the stop the crew goes to next: the first one in route
  // order with no check-in or skip recorded. Before the night that is Stop 1.
  // Once every stop is done it stays on the last one and says nothing more.
  const orderedStops = state ? state.stops.slice().sort((a, b) => a.position - b.position) : [];
  const visited = state ? planVisitedRevealPositions(state) : [];
  const openStop = orderedStops.find((stop) => !visited.includes(stop.position)) ?? null;
  const firstStop = openStop ?? orderedStops.at(-1) ?? null;
  const cover = usePlanCover(firstStop?.venueId ?? null);

  if (!state || completed || state.plan.status === "completed" || state.ending) return null;

  const when = planStartInWords(state.plan.startTime);
  const crew = state.crew.slice().sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const engageNightMode = () => {
    try {
      window.dispatchEvent(new CustomEvent(NIGHT_CRAWL_ENGAGE_EVENT, { detail: { planId } }));
    } catch {
      // An event that cannot be sent leaves the inline Night mode entry below.
    }
  };

  return (
    <section className="planCard" aria-labelledby="plan-card-title" data-testid="plan-card">
      <figure className="planCard__cover" data-kind={cover?.kind ?? "pub"}>
        {cover?.imageUrl && firstStop ? (
          <VenueImage
            className="planCard__photo"
            sources={[{ url: cover.imageUrl, provenance: "chain" }]}
            alt={openStop ? `${firstStop.venueName}, ${visited.length ? "the next stop" : "the first stop"}` : firstStop.venueName}
            fill
            sizes="(max-width: 640px) 100vw, 560px"
            maxWidth={1080}
            priority
          />
        ) : (
          <div className="planCard__placeholder" aria-hidden="true" data-testid="plan-card-placeholder" />
        )}
        {openStop ? (
          <figcaption className="planCard__firstStop">
            {visited.length ? "Next up" : "First up"}: {openStop.venueName}
          </figcaption>
        ) : null}
      </figure>
      <div className="planCard__body">
        {when ? <p className="planCard__when">{when}</p> : null}
        <h1 id="plan-card-title" className="planCard__title">{state.plan.title}</h1>
        {crew.length ? (
          <ul className="planCard__crew" aria-label="The crew">
            {crew.map((member) => (
              <li key={member.id} className="planCard__handle">{member.name}</li>
            ))}
          </ul>
        ) : null}
        <div className="planCard__actions">
          {/* One coral: while the night is on, going out is the next thing to
              do, so Night mode leads and the invite steps back to ink. */}
          {onTonight ? (
            <Button type="button" size="large" className="planCard__primary" onClick={engageNightMode}>
              Night mode
            </Button>
          ) : null}
          <Button
            asChild
            variant={onTonight ? "secondary" : "primary"}
            size="large"
            className={onTonight ? "planCard__secondary" : "planCard__primary"}
          >
            <a href="#share">Send to the crew</a>
          </Button>
          <Button asChild variant="secondary" size="large" className="planCard__secondary">
            <a href={`#${PLAN_CREW_ANCHOR}`}>Who&rsquo;s in</a>
          </Button>
          {openStop && cover?.point ? (
            <Button asChild variant="secondary" size="large" className="planCard__secondary">
              <a
                href={venueDirectionsUrl(cover.point, null)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Directions to ${openStop.venueName}`}
              >
                Directions
              </a>
            </Button>
          ) : null}
        </div>
        <OpenItUp planId={planId} state={state} />
        <PlanRoundForecast planId={planId} stops={state.stops} crew={state.crew} onPlan={setState} />
      </div>
    </section>
  );
}
