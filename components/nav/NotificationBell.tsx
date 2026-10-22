"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

const POLL_MS = 60_000;

export default function NotificationBell(): React.JSX.Element {
  const { user, handle } = useAuth();
  const identity = `${user?.id ?? "guest"}:${normalizeHandle(handle ?? "")}`;
  return (
    <AccountNotificationBell
      key={identity}
      userId={user?.id ?? null}
      authHandle={handle}
    />
  );
}

function AccountNotificationBell({
  userId,
  authHandle,
}: {
  userId: string | null;
  authHandle: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const handle = normalizeHandle(authHandle ?? "");
  const [unread, setUnread] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!socialFriendsLaunchEnabled || !userId || !handle) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await authedActionFetch(`/api/notifications?handle=${encodeURIComponent(handle)}`, {
        signal: controller.signal,
      }, { requiresIdentity: true });
      if (!res.ok) {
        discardBody(res);
        return;
      }
      const body = (await res.json()) as { unread?: number };
      if (!controller.signal.aborted) {
        setUnread(typeof body.unread === "number" ? body.unread : 0);
      }
    } catch {
      // Aborted / offline — leave the badge as-is; the nav never breaks on this.
    }
  }, [handle, socialFriendsLaunchEnabled, userId]);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled || !userId || !handle) return;
    let disposed = false;
    void Promise.resolve().then(() => {
      if (!disposed) return refresh();
    });
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [handle, refresh, socialFriendsLaunchEnabled, userId]);

  const label = !socialFriendsLaunchEnabled
    ? "Social preview"
    : unread > 0
      ? `Activity: ${unread} unread`
      : "Activity";

  return (
    <Link
      href="/activity"
      // Warmed on intent by the handler below, so Next's automatic on-sight
      // prefetch is turned off: this control rides SiteNav on every route, and
      // a dynamic route prefetched on sight is a server render queued in front
      // of the page the reader is waiting for (components/nav/IntentLink.tsx).
      prefetch={false}
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
      {socialFriendsLaunchEnabled && unread > 0 ? (
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
