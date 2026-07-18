"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";

import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";
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

type AdminTab = "moderation" | "import";

type ImportNoteRow = {
  id: string;
  body: string;
  venueId: string | null;
  venueName: string | null;
  provenance: "sourced" | "contributor";
  status: "queued" | "dismissed";
  createdAt: string;
  dismissedAt?: string;
};

const TOKEN_KEY = "pubmax_admin_token";
const SESSION_FETCH: RequestInit = { credentials: "include" };

function readStoredToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

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
  // Lazy initialiser reads localStorage on first client render — no effect, so we
  // don't trip react-hooks/set-state-in-effect.
  const [token, setToken] = useState(readStoredToken);
  const [sessionEstablished, setSessionEstablished] = useState(false);
  const [tab, setTab] = useState<AdminTab>("moderation");
  const [drops, setDrops] = useState<ModeratorDrop[]>([]);
  const [venueNames, setVenueNames] = useState<Map<string, string>>(new Map());
  const [comments, setComments] = useState<ModeratorComment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Import notes (Wave F3) — durable queue + dismiss/restore.
  const [importBody, setImportBody] = useState("");
  const [importVenueId, setImportVenueId] = useState("");
  const [importVenueName, setImportVenueName] = useState("");
  const [importProvenance, setImportProvenance] = useState<"sourced" | "contributor">(
    "sourced",
  );
  const [importPending, setImportPending] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importNotes, setImportNotes] = useState<ImportNoteRow[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importShowDismissed, setImportShowDismissed] = useState(false);
  const [importActionId, setImportActionId] = useState<string | null>(null);

  const ensureAdminSession = useCallback(async (force = false): Promise<boolean> => {
    const t = token.trim();
    if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, t);
    if (sessionEstablished && !force) return true;
    const authed = await establishSession(t);
    setSessionEstablished(authed);
    return authed;
  }, [token, sessionEstablished]);

  const retryWithFreshSession = useCallback(async (request: () => Promise<Response>) => {
    const res = await request();
    if (res.status !== 403) return res;
    setSessionEstablished(false);
    if (!(await ensureAdminSession(true))) return res;
    return request();
  }, [ensureAdminSession]);

  const loadImportNotes = useCallback(async (opts?: { includeDismissed?: boolean }) => {
    setImportLoading(true);
    setImportMsg(null);
    const showDismissed = opts?.includeDismissed ?? importShowDismissed;
    try {
      // Prefer the httpOnly session cookie (same as drop/comment moderation) —
      // never send the raw ADMIN_TOKEN as a request header from the browser.
      const authed = await ensureAdminSession();
      if (!authed) {
        setImportNotes([]);
        setImportMsg("Not authorised. Check the admin token.");
        return;
      }
      const qs = showDismissed ? "?includeDismissed=1" : "";
      const res = await retryWithFreshSession(() =>
        fetch(`/api/admin/import-notes${qs}`, SESSION_FETCH),
      );
      if (res.status === 403) {
        setImportNotes([]);
        setImportMsg("Not authorised. Check the admin token.");
        return;
      }
      if (!res.ok) {
        setImportNotes([]);
        setImportMsg("Could not load import notes.");
        return;
      }
      const body = (await res.json()) as { notes?: ImportNoteRow[] };
      setImportNotes(body.notes ?? []);
    } catch {
      setImportNotes([]);
      setImportMsg("Could not reach the server.");
    } finally {
      setImportLoading(false);
    }
  }, [ensureAdminSession, importShowDismissed, retryWithFreshSession]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const authed = await ensureAdminSession();
      if (!authed) {
        setDrops([]);
        setComments([]);
        setMessage("Not authorised. Check the admin token.");
        return;
      }

      const res = await fetch("/api/pint-drops?status=hidden", SESSION_FETCH);
      if (res.status === 403) {
        setDrops([]);
        setMessage("Not authorised. Check the admin token.");
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
  }, [ensureAdminSession, venueNames.size]);

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
        setMessage("Not authorised. Check the admin token.");
        return;
      }
      if (!res.ok) {
        setMessage("Action failed. Try again.");
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
        setMessage("Not authorised. Check the admin token.");
        return;
      }
      if (!res.ok) {
        setMessage("Action failed. Try again.");
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

  async function submitImportNote() {
    setImportPending(true);
    setImportMsg(null);
    try {
      const authed = await ensureAdminSession();
      if (!authed) {
        setImportMsg("Not authorised. Check the admin token.");
        return;
      }
      const res = await retryWithFreshSession(() =>
        fetch("/api/admin/import-notes", {
          ...SESSION_FETCH,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: importBody,
            venueId: importVenueId.trim() || undefined,
            venueName: importVenueName.trim() || undefined,
            provenance: importProvenance,
          }),
        }),
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (res.status === 403) {
        setImportMsg("Not authorised. Check the admin token.");
        return;
      }
      if (!res.ok) {
        setImportMsg(payload.error ?? "Could not queue the note.");
        return;
      }
      setImportMsg(payload.message ?? "Queued for review");
      setImportBody("");
      setImportVenueId("");
      setImportVenueName("");
      await loadImportNotes();
    } catch {
      setImportMsg("Could not reach the server.");
    } finally {
      setImportPending(false);
    }
  }

  async function decideImportNote(id: string, action: "dismiss" | "restore") {
    setImportActionId(id);
    setImportMsg(null);
    try {
      const authed = await ensureAdminSession();
      if (!authed) {
        setImportMsg("Not authorised. Check the admin token.");
        return;
      }
      const res = await retryWithFreshSession(() =>
        fetch("/api/admin/import-notes", {
          ...SESSION_FETCH,
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action }),
        }),
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (res.status === 403) {
        setImportMsg("Not authorised. Check the admin token.");
        return;
      }
      if (!res.ok) {
        setImportMsg(payload.error ?? "Action failed. Try again.");
        return;
      }
      setImportMsg(payload.message ?? (action === "dismiss" ? "Note dismissed." : "Note restored."));
      await loadImportNotes();
    } catch {
      setImportMsg("Could not reach the server.");
    } finally {
      setImportActionId(null);
    }
  }

  return (
    <main className="admin">
      <SiteNav />

      <h1>Admin</h1>
      <p className="admin-sub">
        Review reported community drops, or queue a research note for moderated import.
      </p>
      <Link className="adminMapCallout" href="/map">
        Back to the live map
      </Link>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button
          type="button"
          role="tab"
          className={tab === "moderation" ? "admin-tab active" : "admin-tab"}
          aria-selected={tab === "moderation"}
          onClick={() => setTab("moderation")}
        >
          Moderation
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "import" ? "admin-tab active" : "admin-tab"}
          aria-selected={tab === "import"}
          onClick={() => {
            setTab("import");
            void loadImportNotes();
          }}
        >
          Import note
        </button>
      </div>

      <div className="admin-bar">
        <input
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setSessionEstablished(false);
          }}
          placeholder="Admin token"
          aria-label="Admin token"
        />
        {tab === "moderation" ? (
          <button className="admin-btn" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Load reported drops"}
          </button>
        ) : null}
      </div>

      {tab === "moderation" ? (
        <>
          {message ? (
            <div
              className="admin-msg"
              role={
                message.startsWith("Not authorised") || message.startsWith("Could not")
                  ? "alert"
                  : "status"
              }
            >
              {message}
            </div>
          ) : null}

          <h2 className="admin-section" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
            Pint Drop moderation
          </h2>
          <p className="admin-sub">
            Review reported community drops. Restore the good, keep the rest hidden.
          </p>

          {drops.length === 0 ? (
            <div className="admin-empty">
              <strong>Queue clear</strong>
              <span>
                Reported Pint Drops will appear here after they reach the review threshold.
              </span>
              <Link href="/map">Open the map</Link>
            </div>
          ) : (
            <div className="admin-list">
              {drops.map((d) => (
                <article className="admin-card" key={d.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{d.handle}</span>
                    {d.priceGbp != null ? (
                      <span className="admin-price">£{d.priceGbp.toFixed(2)}</span>
                    ) : null}
                  </div>

                  <div className="admin-venue">
                    <span className="admin-venue-name">
                      {venueNames.get(d.venueId) ?? d.venueId}
                    </span>
                    <Link
                      className="admin-venue-link"
                      href={venueMapUrl(d.venueId)}
                    >
                      View on map
                    </Link>
                  </div>

                  {d.passedDownNote ? <p className="admin-note">{d.passedDownNote}</p> : null}

                  <div className="admin-meta">
                    {d.era ? <span>Era: {d.era}</span> : null}
                    {d.reportReason ? (
                      <span className="admin-report">Reason: {d.reportReason}</span>
                    ) : null}
                    <span className="admin-report">Reports: {d.reportCount ?? 1}</span>
                    {d.reportedAt ? (
                      <span>Reported: {new Date(d.reportedAt).toLocaleString()}</span>
                    ) : null}
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
          <p className="admin-sub">
            Review hidden Pint Drop comments. Restore the good, keep the rest hidden.
          </p>
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
                    <Link
                      className="admin-venue-link"
                      href={`/map?drop=${encodeURIComponent(c.pintDropId)}`}
                    >
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
        </>
      ) : (
        <>
          <h2 className="admin-section" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
            Import note
          </h2>
          <p className="admin-sub">
            Queue a URL or research note for moderated review. Staff-entered only.
            No Reddit/X polling. Notes persist on disk when the server can write
            <code> .data/</code>.
          </p>

          {importMsg ? (
            <div
              className="admin-msg"
              role={
                importMsg.startsWith("Not authorised") ||
                importMsg.startsWith("Could not") ||
                importMsg.includes("required") ||
                importMsg.includes("too long") ||
                importMsg.includes("Provenance") ||
                importMsg.includes("failed")
                  ? "alert"
                  : "status"
              }
            >
              {importMsg}
            </div>
          ) : null}

          <form
            className="admin-import-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitImportNote();
            }}
          >
            <label className="admin-field">
              <span>URL or note text</span>
              <textarea
                value={importBody}
                onChange={(e) => setImportBody(e.target.value)}
                rows={5}
                required
                placeholder="https://… or a short research note"
                aria-label="URL or note text"
              />
            </label>
            <label className="admin-field">
              <span>Venue id (optional)</span>
              <input
                type="text"
                value={importVenueId}
                onChange={(e) => setImportVenueId(e.target.value)}
                placeholder="venue-…"
                aria-label="Optional venue id"
              />
            </label>
            <label className="admin-field">
              <span>Venue name (optional)</span>
              <input
                type="text"
                value={importVenueName}
                onChange={(e) => setImportVenueName(e.target.value)}
                placeholder="The Example Arms"
                aria-label="Optional venue name"
              />
            </label>
            <label className="admin-field">
              <span>Provenance</span>
              <select
                value={importProvenance}
                onChange={(e) =>
                  setImportProvenance(e.target.value as "sourced" | "contributor")
                }
                aria-label="Provenance"
              >
                <option value="sourced">sourced</option>
                <option value="contributor">contributor</option>
              </select>
            </label>
            <button className="admin-btn" type="submit" disabled={importPending}>
              {importPending ? "Queuing…" : "Submit for review"}
            </button>
          </form>

          <div className="admin-import-queue">
            <div className="admin-import-queue-head">
              <h3 className="admin-section" style={{ marginTop: 28 }}>
                Review queue
              </h3>
              <div className="admin-import-queue-actions">
                <label className="admin-field admin-inline-check">
                  <input
                    type="checkbox"
                    checked={importShowDismissed}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setImportShowDismissed(checked);
                      void loadImportNotes({ includeDismissed: checked });
                    }}
                  />
                  <span>Show dismissed</span>
                </label>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => void loadImportNotes()}
                  disabled={importLoading}
                >
                  {importLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
            </div>
            {importNotes.length === 0 ? (
              <p className="admin-sub" role="status">
                {importLoading ? "Loading notes…" : "No notes in the queue."}
              </p>
            ) : (
              <ul className="admin-import-list">
                {importNotes.map((note) => (
                  <li key={note.id} className="admin-import-item">
                    <div className="admin-import-meta">
                      <span className={`admin-import-status admin-import-status-${note.status}`}>
                        {note.status}
                      </span>
                      <span className="admin-import-prov">{note.provenance}</span>
                      <time dateTime={note.createdAt}>
                        {new Date(note.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p className="admin-import-body">{note.body}</p>
                    {note.venueName || note.venueId ? (
                      <p className="admin-import-venue">
                        {note.venueName ?? "Venue"}
                        {note.venueId ? ` · ${note.venueId}` : ""}
                      </p>
                    ) : null}
                    <div className="admin-actions">
                      {note.status === "queued" ? (
                        <button
                          type="button"
                          className="admin-btn admin-keep"
                          onClick={() => void decideImportNote(note.id, "dismiss")}
                          disabled={importActionId === note.id}
                        >
                          {importActionId === note.id ? "Working…" : "Dismiss"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-btn admin-restore"
                          onClick={() => void decideImportNote(note.id, "restore")}
                          disabled={importActionId === note.id}
                        >
                          {importActionId === note.id ? "Working…" : "Restore"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  );
}
