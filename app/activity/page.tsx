"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import SiteNav from "@/components/nav/SiteNav";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import { authedFetch } from "@/lib/authedFetch";
import type { NotificationDTO, NotificationKind } from "@/lib/notifications";
import { normalizeHandle } from "@/lib/profiles";
import { relativeTime } from "@/lib/relativeTime";

import "./activity.css";

const HANDLE_KEY = "pubmax_handle";

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
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

export default function ActivityPage(): React.JSX.Element {
  const { handle: authHandle } = useAuth();
  const [handle, setHandle] = useState("");
  const [handleReady, setHandleReady] = useState(false);
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const fromAuth = normalizeHandle(authHandle ?? "");
      setHandle(fromAuth || readHandle());
      setHandleReady(true);
    });
    return () => {
      active = false;
    };
  }, [authHandle]);

  const load = useCallback(async () => {
    if (!handleReady) return;
    const h = normalizeHandle(authHandle ?? "") || handle.trim();
    if (!h) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const res = await authedFetch(`/api/notifications?handle=${encodeURIComponent(h)}`);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = (await res.json()) as { notifications?: NotificationDTO[] };
      setItems(Array.isArray(body.notifications) ? body.notifications : []);
      void authedFetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: h }),
      }).catch(() => {});
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [handle, handleReady, authHandle]);

  useEffect(() => {
    // Defer through a promise callback so setState (inside load) never runs
    // synchronously in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [load]);

  return (
    // The nav lives OUTSIDE the 640px-capped <main> (same shape as the other
    // pages' full-width shells) — nesting it inside the narrow column wrapped
    // the link row into three overlapping lines on desktop.
    <div className="activityShell">
      <SiteNav />

      <main className="activity">
        <header className="activityHead">
          <h1>Activity</h1>
          <p className="activitySub">Who followed you, reacted, commented, or saved your crawl.</p>
          {/* Quest chips (IDEAS B2-lite): "next badge" progress for the claimed
              handle. Renders nothing without a handle, so the signed-out empty
              state below stays exactly as it is. */}
          {handleReady && handle.trim() ? <NextBadgeChips handle={handle} /> : null}
        </header>

        {!handleReady || loading ? (
          <p className="activityLoading" role="status">
            Loading your activity…
          </p>
        ) : !handle.trim() ? (
          <EmptyState
            eyebrow="Activity"
            title="Sign in or claim a handle"
            body="Sign in with Google, or drop a pint to set a handle. Then follows, reactions, comments, and crawl saves show up here."
            action={<SignInButton />}
          />
        ) : failed ? (
          <EmptyState
            title="Couldn't load your activity"
            body="Couldn't reach the server. Try again in a moment."
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
                  {n.subjectLabel ? (
                    <span className="activitySubject">: {n.subjectLabel}</span>
                  ) : null}
                  <span className="activityTime"> · {relativeTime(n.createdAt)}</span>
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
    </div>
  );
}
