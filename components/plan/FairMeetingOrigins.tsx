"use client";

// The fair meeting comparison. Someone on this plan picks the broad London
// night areas the crew is coming from, and every candidate pub shows its
// longest and its average journey from those areas.
//
// The areas are private. They live in this component's state alone. They are
// never posted with the shared picks, written to storage, put in a URL or sent
// to analytics. Switching the comparison off drops them, and the parent keys
// this component on the plan and member, so a change of either drops them too.
//
// The only network read is each candidate pub's public venue record, and only
// after the opt-in. A journey is a straight-line walking estimate from the
// area's centre, with the same distance and walking pace as the plan's
// straight-line legs. It is never a routed walk and never step-free evidence.
// A pub without usable coordinates reads as unknown, never as zero minutes.

import { useEffect, useState } from "react";

import { haversineKm } from "@/lib/haversine";
import { getNightAreasForCity, type NightArea } from "@/lib/nightAreas";
import type { PlanStopDTO } from "@/lib/plan";
import { discardBody } from "@/lib/responseBody";
import { legMinutes } from "@/lib/routeLegs";

type Props = {
  stops: readonly PlanStopDTO[];
};

/** [lng, lat], the order the app's distance helpers take. */
type Point = [number, number];

type StopPoints = ReadonlyMap<string, Point | null>;

type Journey = { longest: number; average: number };

type JourneyRow = { venueId: string; venueName: string; journey: Journey | null };

type KnownRow = JourneyRow & { journey: Journey };

const AREAS: readonly NightArea[] = getNightAreasForCity("london");

const PRIVACY_NOTE =
  "Pick broad starting areas only. They stay on this device and are never shared with the plan.";
const BASIS_NOTE =
  "Straight-line walking estimates from each area's centre. Not a routed walk, and not step-free evidence.";

function pointFrom(venue: { latitude?: unknown; longitude?: unknown } | undefined): Point | null {
  const lat = venue?.latitude;
  const lng = venue?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}

async function readStopPoint(venueId: string, signal: AbortSignal): Promise<Point | null> {
  try {
    const response = await fetch(`/api/venue/${encodeURIComponent(venueId)}`, {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      discardBody(response);
      return null;
    }
    const body = await response.json() as { venue?: { latitude?: unknown; longitude?: unknown } };
    return pointFrom(body.venue);
  } catch {
    return null;
  }
}

async function readStopPoints(venueIds: readonly string[], signal: AbortSignal): Promise<StopPoints> {
  const points = await Promise.all(venueIds.map((venueId) => readStopPoint(venueId, signal)));
  return new Map(venueIds.map((venueId, index): [string, Point | null] => [venueId, points[index] ?? null]));
}

function walkMinutes(area: NightArea, point: Point): number {
  // A walk from an area's centre is never zero minutes, even to a pub on it.
  return Math.max(1, legMinutes(haversineKm([area.centre.lng, area.centre.lat], point)));
}

function journeyFrom(point: Point | null | undefined, origins: readonly NightArea[]): Journey | null {
  if (!point || origins.length === 0) return null;
  const minutes = origins.map((area) => walkMinutes(area, point));
  const total = minutes.reduce((sum, value) => sum + value, 0);
  // Rounded up like each walk, so the average never understates a journey.
  return { longest: Math.max(...minutes), average: Math.ceil(total / minutes.length) };
}

function rowText(row: JourneyRow): string {
  if (!row.journey) return `${row.venueName}: journey time unknown`;
  return `${row.venueName}: longest ${row.journey.longest} min, average ${row.journey.average} min`;
}

/** Pubs with the same average can still ask one person to travel much further. */
function sameAverageNotes(rows: readonly JourneyRow[]): string[] {
  const groups = new Map<number, KnownRow[]>();
  for (const row of rows) {
    if (!row.journey) continue;
    const known: KnownRow = { ...row, journey: row.journey };
    groups.set(known.journey.average, [...(groups.get(known.journey.average) ?? []), known]);
  }
  const notes: string[] = [];
  for (const [average, group] of groups) {
    const sorted = [...group].sort((left, right) => left.journey.longest - right.journey.longest);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last || first.journey.longest === last.journey.longest) continue;
    notes.push(`Same average of ${average} min. ${first.venueName} keeps the longest journey shortest.`);
  }
  return notes;
}

