"use client";

// The moderator's queue of pubs drinkers have added (/api/admin/venue-submissions),
// lifted out of AdminClient for the reason VenuePhotoModeration was: one lane,
// one file. The parent owns the admin session; this component owns the list,
// its status filter and the three verdicts.
//
// A verdict stamps a status and nothing else. Accepting a pub does not draw a
// pin: the offline pack rebuild folds accepted submissions in, so the copy here
// says "accepted", never "published". Submitted links are shown for the
// moderator to open by hand; nothing here fetches them.

import { useState } from "react";

import { categoryLabel } from "@/lib/drinks";
import { DRINK_MEASURE_LABEL } from "@/lib/drinkMeasure";
import { formatGbp } from "@/lib/formatGbp";
import { adminAlert, adminStatus, type AdminNotice } from "@/lib/adminNotice";
import {
  VENUE_SUBMISSION_REVIEWER_NOTE_MAX,
  VENUE_SUBMISSION_STATUSES,
  type VenueSubmissionPrice,
  type VenueSubmissionStatus,
} from "@/lib/venueSubmissions";

export type ModeratorVenueSubmission = {
  id: string;
  name: string;
  address: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  website: string;
  menuUrl: string;
  openingHours: string;
  note: string;
  prices: VenueSubmissionPrice[];
  status: VenueSubmissionStatus;
  duplicateOfVenueId: string | null;
  reviewerNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  files: { id: string; kind: "image"; byteSize: number; url: string | null }[];
};

export type AdminRequest = (path: string, init?: RequestInit) => Promise<Response | null>;

type Verdict = "accept" | "decline" | "duplicate";

const STATUS_HEADING: Record<VenueSubmissionStatus, string> = {
  pending: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
  duplicate: "Duplicates",
};

function fileLabel(file: ModeratorVenueSubmission["files"][number], index: number): string {
  const size = `${Math.max(1, Math.round(file.byteSize / 1024))} KB`;
  return `Menu photo ${index + 1} (${size})`;
}

