"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import type { ConversationDTO } from "@/lib/messages";
import { subscribeMessagesRead } from "@/lib/messagesUnreadSignal";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { safeLocalStorage } from "@/lib/safeStorage";

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 60_000;

function readHandle(): string {
  return normalizeHandle(safeLocalStorage()?.getItem(HANDLE_KEY) ?? "");
}

export default function MessagesLink(): React.JSX.Element {
  const router = useRouter();
  const { user, handle: authHandle } = useAuth();
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
    if (!user) {
      setUnread(0);
      return;
    }
    const h = normalizeHandle(authHandle ?? "") || handle.trim();
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
      const total = (body.conversations ?? []).reduce((sum, c) => sum + (c.unread || 0), 0);
      setUnread(total);
    } catch {
      // aborted / offline — leave the badge as-is; the nav never breaks on this.
    }
  }, [handle, user, authHandle]);

  useEffect(() => {
    // Never setState synchronously in the effect body (react-hooks/set-state-in-effect).
    if (!user) {
      void Promise.resolve().then(() => setUnread(0));
      return;
    }
    void Promise.resolve().then(() => refresh());
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    // A thread that was just read says so, so the badge drops at once.
    const unsubscribeRead = subscribeMessagesRead(onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribeRead();
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [handle, refresh, user]);

  const label = unread > 0 ? `Messages, ${unread} unread` : "Messages";

  return (
    <Link
      href="/messages"
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
          router.prefetch("/messages");
        } catch {
          // prefetch is best-effort
        }
      }}
    >
      <MessageSquare size={18} aria-hidden="true" />
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
