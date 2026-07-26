"use client";

// "The Tube this morning" — the material TfL disruption layer (#482) surfaced as
// its own card, high in the morning stack, so a Londoner sees a night-shaping
// line closure before they leave, WITHOUT having to share their location. The
// eyebrow follows the viewer's own time of day (the same band the greeting
// above is built from), because a card headed "this morning" at half past
// midnight is the kind of small lie that makes a whole page feel automated. The
// area comes from the remembered patch (central London default), rounded before
// it leaves the device, and the same /api/tfl-disruption route + describeDisruption
// copy the get-home strip already uses do the work.
//
// It keeps the underlying component's restraint: silent unless there is something
// material to say. There is no "all lines good" state, because a clear network and
// TfL being unreachable are indistinguishable here (both resolve to null), so we
// never claim clear. No disruption means no card, never an empty box.
//
// React 19 rules mirror DisruptionLine: the fetch fires in an effect, state
// settles only in the async resolution/catch, and an AbortController cancels on
// unmount.

import { useEffect, useState } from "react";
import { AlertTriangle, TrainFront } from "lucide-react";

import { TUBE_WHEN_LABEL, type DaySlot } from "@/lib/dayGreeting";
import { roundCoord } from "@/lib/geo";
import { readRememberedArea } from "@/lib/nightPatches";
import type { PatchDisruption } from "@/lib/tflDisruption";

import { rememberedAreaCentre } from "./todayArea";
import "@/components/transport/disruptionLine.css";

type DisruptionResponse = { disruption?: PatchDisruption | null };

export default function TodayTubeCard({ slot }: { slot: DaySlot }) {
  const [disruption, setDisruption] = useState<PatchDisruption | null>(null);

  useEffect(() => {
    const centre = rememberedAreaCentre(readRememberedArea());
    const lat = roundCoord(centre.lat);
    const lng = roundCoord(centre.lng);
    const controller = new AbortController();
    fetch(`/api/tfl-disruption?lat=${lat}&lng=${lng}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: DisruptionResponse | null) => {
        if (controller.signal.aborted) return;
        setDisruption(body?.disruption ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDisruption(null);
      });
    return () => controller.abort();
  }, []);

  if (!disruption) return null;

  return (
    <section className="todayCard" aria-labelledby="today-tube-title" data-testid="today-tube">
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <TrainFront size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">The Tube {TUBE_WHEN_LABEL[slot]}</p>
          <h2 className="todayCardTitle" id="today-tube-title">
            Worth planning around near {disruption.patchLabel}.
          </h2>
        </div>
      </div>
      <p className="transportDisruption" data-testid="tfl-disruption">
        <AlertTriangle size={14} aria-hidden="true" className="transportDisruptionIcon" />
        <span className="transportDisruptionCopy">
          {disruption.line}. <span className="transportDisruptionProv">via TfL</span>
        </span>
      </p>
    </section>
  );
}
