"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import EmptyState from "@/components/EmptyState";
import SiteNav from "@/components/nav/SiteNav";
import type { NotificationDTO, NotificationKind } from "@/lib/notifications";

import "./activity.css";

// The activity feed (story 34): a handle's notifications, newest-first. A simple
// list built from the same feed-card idioms — a line per event with the actor,
// what they did, and a link to the subject. Reads the viewer's self-asserted
// `pubmax_handle` (the same key the rest of the app writes); a signed-out viewer
// gets a friendly empty state rather than a broken page. Opening the page marks
// everything read (the bell's badge clears on the next poll).

const HANDLE_KEY = "pubmax_handle";

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HANDLE_KEY) ?? "").trim();
}

// A grounded one-liner per kind. Keeps the vocabulary in lockstep with the four
// notification kinds; an unknown kind (shouldn't happen — the store validates)
// falls back to a neutral verb.
function verb(kind: NotificationKind): string {
  switch (kind) {
    case "follow":
      return "started following you";
    case "reaction":
      return "reacted to your Pint Drop";
    case "comment":
      return "commented on your Pint Drop";
    case "crawl_save":
      return "saved your crawl";
    default:
      return "did something";
  }
}

// The subject link for a notification, or null when there's nothing to link to.
// follow → the actor's profile; reaction/comment → the drop on the map; crawl_save
// → the crawl story permalink.
function subjectHref(n: NotificationDTO): string | null {
  switch (n.kind) {
    case "follow":
      return `/u/${encodeURIComponent(n.actorHandle)}`;
    case "reaction":
    case "comment":
      return n.subjectRef ? `/map?drop=${encodeURIComponent(n.subjectRef)}` : null;
    case "crawl_save":
      return n.subjectRef ? `/crawls/${encodeURIComponent(n.subjectRef)}` : null;
    default:
      return null;
  }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function ActivityPage(): React.JSX.Element {
  // Read the handle after mount (not a lazy initialiser) so the server render and
  // hydration agree — reading localStorage during the first client render diverges
  // from the server's empty string and trips a hydration mismatch. `handleReady`
  // guards the empty-state flash until that post-mount read settles.
  const [handle, setHandle] = useState("");
  const [handleReady, setHandleReady] = useState(false);
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setHandle(readHandle());
      setHandleReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    // Wait for the post-mount handle read before deciding anything — otherwise the
    // initial empty handle would flip loading off and flash the empty state.
    if (!handleReady) return;
    const h = handle.trim();
    if (!h) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      // Read the inbox, then mark it all read (best-effort) so the bell clears.
      const res = await fetch(`/api/notifications?handle=${encodeURIComponent(h)}`);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = (await res.json()) as { notifications?: NotificationDTO[] };
      setItems(Array.isArray(body.notifications) ? body.notifications : []);
      // Fire-and-forget mark-read — a failure just leaves the badge up.
      void fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: h }),
      }).catch(() => {});
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [handle, handleReady]);

  useEffect(() => {
    // Defer through a promise callback so setState (inside load) never runs
    // synchronously in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [load]);

  return (
    <main className="activity">
      <SiteNav />

      <header className="activityHead">
        <h1>Activity</h1>
        <p className="activitySub">Who followed you, reacted, commented, or saved your crawl.</p>
      </header>

      {!handleReady || loading ? (
        <p className="activityLoading" role="status">
          Loading your activity…
        </p>
      ) : !handle.trim() ? (
        <EmptyState
          eyebrow="Activity"
          title="Claim a handle to see your activity"
          body="Drop a pint to set a handle — then follows, reactions, comments, and crawl saves show up here."
          action={
            <Link href="/map" className="activityCta">
              Open the map
            </Link>
          }
        />
      ) : failed ? (
        <EmptyState
          title="Couldn't load your activity"
          body="Something went wrong reaching the server. Try again in a moment."
          role="alert"
        />
      ) : items.length === 0 ? (
        <EmptyState
          eyebrow="Activity"
          title="Nothing yet"
          body="When people follow you, react to your Pint Drops, comment, or save your crawls, it shows up here."
          action={
            <Link href="/feed" className="activityCta">
              Browse the feed
            </Link>
          }
        />
      ) : (
        <ul className="activityList">
          {items.map((n) => {
            const href = subjectHref(n);
            return (
              <li key={n.id} className={n.read ? "activityItem" : "activityItem isUnread"}>
                <Link href={`/u/${encodeURIComponent(n.actorHandle)}`} className="activityActor">
                  @{n.actorHandle}
                </Link>{" "}
                <span className="activityVerb">{verb(n.kind)}</span>
                {n.subjectLabel ? <span className="activitySubject"> — {n.subjectLabel}</span> : null}
                <span className="activityTime"> · {timeAgo(n.createdAt)}</span>
                {href ? (
                  <Link href={href} className="activityLink">
                    View
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
