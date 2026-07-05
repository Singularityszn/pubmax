"use client";

import { useCallback, useEffect, useState } from "react";

// The comment thread under a Pint Drop — where a drop's story continues after
// the night (cc_plan2 §4). Collapsed by default so it stays out of the way on a
// mobile feed; expanding lazily fetches the thread (visible-only, oldest-first)
// and reveals a compact composer.
//
// Resilience contract: this component NEVER crashes its host page. A failed
// fetch or post shows a quiet inline message and leaves the drop card intact —
// the feed treats "no comments" and "comments unavailable" the same way.
//
// React 19 hygiene: fetch happens inside an effect (with AbortController
// cleanup); setState only ever runs in async handlers / effect callbacks, never
// synchronously during render (react-hooks/set-state-in-effect). The remembered
// handle is read once via lazy useState init and written only in a handler.

type Comment = {
  id: string;
  handle: string;
  body: string;
  createdAt: string;
};

const HANDLE_STORAGE_KEY = "pubmax:comment:handle";
const MAX_BODY = 500;

// Lazy, guarded localStorage read — runs once in useState init, never in an
// effect. Any access error (private mode / disabled storage) → empty handle.
function readStoredHandle(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(HANDLE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredHandle(handle: string): void {
  try {
    window.localStorage.setItem(HANDLE_STORAGE_KEY, handle);
  } catch {
    // Storage full / denied — best-effort persistence; the in-memory value the
    // user typed still drives this session.
  }
}

// Whole-number "n ago" relative time — matches the feed card's format. Only ever
// called in render off a stable createdAt.
function relativeTime(createdAt: string): string {
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export default function CommentThread({ dropId }: { dropId: string }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle is read from storage exactly once (lazy init); the textarea below is
  // the working draft.
  const [handle, setHandle] = useState<string>(() => readStoredHandle());
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  // Fetch the thread when the panel first opens (or the drop changes while
  // open). AbortController cleanup cancels an in-flight request so a fast
  // collapse/re-expand can't land a stale response.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // All setState runs inside the promise callbacks below, never synchronously
    // in the effect body (react-hooks/set-state-in-effect). The first .then()
    // flips the loading flag once the request is actually in flight.
    Promise.resolve()
      .then(() => {
        setLoading(true);
        setError(null);
        return fetch(`/api/pint-drops/comments?dropId=${encodeURIComponent(dropId)}`, {
          signal: controller.signal,
        });
      })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { comments?: Comment[] }) => {
        setComments(Array.isArray(data.comments) ? data.comments : []);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return; // expected on unmount / collapse — not an error to surface
        }
        setError("Couldn't load comments.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, dropId]);

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedHandle = handle.trim();
      const trimmedBody = body.trim();
      if (!trimmedHandle || !trimmedBody || posting) return;

      setPosting(true);
      setError(null);
      writeStoredHandle(trimmedHandle);

      try {
        const res = await fetch("/api/pint-drops/comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dropId, handle: trimmedHandle, body: trimmedBody }),
        });
        if (!res.ok) {
          setError(
            res.status === 429
              ? "You're commenting too fast — give it a sec."
              : "Couldn't post that comment.",
          );
          return;
        }
        const data = (await res.json()) as { comment?: Comment };
        // Reconcile from the server response (server-cleaned handle/body, real
        // id + timestamp) rather than trusting the optimistic local copy.
        if (data.comment) {
          setComments((prev) => [...prev, data.comment as Comment]);
          setBody("");
        }
      } catch {
        setError("Couldn't post that comment.");
      } finally {
        setPosting(false);
      }
    },
    [handle, body, posting, dropId],
  );

  const count = comments.length;

  return (
    <section className="commentThread" aria-label="Comments">
      <button
        type="button"
        className="commentToggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide comments" : loaded && count ? `Comments (${count})` : "Comments"}
      </button>

      {open ? (
        <div className="commentPanel">
          {loading ? <p className="commentStatus">Loading comments…</p> : null}

          {!loading && loaded && count === 0 ? (
            <p className="commentEmpty">No comments yet — start the story.</p>
          ) : null}

          {count > 0 ? (
            <ul className="commentList">
              {comments.map((c) => {
                const ago = relativeTime(c.createdAt);
                return (
                  <li key={c.id} className="commentItem">
                    <span className="commentHandle">@{c.handle}</span>
                    {ago ? (
                      <time className="commentTime" dateTime={c.createdAt}>
                        {ago}
                      </time>
                    ) : null}
                    <p className="commentBody">{c.body}</p>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <form className="commentForm" onSubmit={submit}>
            <input
              className="commentHandleInput"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="Your handle"
              aria-label="Your handle"
              maxLength={40}
              autoComplete="off"
            />
            <textarea
              className="commentBodyInput"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add to the story…"
              aria-label="Your comment"
              maxLength={MAX_BODY}
              rows={2}
            />
            <button
              type="submit"
              className="commentSubmit"
              disabled={posting || !handle.trim() || !body.trim()}
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </form>

          {error ? (
            <p className="commentError" role="status">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
