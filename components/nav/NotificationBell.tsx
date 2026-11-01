"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import NavPendingIndicator from "@/components/nav/NavPendingIndicator";
import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { safeLocalStorage } from "@/lib/safeStorage";
import { subscribeVisiblePolling } from "@/lib/visiblePolling";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 60_000;

function readHandle(): string {
  return normalizeHandle(safeLocalStorage()?.getItem(HANDLE_KEY) ?? "");
}

export default function NotificationBell(): React.JSX.Element | null {
  const router = useRouter();
  const { user, handle: authHandle } = useAuth();
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [handle, setHandle] = useState("");
  const [unreadResult, setUnreadResult] = useState<{
    userId: string;
    handle: string;
    count: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const fromAuth = normalizeHandle(authHandle ?? "");
      setHandle(fromAuth || readHandle());
    });
    return () => {
      active = false;
    };
  }, [authHandle, socialFriendsLaunchEnabled]);

  const effectiveHandle = normalizeHandle(authHandle ?? "") || handle.trim();
  const unread = unreadResult?.userId === user?.id && unreadResult?.handle === effectiveHandle
    ? unreadResult.count
    : 0;

  const refresh = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    if (abortRef.current && !abortRef.current.signal.aborted) return;
    if (!socialFriendsLaunchEnabled) return;
    if (!user) {
      setUnreadResult(null);
      return;
    }
    const h = effectiveHandle;
    if (!h) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await authedActionFetch(`/api/notifications?handle=${encodeURIComponent(h)}`, {
        signal: controller.signal,
      }, { requiresIdentity: true });
      if (!res.ok) {
        discardBody(res);
        return;
      }
      const body = (await res.json()) as { unread?: number };
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setUnreadResult({
        userId: user.id,
        handle: h,
        count: typeof body.unread === "number" ? body.unread : 0,
      });
    } catch {
      // Aborted / offline — leave the badge as-is; the nav never breaks on this.
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [effectiveHandle, socialFriendsLaunchEnabled, user]);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    // A signed-out visitor has nothing to poll: the inbox refuses them.
    if (!user) {
      void Promise.resolve().then(() => setUnreadResult(null));
      return;
    }
    if (!effectiveHandle) return;
    return subscribeVisiblePolling(() => void refresh(), POLL_MS, () => abortRef.current?.abort());
  }, [effectiveHandle, refresh, socialFriendsLaunchEnabled, user]);

  // A signed-out visitor has no activity to read, so the bell is not drawn for
  // them at all (Oct 2026 UX audit): an icon with nothing behind it is noise in
  // the header. It appears once a session exists.
  if (!user) return null;

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
      className="siteNavBell navPendingLink"
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
      <Bell size={20} aria-hidden="true" />
      {socialFriendsLaunchEnabled && unread > 0 ? (
        // key={unread} remounts the badge whenever the count changes, so the
        // CSS pop-in (siteNav.css .siteNavBellBadge) replays as a bump —
        // no separate "did it change" animation state to track.
        <span key={unread} className="siteNavBellBadge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
      <NavPendingIndicator />
    </Link>
  );
}
