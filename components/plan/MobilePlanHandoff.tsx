"use client";

import Link from "next/link";
import { CalendarClock, MapPinned, Navigation, Share2, UsersRound } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { mobilePlanHandoffSummary } from "@/lib/mobilePlanHandoff";
import type { PlanState } from "@/lib/plan";

const STATUS_LIFETIME_MS = 2_800;

function directionsUrl(venueName: string): string {
  return `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(`${venueName}, London`)}`;
}

export default function MobilePlanHandoff({
  planId,
  state,
  shareText,
}: {
  planId: string;
  state: PlanState;
  shareText: string;
}) {
  const summary = mobilePlanHandoffSummary(state);
  const [status, setStatus] = useState("");
  const timerRef = useRef<number | null>(null);

  const announce = useCallback((message: string) => {
    setStatus(message);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setStatus("");
      timerRef.current = null;
    }, STATUS_LIFETIME_MS);
  }, []);

  const sharePlan = useCallback(async () => {
    const url = `${window.location.origin}/plan/${planId}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: state.plan.title, text: shareText, url });
        announce("Plan shared.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${shareText} ${url}`);
      announce("Plan link copied.");
    } catch {
      announce("Could not copy. Use the invite panel below.");
    }
  }, [announce, planId, shareText, state.plan.title]);

  return (
    <section className="mobilePlanHandoff" aria-labelledby="mobile-plan-handoff-title">
      <div className="mobilePlanHandoff__status">
        <span>{summary.statusLabel}</span>
        <strong>{summary.progressLabel}</strong>
      </div>

      <div className="mobilePlanHandoff__target">
        <span className="mobilePlanHandoff__marker" aria-hidden="true">
          {summary.targetStop?.stopNumber ?? "?"}
        </span>
        <div>
          <p id="mobile-plan-handoff-title">{summary.primaryLabel}</p>
          <h2>{summary.targetStop?.venueName ?? state.plan.title}</h2>
        </div>
      </div>

      <div className="mobilePlanHandoff__meta" aria-label="Plan facts">
        <span><CalendarClock size={15} aria-hidden="true" />{summary.startLabel}</span>
        <span><MapPinned size={15} aria-hidden="true" />{summary.stopCount} stops</span>
        <span><UsersRound size={15} aria-hidden="true" />{summary.crewCount} crew</span>
      </div>

      <div className="mobilePlanHandoff__actions">
        {summary.targetStop ? (
          <a href={directionsUrl(summary.targetStop.venueName)} target="_blank" rel="noreferrer" className="mobilePlanHandoff__primary">
            <Navigation size={17} aria-hidden="true" />
            Directions
          </a>
        ) : (
          <a href="#plan-share-title" className="mobilePlanHandoff__primary">
            <Share2 size={17} aria-hidden="true" />
            Invite
          </a>
        )}
        <button type="button" onClick={() => void sharePlan()} aria-label="Share this plan">
          <Share2 size={17} aria-hidden="true" />
          <span>Share</span>
        </button>
        <Link href="/tonight">
          <CalendarClock size={17} aria-hidden="true" />
          <span>Tonight</span>
        </Link>
      </div>

      <p className="mobilePlanHandoff__privacy">No account wall. No live location needed.</p>
      <p className="mobilePlanHandoff__shareStatus" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
