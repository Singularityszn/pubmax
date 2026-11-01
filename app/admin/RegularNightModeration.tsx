"use client";

// The moderator's queue of regular nights drinkers added
// (/api/admin/regular-nights), its own file for the reason the other queues
// are: one lane, one file. The parent owns the admin session; this component
// owns the list and the two verdicts.
//
// A verdict stamps a status and nothing else. Confirming a night does not make
// it a listing or a venue fact: it stays a drinker's dated report, and the
// reader stops printing the reporter's handle. Hiding one takes it off every
// surface.

import { useState } from "react";

import { adminAlert, adminStatus, type AdminNotice } from "@/lib/adminNotice";
import { regularNightTimeLabel } from "@/lib/regularNights";
import {
  REGULAR_NIGHT_REPORT_KIND_LABEL,
  REGULAR_NIGHT_REPORT_WEEKDAY_CHOICES,
  type ModeratorRegularNightReport,
  type RegularNightReportDecision,
} from "@/lib/regularNightReports";
import type { AdminRequest } from "./VenueSubmissionModeration";

function weekdayLabel(weekday: number): string {
  return REGULAR_NIGHT_REPORT_WEEKDAY_CHOICES.find((choice) => choice.weekday === weekday)?.label ?? "Unknown day";
}

export default function RegularNightModeration({ request }: { request: AdminRequest }) {
  const [rows, setRows] = useState<ModeratorRegularNightReport[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setNotice(null);
    try {
      const res = await request("/api/admin/regular-nights?status=open");
      if (!res) {
        setNotice(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        setNotice(adminAlert("Could not load regular nights."));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { reports?: ModeratorRegularNightReport[] };
      setRows(Array.isArray(body.reports) ? body.reports : []);
      setLoaded(true);
    } catch {
      setNotice(adminAlert("Could not reach the server."));
    } finally {
      setLoading(false);
    }
  }

  async function decide(row: ModeratorRegularNightReport, status: RegularNightReportDecision) {
    setPendingId(row.id);
    setNotice(null);
    try {
      const res = await request("/api/admin/regular-nights", {
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
    <section aria-labelledby="admin-regular-nights">
      <h2 id="admin-regular-nights" className="admin-section">Regular nights</h2>
      <p className="admin-sub">
        Weekly nights drinkers added, each with a photo of the board. Confirm one when the photo backs
        it. It stays a dated drinker report either way, never a listing.
      </p>
      <div className="admin-bar">
        <button type="button" className="admin-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Load open regular nights"}
        </button>
      </div>
      {notice ? (
        <div className="admin-msg" role={notice.tone}>
          {notice.text}
        </div>
      ) : null}
      {loaded && !loading && rows.length === 0 ? <p className="admin-empty">Nothing open.</p> : null}
      <div className="admin-list">
        {rows.map((row) => {
          const time = regularNightTimeLabel(row.startTime);
          return (
            <article key={row.id} className="admin-card" data-testid="admin-regular-night">
              <div className="admin-card-head">
                <span className="admin-venue-name">{row.venueName ?? "Unknown pub"}</span>
                <span className="admin-meta">{new Date(row.createdAt).toLocaleString("en-GB")}</span>
              </div>
              <p className="admin-meta">
                {REGULAR_NIGHT_REPORT_KIND_LABEL[row.kind]} · every {weekdayLabel(row.weekday)}
                {time ? `, ${time}` : ""} · {row.venueId}
              </p>
              {row.note ? <p className="admin-note">{row.note}</p> : null}
              {row.photoUrl ? (
                <a href={row.photoUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable asset */}
                  <img
                    src={row.photoUrl}
                    alt={`The board or poster for this night at ${row.venueName ?? "the pub"}`}
                    style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain" }}
                  />
                </a>
              ) : (
                <p className="admin-meta">The photo could not be opened.</p>
              )}
              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-btn"
                  disabled={pendingId === row.id}
                  onClick={() => void decide(row, "confirmed")}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={pendingId === row.id}
                  onClick={() => void decide(row, "hidden")}
                >
                  Hide
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
