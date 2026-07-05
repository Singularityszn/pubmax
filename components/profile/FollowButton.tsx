"use client";

import { useState } from "react";

import type { FollowCounts } from "@/lib/followStore";

// Follow / unfollow control for a public profile. The follower is the viewer's
// self-asserted handle (localStorage `pubmax_handle`), passed in by the page so
// this button stays dumb about where identity comes from. Optimistic: it flips
// state immediately, POSTs, and reconciles from the server's authoritative
// counts (or rolls back on failure). Rendered only when there IS a viewer handle
// and it differs from the profile owner — the page owns that gate.
type FollowButtonProps = {
  targetHandle: string;
  followerHandle: string;
  initialFollowing: boolean;
  onCountsChange?: (counts: FollowCounts) => void;
};

export default function FollowButton({
  targetHandle,
  followerHandle,
  initialFollowing,
  onCountsChange,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const next = !following;
    setFollowing(next); // optimistic

    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(targetHandle)}/follow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          follower: followerHandle,
          action: next ? "follow" : "unfollow",
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setFollowing(!next); // roll back
        const message =
          body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "Couldn't update. Try again.";
        setError(message);
        return;
      }
      // Reconcile with the server's truth (handles already-following, races).
      if (body && typeof body === "object") {
        const b = body as { following?: boolean; counts?: FollowCounts };
        if (typeof b.following === "boolean") setFollowing(b.following);
        if (b.counts && onCountsChange) onCountsChange(b.counts);
      }
    } catch {
      setFollowing(!next); // roll back on network error
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profileFollow">
      <button
        type="button"
        className={`followBtn${following ? " isFollowing" : ""}`}
        aria-pressed={following}
        disabled={busy}
        onClick={toggle}
      >
        {following ? "Following" : "Follow"}
      </button>
      {error ? (
        <span className="followError" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
