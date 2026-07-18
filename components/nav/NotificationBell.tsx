"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedFetch } from "@/lib/authedFetch";
import { normalizeHandle } from "@/lib/profiles";

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 60_000;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
}

export default function NotificationBell(): React.JSX.Element {
  const router = useRouter();
  const { handle: authHandle } = useAuth();
  const [handle, setHandle] = useState("");
  const [unread, setUnread] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const fromAuth = normalizeHandle(authHandle ?? "");
      setHandle(fromAuth || readHandle());
    });
    return () => {
      active = false;
    };
  }, [authHandle]);

  const refresh = useCallback(async () => {
    const h = normalizeHandle(authHandle ?? "") || handle.trim();
    if (!h) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await authedFetch(`/api/notifications?handle=${encodeURIComponent(h)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const body = (await res.json()) as { unread?: number };
      setUnread(typeof body.unread === "number" ? body.unread : 0);
    } catch {
      // Aborted / offline — leave the badge as-is; the nav never breaks on this.
    }
  }, [handle, authHandle]);

  useEffect(() => {
    if (!handle.trim() && !authHandle) return;
    void Promise.resolve().then(() => refresh());
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [handle, refresh, authHandle]);

  const label = unread > 0 ? `Activity: ${unread} unread` : "Activity";

  return (
    <Link
      href="/activity"
      className="siteNavBell"
      aria-label={label}
      title={label}
      onPointerDown={() => {
        try {
          router.prefetch("/activity");
        } catch {
          // prefetch is best-effort
        }
      }}
    >
      <Bell size={18} aria-hidden="true" />
      {unread > 0 ? (
        // key={unread} remounts the badge whenever the count changes, so the
        // CSS pop-in (siteNav.css .siteNavBellBadge) replays as a bump —
        // no separate "did it change" animation state to track.
        <span key={unread} className="siteNavBellBadge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
