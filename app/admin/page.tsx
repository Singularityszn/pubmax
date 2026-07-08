"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";

import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import SiteNav from "@/components/nav/SiteNav";

import "./admin.css";

// Moderator DTO as returned by GET ?status=hidden. Photos resolve even on hidden
// rows; report metadata rides along. Kept loose (optional) — old rows may lack it.
type ModeratorDrop = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  status: string;
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  reportReason?: string;
  reportCount?: number;
  reportedAt?: string;
};

// Moderator comment DTO as returned by GET /api/admin/comments?status=hidden.
// Carries status + the drop it belongs to; never actor_hash.
type ModeratorComment = {
  id: string;
  pintDropId: string;
  handle: string;
  body: string;
  status: string;
  createdAt: string;
};

const SESSION_FETCH: RequestInit = { credentials: "include" };

async function establishSession(token: string): Promise<boolean> {
  if (token) {
    const res = await fetch("/api/admin/session", {
      ...SESSION_FETCH,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  }
  const res = await fetch("/api/admin/session", SESSION_FETCH);
  if (!res.ok) return false;
  const body = (await res.json()) as { authenticated?: boolean };
  return body.authenticated === true;
}

// venueId → name, resolved from the same app dataset the map groups. Fetched
// once (in the load handler) rather than adding a DB dependency just for names.
async function fetchVenueNames(): Promise<Map<string, string>> {
  const res = await fetch("/data/pint_prices_app_dataset.json");
  if (!res.ok) return new Map();
  const rows = (await res.json()) as VenuePrice[];
  return new Map(groupVenuePrices(rows).map((venue) => [venue.id, venue.name]));
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [drops, setDrops] = useState<ModeratorDrop[]>([]);
  const [venueNames, setVenueNames] = useState<Map<string, string>>(new Map());
  const [comments, setComments] = useState<ModeratorComment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const authed = await establishSession(token.trim());
      if (!authed) {
        setDrops([]);
        setComments([]);
        setMessage("Not authorised — check the admin token.");
        return;
      }

      const res = await fetch("/api/pint-drops?status=hidden", SESSION_FETCH);
      if (res.status === 403) {
        setDrops([]);
        setMessage("Not authorised — check the admin token.");
        return;
      }
      if (!res.ok) {
        setDrops([]);
        setMessage("Could not load reported drops.");
        return;
      }
      const body = (await res.json()) as { drops: ModeratorDrop[] };
      setDrops(body.drops ?? []);
      // Resolve venue names lazily alongside the queue — best-effort, so a
      // dataset fetch failure never blocks moderation.
      if ((body.drops ?? []).length > 0 && venueNames.size === 0) {
        try {
          setVenueNames(await fetchVenueNames());
        } catch {
          /* names stay unresolved; rows fall back to the venueId */
        }
      }
      // Also load the hidden-comment queue (story 37) with the same session, in the
      // same pass. Best-effort — a comments failure never blocks drop moderation.
      try {
        const cRes = await fetch("/api/admin/comments?status=hidden", SESSION_FETCH);
        if (cRes.ok) {
          const cBody = (await cRes.json()) as { comments: ModeratorComment[] };
          setComments(cBody.comments ?? []);
        } else {
          setComments([]);
        }
      } catch {
        setComments([]);
      }
      if ((body.drops ?? []).length === 0) setMessage("No reported drops in the queue.");
    } catch {
      setDrops([]);
      setMessage("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [token, venueNames.size]);

  const decideComment = useCallback(async (id: string, action: "restore" | "keep_hidden") => {
    setPendingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/comments", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (res.status === 403) {
        setMessage("Not authorised — check the admin token.");
        return;
      }
      if (!res.ok) {
        setMessage("Action failed — try again.");
        return;
      }
      // Decided comments leave the hidden queue either way.
      setComments((current) => current.filter((c) => c.id !== id));
      setMessage(action === "restore" ? "Comment restored." : "Comment kept hidden.");
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setPendingId(null);
    }
  }, []);

  const decide = useCallback(async (id: string, action: "restore" | "keep_hidden") => {
    setPendingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/pint-drops", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (res.status === 403) {
        setMessage("Not authorised — check the admin token.");
        return;
      }
      if (!res.ok) {
        setMessage("Action failed — try again.");
        return;
      }
      // Decided drops leave the queue either way (restore → visible,
      // keep_hidden → reviewed), so drop them from the list.
      setDrops((current) => current.filter((d) => d.id !== id));
      setMessage(action === "restore" ? "Pint Drop restored." : "Pint Drop kept hidden.");
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setPendingId(null);
    }
  }, []);

  return (
    <main className="admin">
      <SiteNav active="admin" />

      <h1>Pint Drop moderation</h1>
      <p className="admin-sub">Review reported community drops. Restore the good, keep the rest hidden.</p>
      <Link className="adminMapCallout" href="/map">
        Back to the live map
      </Link>

      <div className="admin-bar">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          aria-label="Admin token"
        />
        <button className="admin-btn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Load reported drops"}
        </button>
      </div>

      {message ? (
        <div
          className="admin-msg"
          role={message.startsWith("Not authorised") || message.startsWith("Could not") ? "alert" : "status"}
        >
          {message}
        </div>
      ) : null}

      {drops.length === 0 ? (
        <div className="admin-empty">
          <strong>Queue clear</strong>
          <span>Reported Pint Drops will appear here after they reach the review threshold.</span>
          <Link href="/map">Open the map</Link>
        </div>
      ) : (
        <div className="admin-list">
          {drops.map((d) => (
            <article className="admin-card" key={d.id}>
              <div className="admin-card-head">
                <span className="admin-handle">{d.handle}</span>
                {d.priceGbp != null ? <span className="admin-price">£{d.priceGbp.toFixed(2)}</span> : null}
              </div>

              <div className="admin-venue">
                <span className="admin-venue-name">{venueNames.get(d.venueId) ?? d.venueId}</span>
                <Link className="admin-venue-link" href={`/map?sel=${encodeURIComponent(d.venueId)}`}>
                  View on map
                </Link>
              </div>

              {d.passedDownNote ? <p className="admin-note">{d.passedDownNote}</p> : null}

              <div className="admin-meta">
                {d.era ? <span>Era: {d.era}</span> : null}
                {d.reportReason ? <span className="admin-report">Reason: {d.reportReason}</span> : null}
                <span className="admin-report">Reports: {d.reportCount ?? 1}</span>
                {d.reportedAt ? <span>Reported: {new Date(d.reportedAt).toLocaleString()}</span> : null}
              </div>

              {d.pintPhotoUrl || d.venuePhotoUrl ? (
                <div className="admin-photos">
                  {d.pintPhotoUrl ? (
                    <Image
                      src={d.pintPhotoUrl}
                      alt={`Pint photo reported from ${d.handle}`}
                      width={96}
                      height={96}
                      unoptimized
                    />
                  ) : null}
                  {d.venuePhotoUrl ? (
                    <Image
                      src={d.venuePhotoUrl}
                      alt={`Venue photo reported from ${d.handle}`}
                      width={96}
                      height={96}
                      unoptimized
                    />
                  ) : null}
                </div>
              ) : null}

              <div className="admin-actions">
                <button
                  className="admin-btn admin-restore"
                  onClick={() => decide(d.id, "restore")}
                  disabled={pendingId === d.id}
                >
                  {pendingId === d.id ? "Working…" : "Restore"}
                </button>
                <button
                  className="admin-btn admin-keep"
                  onClick={() => decide(d.id, "keep_hidden")}
                  disabled={pendingId === d.id}
                >
                  {pendingId === d.id ? "Working…" : "Keep hidden"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── Comment moderation queue (story 37) ─────────────────────────── */}
      <h2 className="admin-section">Hidden comments</h2>
      <p className="admin-sub">Review hidden Pint Drop comments. Restore the good, keep the rest hidden.</p>
      {comments.length === 0 ? (
        <div className="admin-empty">
          <strong>No hidden comments</strong>
          <span>Hidden or reported comments will appear here for review.</span>
        </div>
      ) : (
        <div className="admin-list">
          {comments.map((c) => (
            <article className="admin-card" key={c.id}>
              <div className="admin-card-head">
                <span className="admin-handle">{c.handle}</span>
                <span className="admin-report">{c.status}</span>
              </div>
              <p className="admin-note">{c.body}</p>
              <div className="admin-meta">
                <Link className="admin-venue-link" href={`/map?drop=${encodeURIComponent(c.pintDropId)}`}>
                  View the Pint Drop
                </Link>
                <span>Posted: {new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <div className="admin-actions">
                <button
                  className="admin-btn admin-restore"
                  onClick={() => decideComment(c.id, "restore")}
                  disabled={pendingId === c.id}
                >
                  {pendingId === c.id ? "Working…" : "Restore"}
                </button>
                <button
                  className="admin-btn admin-keep"
                  onClick={() => decideComment(c.id, "keep_hidden")}
                  disabled={pendingId === c.id}
                >
                  {pendingId === c.id ? "Working…" : "Keep hidden"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
