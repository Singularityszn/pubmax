"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import { authedFetch } from "@/lib/authedFetch";
import { linkifyMentions, MAX_MESSAGE_BODY, type MessageDTO } from "@/lib/messages";
import { subscribeToMessages } from "@/lib/messagesRealtime";
import { normalizeHandle } from "@/lib/profiles";

import "@/app/messages/messages.css";

// The message thread (PRD E4): bubbles (mine right / category-brass tint, theirs
// left / plain panel), a composer with the 1000-char cap, and a light abuse
// "Report" affordance per received message. Live via realtime SIGNALS
// (subscribeToMessages) with a MANDATORY polling fallback — the payload is never
// rendered; every signal refetches through the participant-gated API so the
// courtesy check re-applies to every row.
//
// COURTESY-CURTAIN, NOT PRIVACY: the viewer's own self-asserted `pubmax_handle`
// decides which bubbles are "mine". A GET that isn't a participant returns 404 —
// the page below shows a friendly not-found rather than a leak.

const HANDLE_KEY = "pubmax_handle";
const POLL_MS = 10_000;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
}

// Render a message body with @-mentions linkified to /u/<handle>. Pure segments
// from lib/messages — text as-is, mentions as brass links.
function MessageBody({ body }: { body: string }): React.JSX.Element {
  const segments = useMemo(() => linkifyMentions(body), [body]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "mention" ? (
          <Link key={i} href={`/u/${encodeURIComponent(seg.handle)}`} className="messageMention">
            {seg.raw}
          </Link>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

type ThreadState = "loading" | "ready" | "notfound" | "signedout";

export default function MessageThread({
  conversationId,
}: {
  conversationId: string;
}): React.JSX.Element {
  const { user, handle: authHandle } = useAuth();
  const [handle, setHandle] = useState("");
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [otherHandle, setOtherHandle] = useState("");
  const [state, setState] = useState<ThreadState>("loading");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listEndRef = useRef<HTMLDivElement | null>(null);

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

  // Refetch the thread through the participant-gated API. A 404 = we're not a
  // participant (or the conversation is gone) → show not-found, never a leak.
  // Wave I2: 401 without sign-in → signedout; Bearer via authedFetch.
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!user) {
        setState("signedout");
        return;
      }
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (!h) {
        setState("signedout");
        return;
      }
      try {
        const res = await authedFetch(
          `/api/messages/${encodeURIComponent(conversationId)}?handle=${encodeURIComponent(h)}`,
          { signal },
        );
        if (res.status === 401) {
          setState("signedout");
          return;
        }
        if (res.status === 404) {
          setState("notfound");
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as { messages?: MessageDTO[] };
        const next = Array.isArray(body.messages) ? body.messages : [];
        setMessages(next);
        // Derive the other participant from the first non-mine message, else keep
        // whatever we had (a brand-new thread with only my messages shows me).
        const theirs = next.find((m) => m.senderHandle !== h);
        if (theirs) setOtherHandle(theirs.senderHandle);
        setState("ready");
      } catch {
        // aborted / offline — keep what we have
      }
    },
    [conversationId, user, authHandle],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    // Realtime signal-only nudge with a mandatory 10s polling fallback. The nudge
    // never carries content — it just triggers the same gated refetch.
    const unsub = subscribeToMessages(conversationId, () => void refresh(), {
      poll: () => void refresh(),
    });
    // A belt-and-braces interval in case realtime AND its internal fallback are
    // both unavailable early (the page must stay live regardless).
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      unsub();
    };
  }, [conversationId, refresh, handle]);

  // Auto-scroll to the newest message on change.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const over = draft.length > MAX_MESSAGE_BODY;
  const canSend = draft.trim().length > 0 && !over && !sending;

  const send = useCallback(async () => {
    const h = normalizeHandle(authHandle ?? "") || readHandle();
    const bodyText = draft.trim();
    if (!user || !h || !bodyText || over) return;
    setSending(true);
    setError("");
    try {
      const res = await authedFetch(`/api/messages/${encodeURIComponent(conversationId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", handle: h, body: bodyText }),
      });
      if (res.status === 401) {
        setState("signedout");
        return;
      }
      if (res.status === 429) {
        setError("Too many messages, slow down.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't send that message.");
        return;
      }
      setDraft("");
      await refresh();
    } catch {
      setError("Couldn't send that message.");
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, over, refresh, user, authHandle]);

  const report = useCallback(
    async (messageId: string) => {
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (!user || !h) return;
      try {
        await authedFetch(`/api/messages/${encodeURIComponent(conversationId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "report", handle: h, messageId }),
        });
        await refresh();
      } catch {
        // best-effort — a failed report is non-fatal
      }
    },
    [conversationId, refresh, user, authHandle],
  );

  if (state === "signedout") {
    return (
      <div className="conversationPreview messagesSignInPrompt">
        <p>Sign in to read and send messages.</p>
        <SignInButton />
      </div>
    );
  }
  if (state === "notfound") {
    return (
      <p className="conversationPreview">
        Conversation not found. <Link href="/messages">Back to inbox</Link>
      </p>
    );
  }

  return (
    <div className="messageThread">
      <div className="threadHeader">
        <Link href="/messages" className="threadBackLink">
          ← Inbox
        </Link>
        <span className="threadWith">
          {otherHandle ? `@${otherHandle}` : "Conversation"}
        </span>
      </div>

      {state === "loading" ? (
        <p className="conversationPreview">With you in a sec.</p>
      ) : (
        <ul className="threadMessages">
          {messages.map((m) => {
            const mine = m.senderHandle === handle;
            return (
              <li key={m.id} className={mine ? "messageRow messageRowMine" : "messageRow"}>
                <div>
                  <div
                    className={
                      mine
                        ? "messageBubble messageBubbleMine"
                        : "messageBubble messageBubbleTheirs"
                    }
                  >
                    <MessageBody body={m.body} />
                  </div>
                  <div className="messageMeta">
                    {m.flagged ? (
                      <span className="messageFlagged">Reported</span>
                    ) : !mine ? (
                      <button
                        type="button"
                        className="messageReportBtn"
                        onClick={() => void report(m.id)}
                      >
                        Report
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
          <li className="threadListEnd" aria-hidden="true">
            <div ref={listEndRef} />
          </li>
        </ul>
      )}

      {error ? <p className="threadError">{error}</p> : null}

      <div className="composer">
        <textarea
          className="composerInput"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message…"
          maxLength={MAX_MESSAGE_BODY + 100}
          aria-label="Message"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void send();
            }
          }}
        />
        <span className={over ? "composerCount composerCountOver" : "composerCount"}>
          {draft.length}/{MAX_MESSAGE_BODY}
        </span>
        <button
          type="button"
          className="composerSend"
          disabled={!canSend}
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
