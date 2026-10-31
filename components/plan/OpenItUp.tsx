"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  OPEN_CRAWL_CAPACITY_DEFAULT,
  OPEN_CRAWL_CAPACITY_MAX,
  OPEN_CRAWL_CAPACITY_MIN,
  OPEN_CRAWL_DESCRIPTION_MAX,
  OPEN_CRAWL_MOVE_NOTE,
  OPEN_CRAWL_SIGNED_OUT_LINE,
  defaultMeetingVenueId,
  validateOpenCrawlInput,
} from "@/lib/openCrawl";
import type { PlanState } from "@/lib/plan";
import {
  clearPlanCapability,
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
import { crewIdempotencyKey, crewPath, parseCrewMutation } from "@/lib/socialCrewsUi";

import "./openItUp.css";

// E1 "OPEN IT UP" (launch review 4.5). On a locked plan the host sees one
// button. It asks three things (how many, where to meet, one line) and turns
// the plan into an Open Crew that carries it. Strangers find it on /crawls and
// on Tonight, ask to join, and the host says yes or no on the crew page.
//
// Only the host sees it: the seat capability snapshot every host-only control
// on the plan page reads (PlanHostInviteLink). The account is a second
// authority, so a signed-out host gets the sign-in line, read through the one
// session seam: a null user is not sign-out.

const OPENABLE = new Set(["draft", "ready"]);

function useHostSeat(planId: string): { token: string; isHost: boolean } {
  const event = planCapabilityEvent(planId);
  const snapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const { token, role } = parsePlanCapabilitySnapshot(snapshot);
  useEffect(() => {
    if (token) return;
    void restorePlanCapability(planId).catch(() => undefined);
  }, [planId, token]);
  return { token, isHost: Boolean(token && role === "host") };
}

export default function OpenItUp({ planId, state }: { planId: string; state: PlanState }) {
  const viewer = useViewerSession();
  const { token, isHost } = useHostSeat(planId);
  const stops = state.stops.slice().sort((left, right) => left.position - right.position);
  const [open, setOpen] = useState(false);
  const [capacity, setCapacity] = useState(String(OPEN_CRAWL_CAPACITY_DEFAULT));
  const [meetingVenueId, setMeetingVenueId] = useState(() => defaultMeetingVenueId(stops) ?? "");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const ids = useId();

  const status = state.plan.status ?? "draft";
  if (!isHost || !OPENABLE.has(status) || stops.length === 0 || viewer.unresolved) return null;

  if (viewer.signedOut) {
    return (
      <p className="openItUp__line" data-testid="open-it-up-signed-out">
        {OPEN_CRAWL_SIGNED_OUT_LINE}{" "}
        <Link href={`/login?mode=signin&from=${encodeURIComponent(`/plan/${planId}`)}` as Route}>Sign in</Link>
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    const checked = validateOpenCrawlInput(
      { capacity: Number(capacity), meetingVenueId, description },
      stops,
    );
    if (!checked.ok) {
      setProblem(checked.line);
      return;
    }
    setProblem("");
    setWorking(true);
    try {
      const response = await authedActionFetch(`/api/plans/${planId}/open-crew`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crewIdempotencyKey("open-crawl"),
        },
        body: JSON.stringify({ memberToken: token, ...checked.value }),
      }, { requiresIdentity: true });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setProblem(errorMessageFrom(body, "Couldn't open this plan up."));
        return;
      }
      const outcome = parseCrewMutation(await response.json().catch(() => null));
      if (!outcome?.crewId) {
        setProblem("Couldn't open this plan up.");
        return;
      }
      // The crew now holds the plan, and every seat token was rotated with it.
      clearPlanCapability(planId);
      window.location.assign(crewPath(outcome.crewId));
    } catch {
      setProblem(offlineOrMessage("Couldn't open this plan up."));
    } finally {
      setWorking(false);
    }
  }

  if (!open) {
    return (
      <div className="openItUp" data-testid="open-it-up">
        <button type="button" className="openItUp__door" onClick={() => setOpen(true)}>
          Open it up
        </button>
      </div>
    );
  }

  return (
    <form className="openItUp openItUp--form" onSubmit={(event) => void submit(event)} data-testid="open-it-up-form">
      <p className="openItUp__note">{OPEN_CRAWL_MOVE_NOTE}</p>
      <label className="openItUp__field" htmlFor={`${ids}-capacity`}>
        <span>How many, you included</span>
        <input
          id={`${ids}-capacity`}
          type="number"
          inputMode="numeric"
          min={OPEN_CRAWL_CAPACITY_MIN}
          max={OPEN_CRAWL_CAPACITY_MAX}
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
        />
      </label>
      <label className="openItUp__field" htmlFor={`${ids}-meet`}>
        <span>Meet at</span>
        <select id={`${ids}-meet`} value={meetingVenueId} onChange={(event) => setMeetingVenueId(event.target.value)}>
          {stops.map((stop) => (
            <option key={stop.venueId} value={stop.venueId}>{stop.venueName}</option>
          ))}
        </select>
      </label>
      <label className="openItUp__field" htmlFor={`${ids}-line`}>
        <span>One line about the night</span>
        <input
          id={`${ids}-line`}
          type="text"
          maxLength={OPEN_CRAWL_DESCRIPTION_MAX}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Old boozers round Holborn, a pint at each, home by midnight."
        />
        <small className="openItUp__count">{description.length} of {OPEN_CRAWL_DESCRIPTION_MAX}</small>
      </label>
      {problem ? <p className="openItUp__problem" role="alert">{problem}</p> : null}
      <div className="openItUp__actions">
        <button type="submit" className="openItUp__door" disabled={working}>
          {working ? "Opening it up…" : "Open it up"}
        </button>
        <button type="button" className="openItUp__quiet" disabled={working} onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </form>
  );
}
