"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { PLAN_BEACON_NOTE_MAX, PLAN_BEACON_SYMBOLS, type PlanBeacon, type PlanBeaconSymbol, type PlanBeaconView } from "@/lib/planBeacon";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

import "./planTableBeacon.css";

type Props = {
  planId: string;
  memberToken: string;
  /** Account/session identity, including same-account sign-out and return. Never sent. */
  ownerKey: string;
  /** Canonical route revision and latest action id. A change discards the old read. */
  refreshKey: string;
};

/** This boundary remounts private state before a changed owner or route can paint. */
export default function PlanTableBeacon({ planId, memberToken, ownerKey, refreshKey }: Props) {
  if (!memberToken || !ownerKey) return null;
  return <TableBeaconMember key={`${planId}:${memberToken}:${ownerKey}:${refreshKey}`} planId={planId} memberToken={memberToken} />;
}

function FullscreenSign({ beacon, pubName, onClose, returnFocusRef }: {
  beacon: PlanBeacon;
  pubName: string;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const panel = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const symbol = PLAN_BEACON_SYMBOLS.find((candidate) => candidate.id === beacon.symbol)!;
  useFocusTrap(true, panel, "strict-modal", returnFocusRef);
  useDismissOnEscape(true, onClose, panel);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  return createPortal(
    <section className="tableBeacon__fullscreen" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}>
      <Button variant="secondary" onClick={onClose}>Close table sign</Button>
      <h2 id={titleId}>{symbol.label} at {pubName}</h2>
      <svg className="tableBeacon__largeSymbol" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <text x="50" y="76" textAnchor="middle" fontSize="80">{symbol.glyph}</text>
      </svg>
      {beacon.note ? <p>{beacon.note}</p> : null}
      <p className="tableBeacon__privacy">Only your crew can read this sign.</p>
    </section>,
    document.body,
  );
}

function memberView(value: unknown): PlanBeaconView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as Partial<PlanBeaconView>;
  if (view.visibility !== "member" || typeof view.canEdit !== "boolean" || !Number.isInteger(view.routeRevision)) return null;
  for (const stop of [view.current, view.next]) {
    if (stop !== null && (!stop || typeof stop.venueId !== "string" || typeof stop.venueName !== "string" || !Number.isInteger(stop.position))) return null;
  }
  if (view.arrivalId !== null && typeof view.arrivalId !== "string") return null;
  if (view.beacon !== null) {
    const sign = view.beacon;
    if (!sign || !PLAN_BEACON_SYMBOLS.some((symbol) => symbol.id === sign.symbol)
      || typeof sign.note !== "string" || [...sign.note].length > PLAN_BEACON_NOTE_MAX
      || !Number.isFinite(Date.parse(sign.expiresAt))) return null;
  }
  return view as PlanBeaconView;
}

