"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  HOST_ON_DATE_DEFAULT_TIME,
  HOST_ON_DATE_NO_HANDLE_LINE,
  HOST_ON_DATE_NO_STOPS_LINE,
  HOST_ON_DATE_RANGE_LINE,
  HOST_ON_DATE_SIGNED_OUT_LINE,
  hostOnDateBounds,
  hostOnDatePlanBody,
  hostOnDateStartIso,
  planStopsFromStory,
  type StoryStopInput,
} from "@/lib/openCrawl";
import { writePlanCapability } from "@/lib/planSessionCapability";
import { crewIdempotencyKey } from "@/lib/socialCrewsUi";

import "./hostOnDate.css";

// E2 "HOST THIS ON A DATE" (launch review 4.5). A fixed route or a crawl story
// becomes a plan on the day the host picks, through the planner's own create
// door (POST /api/plans), with the stops in the story's own order. No model
// is asked. The host lands on the plan page, where "Open it up" (E1) waits.
//
// A plan needs a host with a name, and opening it up needs an account, so the
// door is for a signed-in viewer. A signed-out viewer gets the sign-in line,
// read through the one session seam: a null user is not sign-out.

export const HOST_ON_DATE_LABEL = "Host this on a date";

export default function HostOnDate({
  title,
  stops,
  returnPath,
  compact = false,
}: {
  title: string;
  stops: readonly StoryStopInput[];
  /** Where the sign-in line brings the viewer back to. */
  returnPath: string;
  /** A fold under a row, rather than an open form under a card. */
  compact?: boolean;
}) {
  const router = useRouter();
  const viewer = useViewerSession();
  const handle = useViewerHandle();
  const ids = useId();
  const [now] = useState(() => Date.now());
  const bounds = hostOnDateBounds(now);
  const [date, setDate] = useState(bounds.min);
  const [time, setTime] = useState(HOST_ON_DATE_DEFAULT_TIME);
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const plannable = planStopsFromStory(stops);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    const startIso = hostOnDateStartIso(date, time, Date.now());
    if (!startIso) {
      setProblem(HOST_ON_DATE_RANGE_LINE);
      return;
    }
    const body = hostOnDatePlanBody({ title, creatorName: handle ?? "", startIso, stops });
    if (!body) {
      setProblem(plannable.length ? "Couldn't set this night up." : HOST_ON_DATE_NO_STOPS_LINE);
      return;
    }
    setProblem("");
    setWorking(true);
    try {
      const response = await authedActionFetch("/api/plans", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": crewIdempotencyKey("host-date") },
        body: JSON.stringify(body),
      }, { requiresIdentity: true });
      const created = (await response.json().catch(() => null)) as
        | { plan?: { plan?: { id?: unknown } }; memberToken?: unknown }
        | null;
      const planId = created?.plan?.plan?.id;
      if (!response.ok || typeof planId !== "string") {
        setProblem(errorMessageFrom(created, "Couldn't set this night up."));
        return;
      }
      if (typeof created?.memberToken === "string") {
        writePlanCapability(planId, { token: created.memberToken, collaborationAuthorized: true, role: "host" });
      }
      router.push(`/plan/${planId}` as Route);
    } catch {
      setProblem(offlineOrMessage("Couldn't set this night up."));
    } finally {
      setWorking(false);
    }
  }

  if (plannable.length === 0 || viewer.unresolved) return null;

  const content = viewer.signedOut ? (
    <p className="hostOnDate__line" data-testid="host-on-date-signed-out">
      {HOST_ON_DATE_SIGNED_OUT_LINE}{" "}
      <Link href={`/login?mode=signin&from=${encodeURIComponent(returnPath)}` as Route}>Sign in</Link>
    </p>
  ) : !handle ? (
    <p className="hostOnDate__line">
      {HOST_ON_DATE_NO_HANDLE_LINE}{" "}
      <Link href="/u/you">Pick a handle</Link>
    </p>
  ) : (
    <form className="hostOnDate__form" onSubmit={(event) => void submit(event)} data-testid="host-on-date-form">
      <label className="hostOnDate__field" htmlFor={`${ids}-date`}>
        <span>Date</span>
        <input
          id={`${ids}-date`}
          type="date"
          min={bounds.min}
          max={bounds.max}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
      <label className="hostOnDate__field" htmlFor={`${ids}-time`}>
        <span>Start</span>
        <input
          id={`${ids}-time`}
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="hostOnDate__go" disabled={working}>
        {working ? "Setting it up…" : "Make the plan"}
      </button>
      {problem ? <p className="hostOnDate__problem" role="alert">{problem}</p> : null}
    </form>
  );

  if (compact) {
    return (
      <details className="hostOnDate hostOnDate--compact" data-testid="host-on-date">
        <summary className="hostOnDate__summary">{HOST_ON_DATE_LABEL}</summary>
        {content}
      </details>
    );
  }
  return (
    <section className="hostOnDate" aria-label={HOST_ON_DATE_LABEL} data-testid="host-on-date">
      <p className="hostOnDate__heading">{HOST_ON_DATE_LABEL}</p>
      {content}
    </section>
  );
}
