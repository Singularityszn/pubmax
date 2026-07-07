"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import EmptyState from "@/components/EmptyState";
import SiteNav from "@/components/nav/SiteNav";
import type { ConversationDTO } from "@/lib/messages";

import "./messages.css";

// The messaging inbox (PRD E4): a handle's conversations, newest-first, with an
// unread badge per thread. Reads the viewer's self-asserted `pubmax_handle` (the
// same key the rest of the app writes); a signed-out viewer gets a friendly empty
// state, never a broken page. Reads are fail-soft — an outage renders as an empty
// inbox. Polls on focus + a slow interval so a new message surfaces without a
// reload (the thread page carries the faster realtime/polling).
//
// COURTESY-CURTAIN, NOT PRIVACY: identity is the self-asserted handle (no auth
// yet) — see lib/messages.ts + migration 0019.

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 20_000;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HANDLE_KEY) ?? "").trim();
}

export default function MessagesInboxPage(): React.JSX.Element {
  const [handle, setHandle] = useState("");
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Post-hydration handle read (avoids a server/client mismatch — mirrors the
  // NotificationBell idiom). setState runs inside the async step.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setHandle(readHandle());
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const h = readHandle();
    if (h !== handle) setHandle(h);
    if (!h) {
      setConversations([]);
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch(`/api/messages?handle=${encodeURIComponent(h)}`, { signal });
      if (!res.ok) return;
      const body = (await res.json()) as { conversations?: ConversationDTO[] };
      setConversations(Array.isArray(body.conversations) ? body.conversations : []);
    } catch {
      // aborted / offline — leave the list as-is; the inbox never breaks on this.
    } finally {
      setLoaded(true);
    }
  }, [handle]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [refresh, handle]);

  return (
    <div className="lp messagesPage">
      <SiteNav />
      <main className="container messagesMain">
        <h1 className="messagesHeading">Messages</h1>
        <p className="messagesCourtesyNote">
          Handles are self-asserted for now — messages are a courtesy, not
          encrypted privacy. Keep it low-stakes; report anything off.
        </p>

        {!loaded ? (
          <p className="conversationPreview">Loading…</p>
        ) : conversations.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            body="Start a conversation from any profile — open someone's page and tap Message."
            action={<Link href="/feed">Find someone to message</Link>}
          />
        ) : (
          <ul className="conversationList">
            {conversations.map((c) => (
              <li key={c.id} className="conversationItem">
                <Link href={`/messages/${encodeURIComponent(c.id)}`} className="conversationLink">
                  <div className="conversationBody">
                    <div className="conversationHandle">@{c.otherHandle}</div>
                    <div className="conversationPreview">
                      {c.lastBody
                        ? `${c.lastFromMe ? "You: " : ""}${c.lastBody}`
                        : "No messages yet"}
                    </div>
                  </div>
                  {c.unread > 0 ? (
                    <span className="conversationUnread" aria-label={`${c.unread} unread`}>
                      {c.unread > 99 ? "99+" : c.unread}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
