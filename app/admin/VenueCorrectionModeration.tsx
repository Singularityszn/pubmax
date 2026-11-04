"use client";

// The moderator's queue of "That's wrong" notes (/api/admin/venue-corrections),
// its own file for the reason VenueSubmissionModeration is: one lane, one file.
// The parent owns the admin session; this component owns the list and the two
// verdicts.
//
// A verdict stamps a status and nothing else. Resolving a note does not close
// a pub or change its hours: the moderator fixes the fact through the pack
// rebuild first, so the copy here says "resolved", never "fixed".

import { useState } from "react";

import { adminAlert, adminStatus, type AdminNotice } from "@/lib/adminNotice";
import {
  VENUE_CORRECTION_KIND_LABEL,
  type ModeratorVenueCorrection,
  type VenueCorrectionDecision,
} from "@/lib/venueCorrections";
import type { AdminRequest } from "./VenueSubmissionModeration";

export default function VenueCorrectionModeration({ request }: { request: AdminRequest }) {
  const [rows, setRows] = useState<ModeratorVenueCorrection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setNotice(null);
    try {
      const res = await request("/api/admin/venue-corrections?status=open");
      if (!res) {
        setNotice(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        setNotice(adminAlert("Could not load corrections."));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { corrections?: ModeratorVenueCorrection[] };
      setRows(Array.isArray(body.corrections) ? body.corrections : []);
      setLoaded(true);
    } catch {
      setNotice(adminAlert("Could not reach the server."));
    } finally {
      setLoading(false);
    }
  }

  async function decide(row: ModeratorVenueCorrection, status: VenueCorrectionDecision) {
    setPendingId(row.id);
    setNotice(null);
    try {
      const res = await request("/api/admin/venue-corrections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, status }),
      });
      if (!res) {
        setNotice(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNotice(adminAlert(body.error || "Action failed. Try again."));
        return;
      }
      setRows((current) => current.filter((candidate) => candidate.id !== row.id));
      setNotice(adminStatus(`${row.venueName ?? row.venueId}: ${status}.`));
    } catch {
      setNotice(adminAlert("Could not reach the server."));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="admin-venue-corrections">
      <h2 id="admin-venue-corrections" className="admin-section">Corrections</h2>
      <p className="admin-sub">
        Drinkers saying a pub has shut, its hours are wrong, or something else on its sheet is off.
        Resolving one does not change the map: fix the fact in the pack first.
      </p>
      <div className="admin-bar">
        <button type="button" className="admin-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Load open corrections"}
        </button>
      </div>
      {notice ? (
        <div className="admin-msg" role={notice.tone}>
          {notice.text}
        </div>
      ) : null}
      {loaded && !loading && rows.length === 0 ? <p className="admin-empty">Nothing open.</p> : null}
      <div className="admin-list">
        {rows.map((row) => (
          <article key={row.id} className="admin-card" data-testid="admin-venue-correction">
            <div className="admin-card-head">
              <span className="admin-venue-name">{row.venueName ?? "Unknown pub"}</span>
              <span className="admin-meta">{new Date(row.createdAt).toLocaleString("en-GB")}</span>
            </div>
            <p className="admin-meta">
              {VENUE_CORRECTION_KIND_LABEL[row.kind]} · {row.venueId}
            </p>
            {row.note ? <p className="admin-note">{row.note}</p> : null}
            <div className="admin-actions">
              <button
                type="button"
                className="admin-btn"
                disabled={pendingId === row.id}
                onClick={() => void decide(row, "resolved")}
              >
                Resolve
              </button>
              <button
                type="button"
                className="admin-btn"
                disabled={pendingId === row.id}
                onClick={() => void decide(row, "dismissed")}
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
