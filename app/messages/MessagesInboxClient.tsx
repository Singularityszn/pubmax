"use client";

import { MessageCircle, Search, SquarePen, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import MessageAvatar from "@/components/messages/MessageAvatar";
import { IconButton } from "@/components/ui/icon-button";
import MessageNotificationSettings from "@/components/messages/MessageNotificationSettings";
import { invalidateMessagesInbox } from "@/lib/messagesInboxClient";
import MessagesNewGroup from "@/components/messages/MessagesNewGroup";
import { InboxLoading } from "@/components/messages/MessageLoading";
import { MOBILE_MEDIA_QUERY } from "@/lib/breakpoints";
import {
  conversationRowHandle,
  conversationRowMatches,
  conversationRowName,
} from "@/lib/messages";
import { inboxTimeLabel } from "@/lib/messageTimeline";

import { useInboxThreadsLoader } from "./useInboxThreadsLoader";

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

type InboxFilter = "all" | "unread" | "groups";
const INBOX_FILTERS = [{ id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "groups", label: "Groups" }] as const;

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

  // Somebody with no account has no thread to choose, so the pane says nothing:
  // the inbox column carries the page's one empty state and one door, and the
  // two-pane frame folds away around it (app/messages/messages.css).
  if (viewerSession.signedOut) return null;

  return (
    <div>
      <MessageCircle className="messagesThreadEmptyIcon" size={44} aria-hidden="true" />
      <h2>Your messages</h2>
      <p>Choose a conversation or start a new message.</p>
    </div>
  );
}

