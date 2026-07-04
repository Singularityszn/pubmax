"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";

import "./admin.css";

// Moderator DTO as returned by GET ?status=hidden. Photos resolve even on hidden
// rows; report metadata rides along. Kept loose (optional) — old rows may lack it.
type ModeratorDrop = {
  id: string;
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

const TOKEN_KEY = "pubmax_admin_token";

function readStoredToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export default function AdminPage() {
  // Lazy initialiser reads localStorage on first client render — no effect, so we
  // don't trip react-hooks/set-state-in-effect.
  const [token, setToken] = useState(readStoredToken);
  const [drops, setDrops] = useState<ModeratorDrop[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = token.trim();
    if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, t);
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pint-drops?status=hidden", {
        headers: { "x-admin-token": t },
      });
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
      if ((body.drops ?? []).length === 0) setMessage("No reported drops in the queue.");
    } catch {
      setDrops([]);
      setMessage("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const decide = useCallback(
    async (id: string, action: "restore" | "keep_hidden") => {
      const t = token.trim();
      setPendingId(id);
      setMessage(null);
      try {
        const res = await fetch("/api/pint-drops", {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-token": t },
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
    },
    [token],
  );

  return (
    <main className="admin">
      <nav className="siteNav adminNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map">Map</Link>
        <Link href="/admin" aria-current="page">
          Admin
        </Link>
      </nav>

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
    </main>
  );
}
