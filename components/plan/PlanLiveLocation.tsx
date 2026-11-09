"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { forgetLiveLocationNight, rememberLiveLocationNight } from "@/lib/liveLocationNight";
import { LIVE_LOCATION_STALE_MS, parsePlanLiveLocationView, type PlanLiveLocationView } from "@/lib/planLiveLocation";
import {
  liveLocationRequest,
  liveShareSnapshot,
  reconcileLiveLocationShare,
  startLiveLocationShare,
  stopLiveLocationShare,
  subscribeLiveShare,
  type LiveLocationSeat,
  type LiveShareStatus,
} from "@/lib/planLiveLocationShare";

import "./planLiveLocation.css";

const POLL_MS = 15_000;
const READ_DEADLINE_MS = 8_000;
const OFF_SNAPSHOT = { planId: null, status: "off" as const, stopUnconfirmed: false };

const STATUS_LINE: Partial<Record<LiveShareStatus, string>> = {
  busy: "You are already sharing with another night. Stop that one first.",
  asking: "Waiting for your phone to say yes.",
  "no-signal": "We've lost your signal. Your crew sees where you were last, with the time.",
  denied: "Location is blocked for this app, so nobody can see you. Allow it in your browser or phone settings, then try again.",
  unsupported: "This phone can't share its location here.",
  ended: "Sharing has ended for this night.",
  failed: "That didn't go through. Your last spot may still show. Tap Stop sharing to try again.",
};

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(iso));
}

function lastSeen(updatedAt: string, now: number): string | null {
  const age = now - Date.parse(updatedAt);
  if (age < LIVE_LOCATION_STALE_MS) return null;
  return `last seen ${Math.max(1, Math.round(age / 60_000))} min ago`;
}

type Props = { seat: LiveLocationSeat; ownerKey: string; stopOnly?: boolean };

function sharingControls(status: LiveShareStatus, busy: boolean, sharing: boolean, stopUnconfirmed: boolean) {
  const stopping = busy || status === "stopping";
  const watching = status === "asking" || status === "on" || status === "no-signal";
  const canStop = watching || status === "paused" || status === "failed" || status === "stopping";
  const paused = (sharing || status === "paused" || status === "failed" || status === "stopping") && !watching;
  const canResume = paused && !stopUnconfirmed;
  return { stopping, watching, canStop, paused, canResume };
}

/** The remount boundary drops one owner's view before another can paint. */
export default function PlanLiveLocation({ seat, ownerKey, stopOnly = false }: Props) {
  if (!ownerKey || (seat.via === "plan" && !seat.memberToken)) return null;
  return <LiveLocationMember key={`${seat.planId}:${seat.via}:${seat.memberToken ?? ""}:${ownerKey}:${stopOnly}`} seat={seat} stopOnly={stopOnly} />;
}