function TableBeaconMember({ planId, memberToken }: Pick<Props, "planId" | "memberToken">) {
  const [snapshot, setView] = useState<PlanBeaconView | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [symbol, setSymbol] = useState<PlanBeaconSymbol>("star");
  const [note, setNote] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const opener = useRef<HTMLButtonElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const edited = useRef(false);
  const generation = useRef(0);
  const inputId = useId();
  const endpoint = `/api/plans/${encodeURIComponent(planId)}/beacon`;
  const view = clock - receivedAt <= 35_000 ? snapshot : null;

  const read = useCallback(async () => {
    if (working.current) return;
    const serial = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const deadline = window.setTimeout(() => {
      request.abort();
      if (alive.current && serial === generation.current) {
        setView(null);
        setFullscreen(false);
        setLoading(false);
        setProblem("The table sign could not be read. Try again.");
      }
    }, 8_000);
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin", headers: { authorization: `Bearer ${memberToken}` }, signal: request.signal });
      const body: unknown = await response.json();
      if (request.signal.aborted || !alive.current || serial !== generation.current) return;
      if (!response.ok) throw new Error(errorMessageFrom(body, "The table sign could not be read. Try again."));
      const result = memberView(body);
      if (!result) throw new Error("The table sign could not be read. Try again.");
      setView(result);
      setReceivedAt(Date.now());
      setClock(Date.now());
      setProblem("");
      if (!edited.current) {
        setSymbol(result.beacon?.symbol ?? "star");
        setNote(result.beacon?.note ?? "");
      }
    } catch (error) {
      if (!request.signal.aborted && alive.current && serial === generation.current) {
        setView(null);
        setProblem(error instanceof Error ? error.message : "The table sign could not be read. Try again.");
      }
    } finally {
      window.clearTimeout(deadline);
      if (!request.signal.aborted && alive.current && serial === generation.current) setLoading(false);
    }
  }, [endpoint, memberToken]);

  useEffect(() => {
    alive.current = true;
    let mounted = true;
    queueMicrotask(() => { if (mounted) void read(); });
    const refresh = () => {
      if (document.visibilityState === "hidden" || working.current) return;
      setClock(Date.now());
      setView(null);
      setFullscreen(false);
      setProblem("");
      setLoading(true);
      void read();
    };
    const poll = window.setInterval(() => { if (document.visibilityState !== "hidden") void read(); }, 30_000);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      alive.current = false;
      controller.current?.abort();
      window.clearInterval(poll);
      window.clearInterval(clockTimer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [read]);

  async function mutate(method: "PUT" | "DELETE") {
    if (working.current || !view?.current || !view.arrivalId) return;
    working.current = true;
    const serial = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setProblem("");
    const deadline = window.setTimeout(() => {
      request.abort();
      working.current = false;
      if (alive.current && serial === generation.current) {
        setBusy(false);
        setView(null);
        setFullscreen(false);
        setProblem("The table sign update could not be checked. Refresh before trying again.");
      }
    }, 8_000);
    try {
      const response = await fetch(endpoint, {
        method, credentials: "same-origin", cache: "no-store", signal: request.signal,
        headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" },
        body: JSON.stringify({ symbol, note, expectedRouteRevision: view.routeRevision, expectedArrivalId: view.arrivalId }),
      });
      const body: unknown = await response.json();
      if (request.signal.aborted || !alive.current || serial !== generation.current) return;
      if (!response.ok) throw new Error(errorMessageFrom(body, "The table sign was not saved. Try again."));
      const result = memberView(body);
      if (!result) throw new Error("The table sign was not saved. Try again.");
      setView(result);
      setReceivedAt(Date.now());
      setClock(Date.now());
      edited.current = false;
      if (method === "DELETE") setNote("");
    } catch (error) {
      if (!request.signal.aborted && alive.current && serial === generation.current) {
        setView(null);
        setProblem(error instanceof Error ? error.message : "The table sign was not saved. Try again.");
      }
    } finally {
      window.clearTimeout(deadline);
      working.current = false;
      if (!request.signal.aborted && alive.current && serial === generation.current) setBusy(false);
    }
  }

  const beacon = view?.beacon && Date.parse(view.beacon.expiresAt) > clock ? view.beacon : null;
  const chosen = PLAN_BEACON_SYMBOLS.find((candidate) => candidate.id === beacon?.symbol);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void mutate("PUT"); }
  const closeSign = useCallback(() => setFullscreen(false), []);

  return (
    <section className="tableBeacon" aria-label="Find our table" aria-busy={busy || loading}>
      <h3>Find our table</h3>
      <p className="tableBeacon__privacy">A sign for your crew. It clears when you move on, and lasts at most two hours.</p>
      {loading ? <p role="status">Reading your crew&rsquo;s table sign.</p> : null}
      {problem ? <div role="alert"><p>{problem}</p><Button variant="secondary" onClick={() => void read()}>Try again</Button></div> : null}
      {view && !view.current ? <p>Use “We are here” at your pub before setting a table sign.</p> : null}
      {view?.current ? (
        <>
          <p>At {view.current.venueName}</p>
          {beacon && chosen ? (
            <div className="tableBeacon__sign">
              <span className="tableBeacon__symbol" aria-hidden="true">{chosen.glyph}</span>
              <strong>{chosen.label}</strong>
              {beacon.note ? <p>{beacon.note}</p> : null}
              <Button variant="secondary" onClick={() => setFullscreen(true)} ref={opener}>Show table sign full screen</Button>
            </div>
          ) : <p>No table sign is set here.</p>}
          {view.canEdit ? (
            <form className="tableBeacon__form" onSubmit={submit}>
              <label htmlFor={`${inputId}-symbol`}>Your table symbol</label>
              <select id={`${inputId}-symbol`} value={symbol} onChange={(event) => { edited.current = true; setSymbol(event.target.value as PlanBeaconSymbol); }} disabled={busy}>
                {PLAN_BEACON_SYMBOLS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              </select>
              <label htmlFor={`${inputId}-note`}>Where to find you</label>
              <textarea id={`${inputId}-note`} value={note} maxLength={PLAN_BEACON_NOTE_MAX} onChange={(event) => { edited.current = true; setNote(event.target.value); }} disabled={busy} placeholder="Upstairs, by the window" />
              <p className="tableBeacon__privacy">Keep it to the table. Leave out phone numbers and private details.</p>
              <div className="tableBeacon__actions">
                <Button variant="secondary" type="submit" disabled={busy}>{busy ? "Saving table sign" : "Set table sign"}</Button>
                {beacon ? <Button variant="ghost" type="button" onClick={() => void mutate("DELETE")} disabled={busy}>Remove table sign</Button> : null}
              </div>
            </form>
          ) : null}
          <div className="tableBeacon__links">
            <Link href={`/map?sel=${encodeURIComponent(view.current.venueId)}` as Route}>Meet us at {view.current.venueName}</Link>
            {view.next ? <Link href={`/map?sel=${encodeURIComponent(view.next.venueId)}` as Route}>Meet us next at {view.next.venueName}</Link> : null}
          </div>
          {fullscreen && beacon ? <FullscreenSign beacon={beacon} pubName={view.current.venueName} onClose={closeSign} returnFocusRef={opener} /> : null}
        </>
      ) : null}
    </section>
  );
}
