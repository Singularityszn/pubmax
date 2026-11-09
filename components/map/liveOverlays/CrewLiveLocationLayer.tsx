"use client";

// The crew's live dots on the main map: one dot per member who chose to share
// tonight, read from the private Plan route. The reader's own dot is the
// map's reader position, so it is never drawn twice. Nothing is cached.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type * as maplibregl from "maplibre-gl";

import { authAvatarInitials } from "@/lib/authAvatarInitials";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { forgetLiveLocationNight, type LiveLocationNight } from "@/lib/liveLocationNight";
import { LIVE_LOCATION_STALE_MS, parsePlanLiveLocationView, type PlanLiveLocationPerson } from "@/lib/planLiveLocation";
import { liveLocationRequest, reconcileLiveLocationShare } from "@/lib/planLiveLocationShare";

import "./crewLiveLocation.css";

const POLL_MS = 15_000;
const READ_DEADLINE_MS = 8_000;

function useCrewPositions(night: LiveLocationNight): PlanLiveLocationPerson[] {
  const [people, setPeople] = useState<PlanLiveLocationPerson[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const ownerSignal = readProviderAccountSignal();
    let activeRead: AbortController | null = null;
    const read = async () => {
      if (document.visibilityState === "hidden" || controller.signal.aborted || ownerSignal.aborted) return;
      activeRead?.abort();
      const request = new AbortController();
      activeRead = request;
      const abort = () => request.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      const deadline = window.setTimeout(abort, READ_DEADLINE_MS);
      try {
        const response = await liveLocationRequest(night, "GET", undefined, request.signal);
        const view = response.ok ? parsePlanLiveLocationView(await response.json()) : null;
        if (activeRead !== request || request.signal.aborted || controller.signal.aborted || ownerSignal.aborted) return;
        if (view) reconcileLiveLocationShare(night, view);
        if (response.status === 404 || (view && !view.live)) {
          forgetLiveLocationNight(night.planId);
          return;
        }
        // An unreadable answer clears the dots rather than leave stale ones up.
        setPeople(view?.people ?? []);
      } catch {
        if (activeRead === request && !controller.signal.aborted && !ownerSignal.aborted) setPeople([]);
      } finally {
        window.clearTimeout(deadline);
        controller.signal.removeEventListener("abort", abort);
      }
    };
    queueMicrotask(() => void read());
    const poll = window.setInterval(() => void read(), POLL_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      controller.abort();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", read);
    };
  }, [night]);
  return people;
}

/** Re-render on every camera frame so each dot stays on its spot. */
function useCameraFrame(map: maplibregl.Map): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    let pending = 0;
    const onMove = () => {
      if (pending) return;
      pending = window.requestAnimationFrame(() => {
        pending = 0;
        setFrame((value) => value + 1);
      });
    };
    map.on("move", onMove);
    map.on("resize", onMove);
    return () => {
      map.off("move", onMove);
      map.off("resize", onMove);
      if (pending) window.cancelAnimationFrame(pending);
    };
  }, [map]);
  return frame;
}

function ageLabel(person: PlanLiveLocationPerson, now: number): string | null {
  const age = now - Date.parse(person.updatedAt);
  return age >= LIVE_LOCATION_STALE_MS ? `${Math.max(1, Math.round(age / 60_000))} min ago` : null;
}

export default function CrewLiveLocationLayer({ map, night }: { map: maplibregl.Map; night: LiveLocationNight }) {
  const people = useCrewPositions(night);
  const frame = useCameraFrame(map);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!people.length) return null;
  const { width, height } = map.getContainer().getBoundingClientRect();
  return createPortal(
    <div className="crewLive" data-frame={frame}>
      {people.map((person) => {
        const point = map.project([person.longitude, person.latitude]);
        if (point.x < -40 || point.y < -40 || point.x > width + 40 || point.y > height + 40) return null;
        const age = ageLabel(person, now);
        const label = age ? `${person.name}, last seen ${age}` : `${person.name}, sharing live`;
        return (
          <div
            key={person.memberId}
            className={`crewLive__mate${age ? " crewLive__mate--stale" : ""}`}
            style={{ transform: `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)` }}
            role="img"
            aria-label={label}
            title={label}
          >
            <span className="crewLive__dot" aria-hidden="true">{authAvatarInitials(person.name)}</span>
            <span className="crewLive__name" aria-hidden="true">{age ? `${person.name} · ${age}` : person.name}</span>
          </div>
        );
      })}
    </div>,
    map.getCanvasContainer(),
  );
}