function LiveLocationMember({ seat, stopOnly }: Pick<Props, "seat" | "stopOnly">) {
  const [view, setView] = useState<PlanLiveLocationView | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const activeRead = useRef<AbortController | null>(null);
  const getSnapshot = useCallback(() => liveShareSnapshot(seat.planId), [seat.planId]);
  const share = useSyncExternalStore(subscribeLiveShare, getSnapshot, () => OFF_SNAPSHOT);
  const status: LiveShareStatus = share.planId === seat.planId ? share.status : "off";
  const { stopping, watching, canStop, paused, canResume } = sharingControls(status, busy, view?.sharing ?? false, share.stopUnconfirmed);
  const { planId, via, memberToken } = seat;

  const read = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const ownerSignal = readProviderAccountSignal();
    activeRead.current?.abort();
    const request = new AbortController();
    activeRead.current = request;
    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const deadline = window.setTimeout(abort, READ_DEADLINE_MS);
    try {
      const response = await liveLocationRequest({ planId, via, memberToken }, "GET", undefined, request.signal);
      const next = response.ok ? parsePlanLiveLocationView(await response.json()) : null;
      if (activeRead.current !== request || request.signal.aborted || signal?.aborted || ownerSignal.aborted) return;
      if (response.status === 404) {
        // Not a seat that may see the crew, so there is nothing to offer.
        forgetLiveLocationNight(planId);
        setView(null);
        setProblem("");
        return;
      }
      if (!next) throw new Error("unreadable");
      reconcileLiveLocationShare({ planId, via, memberToken }, next);
      setView(next);
      setNow(Date.now());
      setProblem("");
      if (next.live && next.endsAt) rememberLiveLocationNight({ planId, via, endsAt: next.endsAt });
      else forgetLiveLocationNight(planId);
    } catch {
      if (activeRead.current === request && !signal?.aborted && !ownerSignal.aborted) setProblem("We couldn't check who's sharing. Try again.");
    } finally {
      window.clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
    }
  }, [planId, via, memberToken]);

  useEffect(() => {
    if (stopOnly) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void read(controller.signal); });
    const poll = window.setInterval(() => { if (document.visibilityState !== "hidden") void read(controller.signal); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void read(controller.signal); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      activeRead.current?.abort();
      activeRead.current = null;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [read, status, stopOnly]);

  async function stop() {
    setBusy(true);
    try {
      const response = await stopLiveLocationShare({ planId, via, memberToken }, { endsAt: view?.endsAt });
      if (!response.ok) throw new Error("not stopped");
      setView(parsePlanLiveLocationView(await response.json()) ?? view);
      setProblem("");
    } catch {
      setProblem("We couldn't stop sharing. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!view || stopOnly) {
    return (stopOnly ? canStop : problem || canStop) ? (
      <section className="liveLocation" aria-label="Share where you are" aria-busy={stopping}>
        {problem ? <p role="alert">{problem}</p> : null}
        {STATUS_LINE[status] ? <p role="status">{STATUS_LINE[status]}</p> : null}
        {canStop ? <Button variant="secondary" disabled={stopping} onClick={() => void stop()}>{stopping ? "Stopping" : "Stop sharing"}</Button> : null}
        {problem && !stopOnly ? <Button variant="secondary" onClick={() => void read()}>Try again</Button> : null}
      </section>
    ) : null;
  }

  const until = view.endsAt ? clock(view.endsAt) : null;
  return (
    <section className="liveLocation" aria-label="Share where you are" aria-busy={stopping}>
      <h3>Share where you are</h3>
      {!view.live ? <p className="liveLocation__muted">You can share your location with your crew on the night.</p> : (
        <>
          {watching || paused ? (
            <p>{paused ? canResume
              ? "Your crew may still see where you were last. Resume to keep your dot live, or stop sharing."
              : "Your crew may still see where you were last. Stop sharing must finish before you can share again."
              : `You're sharing your live location with your crew until ${until}.`}</p>
          ) : (
            <p className="liveLocation__muted">Your crew sees your exact spot as a live dot on their map while this app is open. Only people in this night can see it. We keep only your latest spot, and sharing switches off by itself at {until}.</p>
          )}
          {STATUS_LINE[status] ? <p role="status">{STATUS_LINE[status]}</p> : null}
          <div className="liveLocation__actions">
            {watching || paused ? (
              <>
                {canResume ? <Button variant="secondary" disabled={stopping} onClick={() => void startLiveLocationShare(seat, { endsAt: view.endsAt })}>Resume sharing</Button> : null}
                <Button variant={paused ? "ghost" : "secondary"} disabled={stopping} onClick={() => void stop()}>{stopping ? "Stopping" : "Stop sharing"}</Button>
              </>
            ) : status !== "ended" && status !== "unsupported" ? (
              <Button variant="secondary" disabled={stopping} onClick={() => void startLiveLocationShare(seat, { endsAt: view.endsAt })}>{stopping ? "Stopping" : status === "denied" ? "Try again" : "Share my location tonight"}</Button>
            ) : null}
          </div>
          {view.people.length ? (
            <>
              <p className="liveLocation__muted">Sharing now</p>
              <ul className="liveLocation__people">
                {view.people.map((person) => {
                  const seen = lastSeen(person.updatedAt, now);
                  return <li key={person.memberId}>{person.name}{seen ? <span className="liveLocation__muted">, {seen}</span> : null}</li>;
                })}
              </ul>
              <Link className="liveLocation__link" href="/map" prefetch={false}>See your crew on the map</Link>
            </>
          ) : <p className="liveLocation__muted">Nobody else is sharing yet.</p>}
        </>
      )}
      {problem ? <p role="alert">{problem}</p> : null}
    </section>
  );
}
