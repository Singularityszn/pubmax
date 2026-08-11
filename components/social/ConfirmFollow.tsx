"use client";

// Confirm-follow sheet (Social Loop v1). The target of a shared "add me" link:
// /add/<handle>. It opens on a friend's handle and confirms adding them to your
// lot. A LOT is mutual — the copy says so — so this follows them, and you become
// each other's lot once they add you back. No email/password: the follower is the
// localStorage handle (same identity that drops a pint).
//
// When the link is the VIEWER's own handle, this becomes the share surface
// instead: copy / share your link so friends at the table can add you.

import Link from "next/link";
import { useEffect, useState } from "react";

import HandleAvatar from "@/components/profile/HandleAvatar";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import { authedFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";

type FollowState = "idle" | "working" | "done" | "error";

export default function ConfirmFollow({
  targetHandle,
  targetAvatarUrl,
}: {
  targetHandle: string;
  targetAvatarUrl?: string;
}) {
  const target = normalizeHandle(targetHandle);
  const [myHandle, setMyHandle] = useState<string | null>(null);
  const [state, setState] = useState<FollowState>("idle");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // setState fires from a microtask (never the sync effect body) per
  // react-hooks/set-state-in-effect — the house pattern on /feed.
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        setMyHandle(normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? ""));
      } catch {
        setMyHandle("");
      }
    });
  }, []);

  const isSelf = myHandle !== null && myHandle === target;
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/add/${target}` : `/add/${target}`;

  async function addToLot() {
    if (!myHandle) {
      setError("Choose a handle in your account first.");
      setState("error");
      return;
    }
    setState("working");
    setError("");
    try {
      const res = await authedFetch(`/api/profiles/${encodeURIComponent(target)}/follow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ follower: myHandle }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessageFrom(data, "Could not add them."));
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Try again.");
      setState("error");
    }
  }

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Add me on PUBMAXX", url: shareUrl });
        return;
      }
    } catch {
      // Share sheet dismissed / unavailable — fall through to clipboard.
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  }

  if (!target) {
    return (
      <section className="confirmFollow">
        <p className="confirmFollowError">That link is missing a handle.</p>
        <Link className="confirmFollowGhost" href="/social">
          Back to Social
        </Link>
      </section>
    );
  }

  // Self link → the share surface.
  if (isSelf) {
    return (
      <section className="confirmFollow" aria-label="Share your add link">
        <p className="confirmFollowEyebrow">Your lot</p>
        <h1 className="confirmFollowTitle">Share your link</h1>
        <p className="confirmFollowBody">
          This is your add link. Share it at the table. When a friend opens it and
          adds you, and you add them back, you&rsquo;re each other&rsquo;s lot.
        </p>
        <code className="confirmFollowUrl">{shareUrl}</code>
        <button type="button" className="confirmFollowPrimary" onClick={share}>
          {copied ? "Link copied" : "Share your link"}
        </button>
        <Link className="confirmFollowGhost" href="/social">
          Back to Social
        </Link>
      </section>
    );
  }

  if (state === "done") {
    return (
      <section className="confirmFollow" role="status">
        <p className="confirmFollowEyebrow">Your lot</p>
        <h1 className="confirmFollowTitle">{displayHandle(target)} added.</h1>
        <p className="confirmFollowBody">
          When they add you back, you&rsquo;re each other&rsquo;s lot and their
          nights show up in Your lot.
        </p>
        <Link className="confirmFollowPrimary" href="/social">
          Open Social
        </Link>
      </section>
    );
  }

  return (
    <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`}>
      <HandleAvatar
        handle={target}
        avatarUrl={targetAvatarUrl}
        className="confirmFollowAvatar"
        imageClassName="confirmFollowAvatar"
        size={56}
      />
      <p className="confirmFollowEyebrow">Your lot</p>
      <h1 className="confirmFollowTitle">Add {displayHandle(target)}?</h1>
      <p className="confirmFollowBody">
        A lot is mutual. Add them, and once they add you back their nights, drops
        and check-ins land in Your lot. No follower counts, no public list.
      </p>
      {state === "error" && error ? (
        <p className="confirmFollowError" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="confirmFollowPrimary"
        disabled={state === "working"}
        onClick={addToLot}
      >
        {state === "working" ? "Adding." : `Add ${displayHandle(target)}`}
      </button>
      <Link className="confirmFollowGhost" href="/social">
        Not now
      </Link>
    </section>
  );
}
