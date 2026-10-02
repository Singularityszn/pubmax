"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { readProviderAccountRevision } from "@/lib/authProviderRevision";
import { authedActionFetch } from "@/lib/authedFetch";
import type { ConversationDTO } from "@/lib/messages";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/handleNormalize";

const POLL_MS = 60_000;

export default function MessagesLink(): React.JSX.Element {
  const { user, handle: authHandle, identityResolved } = useAuth();
  // Shared account changes reset the badge; token refresh keeps its owner.
  const accountRevision = readProviderAccountRevision();
  const handle = identityResolved ? normalizeHandle(authHandle ?? "") : "";
  return (
    <AccountMessagesLink
      key={`${user?.id ?? "guest"}:${accountRevision}:${handle}`}
      userId={user?.id ?? null}
      accountRevision={accountRevision}
      handle={handle}
    />
  );
}

function AccountMessagesLink({
  userId,
  accountRevision,
  handle,
}: {
  userId: string | null;
  accountRevision: number;
  handle: string;
}): React.JSX.Element {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !handle || accountRevision !== readProviderAccountRevision()) {
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await authedActionFetch(`/api/messages?handle=${encodeURIComponent(handle)}`, {
        signal: controller.signal,
      }, { requiresIdentity: true });
      if (!res.ok) {
        discardBody(res);
        return;
      }
      const body = (await res.json()) as { conversations?: ConversationDTO[] };
      if (controller.signal.aborted || accountRevision !== readProviderAccountRevision()) return;
      const total = (body.conversations ?? []).reduce((sum, c) => sum + (c.unread || 0), 0);
      setUnread(total);
    } catch {
      // An unavailable read keeps only this account's badge.
    }
  }, [accountRevision, handle, userId]);

  useEffect(() => {
    if (!userId || !handle) return;
    let disposed = false;
    const onFocus = () => {
      if (!disposed) void refresh();
    };
    void Promise.resolve().then(onFocus);
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(onFocus, POLL_MS);
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [handle, refresh, userId]);

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
        // CSS pop-in (siteNav.css .siteNavBellBadge) replays as a bump.
        // no separate "did it change" animation state to track.
        <span key={unread} className="siteNavBellBadge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
