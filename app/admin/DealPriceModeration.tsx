"use client";

import { useCallback, useEffect, useState } from "react";
import type { DealPrice } from "@/lib/dealPrice";
import { formatGbp } from "@/lib/formatGbp";
import { drinkMeasureName } from "@/lib/drinkMeasure";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Row = DealPrice & { hidden: boolean; revision: string };

export default function DealPriceModeration({ sessionReady }: { sessionReady: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("Open a moderation session to review deals.");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/deal-prices", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Read failed");
      const body = await response.json();
      if (!Array.isArray(body.deals)) throw new Error("Invalid response");
      setRows(body.deals);
      setMessage(body.deals.length ? "" : "No reported or hidden deals.");
    } catch { setRows([]); setMessage("Could not load deal reports. Open a moderation session and try again."); }
  }, []);
  useEffect(() => { if (sessionReady) void Promise.resolve().then(load); }, [load, sessionReady]);
  async function decide(row: Row, action: "hide" | "restore" | "keep") {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/deal-prices", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: row.id, revision: row.revision, action }) });
      if (response.status === 409) { await load(); setMessage("The deal changed. Review it again."); return; }
      if (!response.ok) throw new Error("Update failed");
      await load();
    } catch { setMessage("Could not update the deal. Try again."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Deal moderation">
    <h2 className="admin-section">Deal moderation</h2>
    {message ? <p role="status">{message}</p> : null}
    {sessionReady ? <button type="button" disabled={busy} onClick={() => { void load(); }}>Refresh deals</button> : null}
    {rows.map((row) => <article className="admin-list" key={row.id}>
      <p><a href={`/map?sel=${encodeURIComponent(row.venueId)}`}>{row.venueId}</a> · {formatGbp(row.priceGbp)} · {row.drink} · {drinkMeasureName(row.measure, row.measureLabel)}</p>
      <p>{row.schedule.days.map((day) => DAYS[day]).join(", ")} · {row.schedule.start} to {row.schedule.end}{row.schedule.end < row.schedule.start ? " next day" : ""} · {row.conditions || "No conditions given"}</p>
      <p>Reported {row.reportedAt}{row.endDate ? ` · Ends ${row.endDate}` : " · No end date"}</p>
      {row.hidden ? <button type="button" disabled={busy} onClick={() => { void decide(row, "restore"); }}>Restore</button> : <><button type="button" disabled={busy} onClick={() => { void decide(row, "hide"); }}>Hide</button><button type="button" disabled={busy} onClick={() => { void decide(row, "keep"); }}>Keep</button></>}
    </article>)}
  </section>;
}
