"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Info, TrainFront } from "lucide-react";

type Signal = { headline?: string; detail?: string; kind?: string; severity?: string; timeWindow?: string; areas?: string[] };
type TubeLine = { line?: string; status?: string; disruption?: string };
export type TflPayload = { asOf?: string | null; signals?: Signal[]; tubeLines?: TubeLine[]; error?: string };
export type MobileTflStatus = { payload: TflPayload | null; failed: boolean; issueCount: number };

const GROUPS = ["Alerts", "Transport", "Events", "Other"] as const;
const TFL_CACHE_TTL_MS = 60_000;
let cachedTfl: { payload: TflPayload; receivedAt: number } | null = null;
let inflightTfl: Promise<TflPayload> | null = null;

function loadTflStatus(): Promise<TflPayload> {
  if (cachedTfl && Date.now() - cachedTfl.receivedAt < TFL_CACHE_TTL_MS) return Promise.resolve(cachedTfl.payload);
  if (inflightTfl) return inflightTfl;
  inflightTfl = fetch("/api/citymcp/status", { headers: { accept: "application/json" } })
    .then(async (response) => response.ok ? response.json() as Promise<TflPayload> : Promise.reject(new Error("status")))
    .then((payload) => {
      cachedTfl = { payload, receivedAt: Date.now() };
      return payload;
    })
    .finally(() => { inflightTfl = null; });
  return inflightTfl;
}

function groupFor(signal: Signal): (typeof GROUPS)[number] {
  const kind = signal.kind?.toLowerCase() ?? "";
  if (["alert", "alerts", "safety"].includes(kind)) return "Alerts";
  if (["transport", "transit", "tube", "tfl"].includes(kind)) return "Transport";
  if (["event", "events", "gig", "gigs"].includes(kind)) return "Events";
  return "Other";
}

export function useMobileTflStatus(): MobileTflStatus {
  const [payload, setPayload] = useState<TflPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadTflStatus()
      .then((value) => {
        if (!active) return;
        setPayload(value);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  const issueCount = useMemo(
    () => (payload?.signals?.length ?? 0) + (payload?.tubeLines?.filter((line) => line.status?.toLowerCase() !== "good service").length ?? 0),
    [payload],
  );
  return { payload, failed, issueCount };
}

function freshness(asOf?: string | null): React.ReactNode {
  if (!asOf) return null;
  const parsed = new Date(asOf);
  if (Number.isNaN(parsed.getTime())) return null;
  return <small className="mobileTflFreshness">Updated {parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>;
}

export default function MobileTflPanel({ status }: { status: MobileTflStatus }) {
  const { payload, failed } = status;

  const disrupted = useMemo(() => payload?.tubeLines?.filter((line) => line.status && line.status.toLowerCase() !== "good service") ?? [], [payload]);
  const grouped = useMemo(() => GROUPS.map((label) => ({ label, rows: (payload?.signals ?? []).filter((signal) => groupFor(signal) === label) })).filter((group) => group.rows.length), [payload]);

  if (failed) return <div className="mobileSheetEmpty" role="status"><Info /><strong>TfL updates are unavailable.</strong><p>The map and venue details still work.</p></div>;
  if (!payload) return <div className="mobileSheetSkeleton" role="status">Checking TfL live status</div>;
  if (!disrupted.length && !grouped.length) return <div className="mobileSheetEmpty" role="status"><TrainFront /><strong>No reported disruption.</strong><p>Checked live for this session.</p>{freshness(payload.asOf)}</div>;

  return (
    <div className="mobileTflGroups">
      {freshness(payload.asOf)}
      {disrupted.length ? <section><h3><TrainFront size={18} />Transport</h3><ul>{disrupted.map((line) => <li key={`${line.line}-${line.status}`}><strong>{line.line}</strong><span>{line.status}</span>{line.disruption ? <p>{line.disruption}</p> : null}</li>)}</ul></section> : null}
      {grouped.map((group) => <section key={group.label}><h3>{group.label === "Events" ? <CalendarClock size={18} /> : <AlertTriangle size={18} />}{group.label}</h3><ul>{group.rows.map((signal, index) => <li key={`${signal.headline}-${index}`}><strong>{signal.headline}</strong>{signal.detail ? <p>{signal.detail}</p> : null}<span>{[signal.timeWindow, signal.areas?.join(", ")].filter(Boolean).join(" · ")}</span></li>)}</ul></section>)}
    </div>
  );
}
