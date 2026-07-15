"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Info, TrainFront } from "lucide-react";

type Signal = { headline?: string; detail?: string; kind?: string; severity?: string; timeWindow?: string; areas?: string[] };
type TubeLine = { line?: string; status?: string; disruption?: string };
type TflPayload = { asOf?: string | null; signals?: Signal[]; tubeLines?: TubeLine[]; error?: string };

const GROUPS = ["Alerts", "Transport", "Events", "Other"] as const;

function groupFor(signal: Signal): (typeof GROUPS)[number] {
  const kind = signal.kind?.toLowerCase() ?? "";
  if (["alert", "alerts", "safety"].includes(kind)) return "Alerts";
  if (["transport", "transit", "tube", "tfl"].includes(kind)) return "Transport";
  if (["event", "events", "gig", "gigs"].includes(kind)) return "Events";
  return "Other";
}

export default function MobileTflPanel({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [payload, setPayload] = useState<TflPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/citymcp/status", { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() as Promise<TflPayload> : Promise.reject(new Error("status")))
      .then((value) => {
        if (controller.signal.aborted) return;
        setPayload(value);
        onCountChange?.((value.signals?.length ?? 0) + (value.tubeLines?.filter((line) => line.status?.toLowerCase() !== "good service").length ?? 0));
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [onCountChange]);

  const disrupted = useMemo(() => payload?.tubeLines?.filter((line) => line.status && line.status.toLowerCase() !== "good service") ?? [], [payload]);
  const grouped = useMemo(() => GROUPS.map((label) => ({ label, rows: (payload?.signals ?? []).filter((signal) => groupFor(signal) === label) })).filter((group) => group.rows.length), [payload]);

  if (failed) return <div className="mobileSheetEmpty" role="status"><Info /><strong>TfL updates are unavailable.</strong><p>The map and venue details still work.</p></div>;
  if (!payload) return <div className="mobileSheetSkeleton" role="status">Checking TfL live status</div>;
  if (!disrupted.length && !grouped.length) return <div className="mobileSheetEmpty" role="status"><TrainFront /><strong>No reported disruption.</strong><p>Checked live for this session.</p></div>;

  return (
    <div className="mobileTflGroups">
      {disrupted.length ? <section><h3><TrainFront size={18} />Transport</h3><ul>{disrupted.map((line) => <li key={`${line.line}-${line.status}`}><strong>{line.line}</strong><span>{line.status}</span>{line.disruption ? <p>{line.disruption}</p> : null}</li>)}</ul></section> : null}
      {grouped.map((group) => <section key={group.label}><h3>{group.label === "Events" ? <CalendarClock size={18} /> : <AlertTriangle size={18} />}{group.label}</h3><ul>{group.rows.map((signal, index) => <li key={`${signal.headline}-${index}`}><strong>{signal.headline}</strong>{signal.detail ? <p>{signal.detail}</p> : null}<span>{[signal.timeWindow, signal.areas?.join(", ")].filter(Boolean).join(" · ")}</span></li>)}</ul></section>)}
    </div>
  );
}