function ChosenAreas({ areas, onRemove }: { areas: readonly NightArea[]; onRemove: (slug: string) => void }) {
  return (
    <div className="matchGroupPrefs__chips" role="group" aria-label="Chosen starting areas">
      {areas.map((area) => (
        <button
          key={area.slug}
          type="button"
          className="matchGroupPrefs__chip"
          aria-label={`Remove ${area.name}`}
          onClick={() => onRemove(area.slug)}
        >
          {area.name} ×
        </button>
      ))}
    </div>
  );
}

function JourneyComparison({ rows }: { rows: readonly JourneyRow[] }) {
  return (
    <>
      <ul aria-label="Journey comparison">
        {rows.map((row, index) => (
          <li key={`${row.venueId}-${index}`}>{rowText(row)}</li>
        ))}
      </ul>
      {sameAverageNotes(rows).map((note) => (
        <p key={note} className="matchGroupPrefs__status">{note}</p>
      ))}
    </>
  );
}

export default function FairMeetingOrigins({ stops }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [choice, setChoice] = useState("");
  const [areaSlugs, setAreaSlugs] = useState<string[]>([]);
  const [points, setPoints] = useState<StopPoints | null>(null);
  const stopKey = stops.map((stop) => stop.venueId).join("\n");

  // Pub locations are read only while the comparison is on. Switching it off,
  // a changed stop list or an unmount aborts the read, so a late answer can
  // never paint.
  useEffect(() => {
    if (!enabled || !stopKey) return;
    const controller = new AbortController();
    void readStopPoints(stopKey.split("\n"), controller.signal).then((next) => {
      if (!controller.signal.aborted) setPoints(next);
    });
    return () => controller.abort();
  }, [enabled, stopKey]);

  if (stops.length === 0) return null;

  const origins = areaSlugs
    .map((slug) => AREAS.find((area) => area.slug === slug))
    .filter((area): area is NightArea => Boolean(area));
  const located = points !== null && stops.every((stop) => points.has(stop.venueId));
  const rows: JourneyRow[] = stops.map((stop) => ({
    venueId: stop.venueId,
    venueName: stop.venueName,
    journey: journeyFrom(points?.get(stop.venueId), origins),
  }));

  function toggle() {
    // Either way, start from nothing: no area and no located pub carries over.
    setEnabled((current) => !current);
    setChoice("");
    setAreaSlugs([]);
    setPoints(null);
  }

  function addArea() {
    if (!AREAS.some((area) => area.slug === choice) || areaSlugs.includes(choice)) return;
    setAreaSlugs((current) => [...current, choice]);
    setChoice("");
  }

  return (
    <div className="matchGroupPrefs__field">
      <strong>Meeting point</strong>
      <div className="matchGroupPrefs__actions">
        <button type="button" className="matchGroupPrefs__chip" aria-pressed={enabled} onClick={toggle}>
          Compare journeys from broad areas
        </button>
      </div>
      {enabled ? (
        <>
          <p className="matchGroupPrefs__intro">{PRIVACY_NOTE}</p>
          <div className="matchGroupPrefs__actions">
            <select aria-label="Broad starting area" value={choice} onChange={(event) => setChoice(event.target.value)}>
              <option value="">Choose an area</option>
              {AREAS.filter((area) => !areaSlugs.includes(area.slug)).map((area) => (
                <option key={area.slug} value={area.slug}>{area.name}</option>
              ))}
            </select>
            <button type="button" className="planCollab__quiet" onClick={addArea} disabled={!choice}>
              Add area
            </button>
          </div>
          {origins.length > 0 ? (
            <>
              <ChosenAreas areas={origins} onRemove={(slug) => setAreaSlugs((current) => current.filter((held) => held !== slug))} />
              <p className="matchGroupPrefs__status">{BASIS_NOTE}</p>
              {located ? (
                <JourneyComparison rows={rows} />
              ) : (
                <p className="matchGroupPrefs__status" role="status">Finding the pubs on this plan.</p>
              )}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
