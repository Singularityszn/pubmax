"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// Notification bell (story 34). A tiny client island in the site nav: it polls the
// viewer's unread count and links to /activity. Cheap by design — no websockets:
// it re-fetches on window focus and on a slow interval, and never more than the
// unread count (one small GET). A signed-out viewer (no `pubmax_handle`) sees a
// plain bell with no badge and the poll is skipped entirely.
//
// The handle is the same self-asserted `pubmax_handle` the rest of the app writes.
// A fetch failure is swallowed (the badge just doesn't update) so a notifications
// outage never breaks the nav.

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 60_000; // slow poll — the bell is ambient, not real-time

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HANDLE_KEY) ?? "").trim();
}

export default function NotificationBell(): React.JSX.Element {
  // Lazy initialiser reads localStorage on first client render — no effect.
  const [handle] = useState(readHandle);
  const [unread, setUnread] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const h = handle.trim();
    if (!h) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/notifications?handle=${encodeURIComponent(h)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const body = (await res.json()) as { unread?: number };
      setUnread(typeof body.unread === "number" ? body.unread : 0);
    } catch {
      // Aborted / offline — leave the badge as-is; the nav never breaks on this.
    }
  }, [handle]);

  // Poll on mount, on window focus (cheap catch-up when you return to the tab),
  // and on a slow interval. All three funnel through the one refresh(), whose
  // setState only runs inside an async promise callback — never synchronously in
  // the effect body (react-hooks/set-state-in-effect), so the mount poll is
  // deferred through Promise.resolve().then like the rest of the app's fetchers.
  useEffect(() => {
    if (!handle.trim()) return;
    void Promise.resolve().then(() => refresh());
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [handle, refresh]);

  const label = unread > 0 ? `Activity — ${unread} unread` : "Activity";

  return (
    <Link href="/activity" className="siteNavBell" aria-label={label} title={label}>
      <Bell size={18} aria-hidden="true" />
      {unread > 0 ? (
        <span className="siteNavBellBadge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