export default function MessagesInboxClient({
  activeConversationId,
}: {
  activeConversationId?: string;
}): React.JSX.Element {
  const router = useRouter();
  const { accountRevision, user, handle: authHandle } = useAuth();
  const viewerSession = useViewerSession();
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    () => false,
  );
  // The thread route hides this pane on a phone; a hidden list owes no read.
  const paneHidden = Boolean(activeConversationId) && isMobileViewport;
  const [composeRevision, setComposeRevision] = useState<number | null>(null);
  const [inboxSearch, setInboxSearch] = useState<{ revision: number; query: string; filter: InboxFilter }>({ revision: accountRevision, query: "", filter: "all" });
  const {
    handle,
    conversations,
    needsSignIn,
    handleNotOwned,
    failed,
    partial,
    retrying,
    retry,
    refresh,
    accountDataReady,
  } = useInboxThreadsLoader({ accountRevision, user, authHandle, paneHidden, activeConversationId });

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

  // One clock for the whole list per render, so every row's time is measured
  // from the same instant.
  const now = new Date();
  const searchQuery = inboxSearch.revision === accountRevision ? inboxSearch.query : "";
  const filter = inboxSearch.revision === accountRevision ? inboxSearch.filter : "all";
  const filteredConversations = conversations.filter((conversation) =>
    conversationRowMatches(conversation, handle, searchQuery) &&
    (filter !== "unread" || (conversation.unread ?? 0) > 0) &&
    (filter !== "groups" || conversation.kind === "group"),
  );
  const setFilter = (next: InboxFilter) => setInboxSearch({ revision: accountRevision, query: searchQuery, filter: next });
  const openCompose = () => setComposeRevision(accountRevision);
  const hasSearch = searchQuery.trim().length > 0;
  const filteredEmptyTitle = hasSearch
    ? "No conversations match your search."
    : filter === "unread" ? "No unread conversations to show." : "No group conversations yet.";
  const filteredEmptyLine = hasSearch
    ? "Try another name, handle or group title."
    : filter === "groups" ? "Get the people joining you tonight into one conversation."
      : partial ? "Some unread counts couldn't be checked. Your conversations are in All."
        : failed ? "Couldn't check for new messages. Your conversations are in All."
          : "You're up to date. The rest are in All.";

  return (
    <Screen
      as="section"
      className={viewerSession.signedOut ? "messagesScreen messagesScreen--signedOut" : "messagesScreen"}
      title="Messages"
      titleId="messages-title"
      primary={
        viewerSession.signedOut ? (
          <Link href="/login?mode=signin&from=%2Fmessages">Sign in</Link>
        ) : (
          <div className="messagesInboxActions">
            <MessageNotificationSettings compact />
            <IconButton variant="ghost" className="pressable" type="button" onClick={openCompose} aria-label="New message" disabled={!user || !handle || handleNotOwned}>
              <SquarePen size={20} aria-hidden="true" />
            </IconButton>
          </div>
        )
      }
    >
      {!viewerSession.signedOut && user ? (
        <>
          <label className="messagesInboxSearch">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search conversations"
              placeholder="Search names or handles"
              value={searchQuery}
              onChange={(event) => setInboxSearch({ revision: accountRevision, query: event.target.value, filter })}
            />
          </label>
          <div className="messagesInboxFilters" role="group" aria-label="Filter conversations">
            {INBOX_FILTERS.map((item) => (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          {composeRevision === accountRevision ? <MessagesNewGroup
            key={`${accountRevision}:${handle}`}
            handle={handle}
            open={composeRevision === accountRevision}
            onClose={() => setComposeRevision(null)}
            allowDirect
            suggestedRecipients={accountDataReady ? conversations
              .filter((conversation) => conversation.kind !== "group")
              .map((conversation) => ({ handle: conversation.otherHandle, avatarUrl: conversation.otherAvatarUrl })) : []}
            onOpened={(conversationId) => {
              setComposeRevision(null);
              invalidateMessagesInbox(handle);
              void refresh(undefined, true);
              router.push(`/messages/${encodeURIComponent(conversationId)}`);
            }}
          /> : null}
        </>
      ) : null}

      {viewerSession.signedOut && (needsSignIn || !user) ? (
        // The head's primary is the sign-in door, so the empty state carries
        // no second copy of it. A session that has answered "nobody" is the
        // whole answer: there is no inbox to read, so this does not wait on the
        // read the way a signed-in list does. It used to sit behind "With you
        // in a sec." until auth bootstrap re-keyed the read, about a second
        // after the courtesy note above had already said the same thing.
        // It says what this place is and how it fills, once; the head's door
        // is the only sign-in on the page (taste plan, 18 Oct 2026).
        <EmptyState title="Your conversations show here.">
          One thread for each person you go out with, kept to the two of you.
        </EmptyState>
      ) : !accountDataReady ? (
        <InboxLoading />
      ) : viewerSession.unresolved ? (
        <InboxLoading />
      ) : handleNotOwned ? (
        <EmptyState
          title={`@${handle} isn\u2019t linked to your account.`}
          action={<Link href="/u/you#account-settings">Claim a handle</Link>}
        >
          Messages open once your account claims this handle.
        </EmptyState>
      ) : failed && conversations.length === 0 ? (
        <div role="alert">
          <EmptyState title="Couldn&rsquo;t load your conversations." action={retryButton} />
        </div>
      ) : conversations.length === 0 ? (
        <EmptyState title="Your messages start here.">
          Tap New message to find a person or start a group.
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
          {filteredConversations.length === 0 ? (
            <div className="messagesFilteredEmpty" role="status">
              <MessageCircle size={24} aria-hidden="true" />
              <h2>{filteredEmptyTitle}</h2>
              <p>{filteredEmptyLine}</p>
              <button type="button" className="threadRetryBtn" onClick={() => {
                if (hasSearch) setInboxSearch({ revision: accountRevision, query: "", filter });
                else if (filter === "groups") openCompose();
                else setFilter("all");
              }}>
                {hasSearch ? "Clear search" : filter === "groups" ? "Start a group" : "Show all conversations"}
              </button>
            </div>
          ) : null}
          <ul className="conversationList">
            {filteredConversations.map((c) => {
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
                    data-pressable=""
                    aria-current={active ? "page" : undefined}
                  >
                    {c.kind === "group" ? (
                      <span className="messageAvatar messageAvatarGroup" style={{ "--message-avatar-size": "56px" } as React.CSSProperties} aria-hidden="true">
                        <UsersRound size={24} />
                      </span>
                    ) : (
                      <MessageAvatar handle={c.otherHandle} avatarUrl={c.otherAvatarUrl} label={c.otherDisplayName} size={56} />
                    )}
                    <div className="conversationBody">
                      {/* ONE naming rule for every kind (`conversationRowName`):
                          a DM is the other person, a group is its title or its
                          people, so the inbox and the thread head cannot each
                          invent a different name for one thread. */}
                      <div className="conversationHandle">
                        {conversationRowName(c, handle)}
                        {conversationRowHandle(c) ? (
                          <span className="conversationHandleSub">{conversationRowHandle(c)}</span>
                        ) : null}
                      </div>
                      <div className="conversationPreview">
                        {c.kind === "group" ? <span className="conversationGroupLabel">Group · </span> : null}
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
