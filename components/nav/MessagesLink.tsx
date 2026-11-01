"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import NavPendingIndicator from "@/components/nav/NavPendingIndicator";
import { authedActionFetch } from "@/lib/authedFetch";
import type { ConversationDTO } from "@/lib/messages";
import { subscribeMessagesRead } from "@/lib/messagesUnreadSignal";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { safeLocalStorage } from "@/lib/safeStorage";
import { subscribeVisiblePolling } from "@/lib/visiblePolling";

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 60_000;

function readHandle(): string {
  return normalizeHandle(safeLocalStorage()?.getItem(HANDLE_KEY) ?? "");
}

export default function MessagesLink(): React.JSX.Element | null {
  const router = useRouter();
  const { user, handle: authHandle } = useAuth();
  const [handle, setHandle] = useState("");
  const [unreadResult, setUnreadResult] = useState<{
    userId: string;
    handle: string;
    count: number;
  } | null>(null);
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

  const effectiveHandle = normalizeHandle(authHandle ?? "") || handle.trim();
  const unread = unreadResult?.userId === user?.id && unreadResult?.handle === effectiveHandle
    ? unreadResult.count
    : 0;

  const refresh = useCallback(async (supersede = false) => {
    if (document.visibilityState === "hidden") return;
    if (abortRef.current && !abortRef.current.signal.aborted && !supersede) return;
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
      const res = await authedActionFetch(`/api/messages?handle=${encodeURIComponent(h)}`, {
        signal: controller.signal,
      }, { requiresIdentity: true });
      if (!res.ok) {
        discardBody(res);
        return;
      }
      const body = (await res.json()) as { conversations?: ConversationDTO[] };
      if (controller.signal.aborted || abortRef.current !== controller) return;
      const total = (body.conversations ?? []).reduce((sum, c) => sum + (c.unread || 0), 0);
      setUnreadResult({ userId: user.id, handle: h, count: total });
    } catch {
      // aborted / offline — leave the badge as-is; the nav never breaks on this.
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [effectiveHandle, user]);

  useEffect(() => {
    // Never setState synchronously in the effect body (react-hooks/set-state-in-effect).
    if (!user) {
      void Promise.resolve().then(() => setUnreadResult(null));
      return;
    }
    const stop = subscribeVisiblePolling(() => void refresh(), POLL_MS, () => abortRef.current?.abort());
    // A completed thread read supersedes an older unread-count request.
    const unsubscribeRead = subscribeMessagesRead(() => void refresh(true));
    return () => {
      stop();
      unsubscribeRead();
    };
  }, [refresh, user]);

  // A signed-out visitor has no inbox, so the link is not drawn for them at all
  // (Oct 2026 UX audit). It appears once a session exists.
  if (!user) return null;

  const label = unread > 0 ? `Messages, ${unread} unread` : "Messages";

  return (
    <Link
      href="/messages"
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
          router.prefetch("/messages");
        } catch {
          // prefetch is best-effort
        }
      }}
    >
      <MessageSquare size={20} aria-hidden="true" />
      {unread > 0 ? (
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
