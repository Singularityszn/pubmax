"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import SiteNav from "@/components/nav/SiteNav";
import { authedFetch } from "@/lib/authedFetch";
import type { ConversationDTO } from "@/lib/messages";
import { normalizeHandle } from "@/lib/profiles";

import "./messages.css";

// The messaging inbox (PRD E4 / Wave I2): conversations for the signed-in
// linked actor. Bearer via authedFetch; unsigned viewers get a sign-in prompt.

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 20_000;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
}

export default function MessagesInboxClient(): React.JSX.Element {
  const { user, handle: authHandle } = useAuth();
  const [handle, setHandle] = useState("");
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

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

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!user) {
        setConversations([]);
        setNeedsSignIn(true);
        setLoaded(true);
        return;
      }
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (h !== handle) setHandle(h);
      if (!h) {
        setConversations([]);
        setNeedsSignIn(true);
        setLoaded(true);
        return;
      }
      try {
        const res = await authedFetch(`/api/messages?handle=${encodeURIComponent(h)}`, {
          signal,
        });
        if (res.status === 401) {
          setNeedsSignIn(true);
          setConversations([]);
          return;
        }
        if (!res.ok) return;
        setNeedsSignIn(false);
        const body = (await res.json()) as { conversations?: ConversationDTO[] };
        setConversations(Array.isArray(body.conversations) ? body.conversations : []);
      } catch {
        // aborted / offline — leave the list as-is; the inbox never breaks on this.
      } finally {
        setLoaded(true);
      }
    },
    [handle, user, authHandle],
  );

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
          Messages need a signed-in account. Keep it low-key, and report anything off.
        </p>

        {!loaded ? (
          <p className="conversationPreview">Loading…</p>
        ) : needsSignIn || !user ? (
          <EmptyState
            title="Sign in to message"
            body="Private messages need a signed-in account so nobody can read or send as your handle."
            action={<SignInButton />}
          />
        ) : conversations.length === 0 ? (
          <EmptyState
            title="Nobody in here yet."
            body="Find someone worth a pint on the feed, open their profile, and tap Message. That's how a round starts."
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
