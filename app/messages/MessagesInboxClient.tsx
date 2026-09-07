"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import MessageAvatar from "@/components/messages/MessageAvatar";
import { authedActionFetch } from "@/lib/authedFetch";
import { MOBILE_MEDIA_QUERY } from "@/lib/breakpoints";
import type { ConversationDTO } from "@/lib/messages";
import { subscribeToInbox } from "@/lib/messagesRealtime";
import { inboxTimeLabel } from "@/lib/messageTimeline";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";

import "./messages.css";

// The messaging inbox (PRD E4 / Wave I2): conversations for the signed-in
// linked actor. Bearer via authedActionFetch; unsigned viewers get a sign-in prompt.
//
// LIVE THROUGH THE SAME SIGNAL LANE AS THE THREAD (lib/messagesRealtime.ts):
// the server nudges `live:inbox:<handle>` when a message lands in any of this
// handle's conversations, and the subscription owns the poll fallback and the
// hidden-tab backoff. Every signal is a refetch of the gated list; no content
// arrives on the socket.
//
// A PANE NOBODY CAN SEE FETCHES NOTHING. On a phone the thread route hides
// this pane (`.messagesInboxPane` at MOBILE_MEDIA_QUERY), yet it used to load
// the inbox on every thread open and poll it every 20s underneath the
// conversation. When the pane is hidden by the thread it reads nothing and
// subscribes to nothing; the list loads when the reader comes back to it.

const HANDLE_KEY = "pubmax_handle";

function subscribeMobileViewport(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getMobileViewportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
}

/**
 * What the empty thread pane says, decided by the LIVE session.
 *
 * The pane used to be server-rendered copy: "Choose someone from your inbox to
 * read the thread and reply." A page may not server-render per-account content
 * (the client-router-cache law), so it could not know it was saying that to
 * somebody with no account and therefore no inbox to choose from. It reads the
 * session here instead, the way every other surface that names or routes the
 * viewer does, and it says nothing at all until that session answers.
 */