export default function VenueSubmissionModeration({ request }: { request: AdminRequest }) {
  // Null until a lane is chosen: the console loads a queue when it is asked, like its neighbours.
  const [status, setStatus] = useState<VenueSubmissionStatus | null>(null);
  const [rows, setRows] = useState<ModeratorVenueSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<Record<string, string>>({});

  async function load(which: VenueSubmissionStatus) {
    setStatus(which);
    setLoading(true);
    setNotice(null);
    try {
      const res = await request(`/api/admin/venue-submissions?status=${which}`);
      if (!res) {
        setNotice(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        setNotice(adminAlert("Could not load added pubs."));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { submissions?: ModeratorVenueSubmission[] };
      setRows(Array.isArray(body.submissions) ? body.submissions : []);
    } catch {
      setNotice(adminAlert("Could not reach the server."));
    } finally {
      setLoading(false);
    }
  }

  async function decide(row: ModeratorVenueSubmission, verdict: Verdict) {
    setPendingId(row.id);
    setNotice(null);
    try {
      const res = await request("/api/admin/venue-submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: verdict,
          id: row.id,
          note: notes[row.id] || undefined,
          duplicateOfVenueId: verdict === "duplicate" ? duplicates[row.id] : undefined,
        }),
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
      setNotice(adminStatus(`${row.name}: ${verdict === "accept" ? "accepted" : verdict === "decline" ? "declined" : "marked as a duplicate"}.`));
    } catch {
      setNotice(adminAlert("Could not reach the server."));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="admin-venue-submissions">
      <h2 id="admin-venue-submissions" className="admin-section">Added pubs</h2>
      <p className="admin-sub">
        Pubs drinkers say the map is missing. Accepting one queues it for the next pack rebuild; it does
        not draw a pin. Open links and menus by hand: nothing here fetches them.
      </p>
      <div className="admin-bar">
        {VENUE_SUBMISSION_STATUSES.map((option) => (
          <button
            key={option}
            type="button"
            className="admin-btn"
            aria-pressed={option === status}
            onClick={() => void load(option)}
            disabled={loading}
          >
            {STATUS_HEADING[option]}
          </button>
        ))}
      </div>
      {notice ? (
        <div className="admin-msg" role={notice.tone}>
          {notice.text}
        </div>
      ) : null}
      {status === null ? (
        <p className="admin-empty">Choose a lane to load it.</p>
      ) : !loading && rows.length === 0 ? (
        <p className="admin-empty">Nothing in this lane.</p>
      ) : null}
      <div className="admin-list">
        {rows.map((row) => (
          <article key={row.id} className="admin-card" data-testid="admin-venue-submission">
            <div className="admin-card-head">
              <span className="admin-venue-name">{row.name}</span>
              <span className="admin-meta">{new Date(row.createdAt).toLocaleString("en-GB")}</span>
            </div>
            <p className="admin-note">
              {row.address}
              {row.postcode ? `, ${row.postcode}` : ""}
              {row.latitude !== null && row.longitude !== null
                ? ` (${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)})`
                : ""}
            </p>
            {row.website ? (
              <p className="admin-meta">
                Website:{" "}
                <a href={row.website} target="_blank" rel="noopener noreferrer nofollow">{row.website}</a>
              </p>
            ) : null}
            {row.menuUrl ? (
              <p className="admin-meta">
                Menu link:{" "}
                <a href={row.menuUrl} target="_blank" rel="noopener noreferrer nofollow">{row.menuUrl}</a>
              </p>
            ) : null}
            {row.openingHours ? <p className="admin-meta">Hours: {row.openingHours}</p> : null}
            {row.note ? <p className="admin-note">{row.note}</p> : null}
            {row.prices.length > 0 ? (
              <ul className="admin-meta">
                {row.prices.map((price, index) => (
                  <li key={index}>
                    {categoryLabel(price.drinkCategory)}
                    {price.drinkName ? ` (${price.drinkName})` : ""}: {formatGbp(price.priceGbp)},{" "}
                    {DRINK_MEASURE_LABEL[price.measure].toLowerCase()}
                  </li>
                ))}
              </ul>
            ) : null}
            {row.files.length > 0 ? (
              <ul className="admin-meta">
                {row.files.map((file, index) => (
                  <li key={file.id}>
                    {file.url ? (
                      <a href={file.url} target="_blank" rel="noopener noreferrer">{fileLabel(file, index)}</a>
                    ) : (
                      `${fileLabel(file, index)} (no link: storage is not configured)`
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {row.status === "pending" ? (
              <div className="admin-actions">
                <label className="admin-field">
                  <span>Note (optional)</span>
                  <input
                    value={notes[row.id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                    maxLength={VENUE_SUBMISSION_REVIEWER_NOTE_MAX}
                  />
                </label>
                <label className="admin-field">
                  <span>Duplicate of venue id</span>
                  <input
                    value={duplicates[row.id] ?? ""}
                    onChange={(event) => setDuplicates((current) => ({ ...current, [row.id]: event.target.value }))}
                    placeholder="venue-uk-n123"
                  />
                </label>
                <button type="button" className="admin-btn" disabled={pendingId === row.id} onClick={() => void decide(row, "accept")}>
                  Accept
                </button>
                <button type="button" className="admin-btn" disabled={pendingId === row.id} onClick={() => void decide(row, "decline")}>
                  Decline
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={pendingId === row.id || !(duplicates[row.id] ?? "").trim()}
                  onClick={() => void decide(row, "duplicate")}
                >
                  Mark duplicate
                </button>
              </div>
            ) : (
              <p className="admin-meta">
                {STATUS_HEADING[row.status]}
                {row.duplicateOfVenueId ? ` of ${row.duplicateOfVenueId}` : ""}
                {row.reviewerNote ? `: ${row.reviewerNote}` : ""}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
