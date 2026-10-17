"use client";

// The videos waiting for a person to watch them (migration 0182). Nothing
// screens a video automatically, so a Social video stays with its author until
// a moderator approves it here. This lane fetches and decides for itself
// through /api/admin/social-videos, on the same admin session as the console.

import { useCallback, useEffect, useState } from "react";

type HeldVideo = { postId: string; contentType: string; byteSize: number; createdAt: string };
type LoadState = "loading" | "ready" | "unavailable";

const SESSION_FETCH: RequestInit = { credentials: "include" };

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SocialVideoModeration() {
  const [videos, setVideos] = useState<HeldVideo[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/social-videos", SESSION_FETCH);
      const body = response.ok ? (await response.json()) as { videos?: HeldVideo[] } : null;
      setVideos(body?.videos ?? []);
      setState(body ? "ready" : "unavailable");
    } catch {
      setState("unavailable");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function decide(postId: string, decision: "approved" | "rejected") {
    setPending(postId);
    setError(null);
    try {
      const response = await fetch("/api/admin/social-videos", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, decision }),
      });
      if (!response.ok) throw new Error("refused");
      setVideos((current) => current.filter((video) => video.postId !== postId));
    } catch {
      setError("That decision did not save. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <h2 className="admin-section">Social videos awaiting a watch</h2>
      {state === "loading" ? <div className="admin-empty" role="status">Loading videos…</div> : null}
      {state === "unavailable" ? (
        <div className="admin-empty" role="alert">
          <span>Social videos could not be loaded.</span>
          <button type="button" className="admin-retry" onClick={() => { setState("loading"); void load(); }}>Try again</button>
        </div>
      ) : null}
      {state === "ready" && videos.length === 0 ? (
        <div className="admin-empty"><strong>No Social videos awaiting review</strong></div>
      ) : null}
      {error ? <p className="admin-note" role="alert">{error}</p> : null}
      {state === "ready" && videos.length > 0 ? (
        <div className="admin-list">
          {videos.map((video) => (
            <article className="admin-card" key={video.postId}>
              <video
                className="admin-video"
                src={`/api/admin/social-videos?postId=${video.postId}`}
                controls
                preload="metadata"
                aria-label={`Held video on post ${video.postId}`}
              />
              <div className="admin-meta">
                <span>Post: {video.postId}</span>
                <span>{megabytes(video.byteSize)}</span>
                <span>Uploaded: <time dateTime={video.createdAt}>{new Date(video.createdAt).toLocaleString()}</time></span>
              </div>
              <div className="admin-actions">
                <button type="button" className="admin-btn admin-restore" disabled={pending !== null} onClick={() => void decide(video.postId, "approved")}>
                  {pending === video.postId ? "Saving…" : "Approve"}
                </button>
                <button type="button" className="admin-btn admin-keep" disabled={pending !== null} onClick={() => void decide(video.postId, "rejected")}>
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}