export function MessagesThreadEmptyCopy(): React.JSX.Element | null {
  const viewerSession = useViewerSession();

  if (viewerSession.unresolved) return null;

  if (viewerSession.signedOut) {
    return (
      <div>
        <p className="messagesThreadEyebrow">Messages</p>
        <h2>Your conversations show here.</h2>
        <p>One thread for each person you go out with, kept to the two of you.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="messagesThreadEyebrow">Your conversations</p>
      <h2>Pick a message</h2>
      <p>Choose someone from your inbox to read the thread and reply.</p>
    </div>
  );
}

export default function MessagesInboxClient({
  activeConversationId,
}: {
  activeConversationId?: string;
}): React.JSX.Element {
  const { accountRevision, user, handle: authHandle } = useAuth();
  const viewerSession = useViewerSession();
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    () => false,
  );
  // The thread route hides this pane on a phone; a hidden list owes no read.
  const paneHidden = Boolean(activeConversationId) && isMobileViewport;
  const [handle, setHandle] = useState("");
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [failed, setFailed] = useState(false);
  // A read that ANSWERED but could not run one of the reads behind it. The rows
  // are real; a count or a preview may be missing. Kept apart from `failed`,
  // which is a read that did not answer at all, because the two owe the reader
  // different sentences.
  const [partial, setPartial] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);
  const accountRevisionRef = useRef(accountRevision);
  useLayoutEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);

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
      const requestRevision = accountRevision;
      if (requestRevision !== accountRevisionRef.current) return;
      const stillCurrent = () => requestRevision === accountRevisionRef.current;
      if (!user) {
        if (!stillCurrent()) return;
        setConversations([]);
        setNeedsSignIn(true);
        setFailed(false);
        setPartial(false);
        setLoadedRevision(requestRevision);
        return;
      }
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (!h) {
        if (!stillCurrent()) return;
        setConversations([]);
        setNeedsSignIn(true);
        setFailed(false);
        setPartial(false);
        setLoadedRevision(requestRevision);
        return;
      }
      try {
        const res = await authedActionFetch(`/api/messages?handle=${encodeURIComponent(h)}`, {
          signal,
        }, { requiresIdentity: true });
        if (!stillCurrent()) {
          discardBody(res);
          return;
        }
        if (res.status === 401) {
          discardBody(res);
          setNeedsSignIn(true);
          setConversations([]);
          setFailed(false);
          setPartial(false);
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setNeedsSignIn(false);
          setFailed(true);
          setPartial(false);
          return;
        }
        setNeedsSignIn(false);
        const body = (await res.json()) as {
          conversations?: ConversationDTO[];
          status?: string;
        };
        if (!stillCurrent()) return;
        const rows = Array.isArray(body.conversations) ? body.conversations : [];
        const degraded = body.status === "degraded";
        setConversations(rows);
        // Degraded WITH NO ROWS may never read as an empty inbox: nothing was
        // answered, so the honest surface is the same one a failed read gets.
        setFailed(degraded && rows.length === 0);
        setPartial(degraded && rows.length > 0);
      } catch (err) {
        const aborted =
          signal?.aborted || (err instanceof Error && err.name === "AbortError");
        if (!aborted && stillCurrent()) {
          setNeedsSignIn(false);
          setFailed(true);
          setPartial(false);
        }
      } finally {
        if (stillCurrent()) setLoadedRevision(requestRevision);
      }
    },
    // `handle` is deliberately NOT a dependency: the read derives the handle
    // itself, and re-keying on the state copy made every mount fetch the inbox
    // twice, once before the handle settled and once after.
    [accountRevision, user, authHandle],
  );

  const retry = useCallback(() => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    void refresh().finally(() => {
      retryingRef.current = false;
      setRetrying(false);
    });
  }, [refresh]);

  const retryButton = (
    <button
      type="button"
      className="threadRetryBtn"
      onClick={retry}
      aria-busy={retrying || undefined}
    >
      {retrying ? "Trying again" : "Try again"}
    </button>
  );

  // ONE read on mount. The subscription below is keyed on the handle, which
  // settles a tick after mount; keeping the two in one effect made that tick
  // refetch the whole inbox a second time.
  useEffect(() => {
    if (paneHidden) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, paneHidden]);

  // The subscription owns the poll: fallback cadence without a socket, a slow
  // safety poll with one, nothing while the tab is hidden.
  useEffect(() => {
    if (paneHidden || !handle) return;
    return subscribeToInbox(handle, () => void refresh(), { poll: () => void refresh() });
  }, [refresh, handle, paneHidden]);

  const accountDataReady = loadedRevision === accountRevision;
  // One clock for the whole list per render, so every row's time is measured
  // from the same instant.
  const now = new Date();

  return (
    <Screen
      as="section"
      className="messagesScreen"
      title="Messages"
      titleId="messages-title"
      // A new message opens recipient search without leaving Messages.
      // Signed out, the one painted control is the door that WORKS: a
      // painted New message led to a sign-in wall, and the reader met two
      // doors for one step. The sign-in door carries the way back here.
      primary={
        viewerSession.signedOut ? (
          <Link href="/login?mode=signin&from=%2Fmessages">Sign in</Link>
        ) : (
          <Link href="/messages/new">New message</Link>
        )
      }
    >
      {/* The one line about what messaging needs. Shown to somebody who is
          not signed in; a signed-in inbox is a list of people, not a notice. */}
      {viewerSession.signedOut ? (
        <p className="messagesCourtesyNote">
          Messages need a signed-in account. Keep it low-key, and report anything off.
        </p>
      ) : null}

      {!accountDataReady ? (
        <p className="conversationPreview">With you in a sec.</p>
      ) : viewerSession.unresolved ? (
        <p className="conversationPreview">With you in a sec.</p>
      ) : viewerSession.signedOut && (needsSignIn || !user) ? (
        // The head's primary is the sign-in door, so the empty state carries
        // no second copy of it.
        <EmptyState title="Sign in to message">
          Private messages need a signed-in account, so each message is tied to
          the right handle.
        </EmptyState>
      ) : failed && conversations.length === 0 ? (
        <div role="alert">
          <EmptyState title="Couldn&rsquo;t load your conversations." action={retryButton} />
        </div>
      ) : conversations.length === 0 ? (
        <EmptyState
          title="Nobody in here yet."
          action={<Link href="/messages/new">Find someone to message</Link>}
        >
          Search a handle and open a conversation.
        </EmptyState>
      ) : (
        <>
          {failed ? (
            <p className="inboxStaleNotice" role="status">
              <span>Couldn&rsquo;t refresh this list. It shows what loaded last.</span>
              {retryButton}
            </p>
          ) : partial ? (
            <p className="inboxStaleNotice" role="status">
              <span>Couldn&rsquo;t check for new messages. Your conversations are here.</span>
              {retryButton}
            </p>
          ) : null}
          <ul className="conversationList">
            {conversations.map((c) => {
              const active = c.id === activeConversationId;
              const unread = (c.unread ?? 0) > 0;
              const classes = [
                "conversationItem",
                active ? "conversationItemActive" : "",
                unread ? "conversationItemUnread" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const when = c.lastAt ? inboxTimeLabel(c.lastAt, now) : "";
              return (
                <li key={c.id} className={classes}>
                  <Link
                    href={`/messages/${encodeURIComponent(c.id)}`}
                    className="conversationLink"
                    aria-current={active ? "page" : undefined}
                  >
                    <MessageAvatar handle={c.otherHandle} avatarUrl={c.otherAvatarUrl} />
                    <div className="conversationBody">
                      <div className="conversationHandle">@{c.otherHandle}</div>
                      <div className="conversationPreview">
                        {c.lastBody
                          ? `${c.lastFromMe ? "You: " : ""}${c.lastBody}`
                          : "No messages yet"}
                      </div>
                    </div>
                    <div className="conversationAside">
                      {when ? (
                        <time className="conversationTime" dateTime={c.lastAt}>
                          {when}
                        </time>
                      ) : null}
                      {unread ? (
                        <span className="conversationUnread" aria-label={`${c.unread ?? 0} unread`}>
                          {(c.unread ?? 0) > 99 ? "99+" : c.unread}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Screen>
  );
}
