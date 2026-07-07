"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ConversationDTO } from "@/lib/messages";

// Messages inbox link in the nav (PRD E4) — a tiny client island next to the
// notification bell. Polls the viewer's total unread message count and links to
// /messages. Cheap + ambient: it re-fetches on window focus and on a slow
// interval, one small GET (the inbox list, summed). A signed-out viewer (no
// `pubmax_handle`) sees a plain icon with no badge and the poll is skipped.
//
// Mirrors NotificationBell exactly (self-asserted `pubmax_handle`, swallowed
// failures) so a messaging outage never breaks the nav.

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 60_000;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HANDLE_KEY) ?? "").trim();
}

export default function MessagesLink(): React.JSX.Element {
  const [handle, setHandle] = useState("");
  const [unread, setUnread] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setHandle(readHandle());
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const h = handle.trim();
    if (!h) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/messages?handle=${encodeURIComponent(h)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const body = (await res.json()) as { conversations?: ConversationDTO[] };
      const total = (body.conversations ?? []).reduce((sum, c) => sum + (c.unread || 0), 0);
      setUnread(total);
    } catch {
      // aborted / offline — leave the badge as-is; the nav never breaks on this.
    }
  }, [handle]);

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

  const label = unread > 0 ? `Messages — ${unread} unread` : "Messages";

  return (
    <Link href="/messages" className="siteNavBell" aria-label={label} title={label}>
      <MessageSquare size={18} aria-hidden="true" />
      {unread > 0 ? (
        <span className="siteNavBellBadge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
