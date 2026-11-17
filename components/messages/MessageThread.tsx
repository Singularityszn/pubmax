"use client";

import { Send, ChevronLeft, ImageIcon, MapPin, Plus, CalendarDays, UsersRound } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import MessageAttachmentPicker, {
  type MessageAttachKind,
  type MessageAttachmentPickerHandle,
} from "@/components/messages/MessageAttachmentPicker";
import { usePublicProfileCard } from "@/components/auth/usePublicProfileCard";
import MessageAvatar from "@/components/messages/MessageAvatar";
import MessageContactCard from "@/components/messages/MessageContactCard";
import MessageConfirmDialog from "@/components/messages/MessageConfirmDialog";
import MessageContactPicker from "@/components/messages/MessageContactPicker";
import MessageEventCard from "@/components/messages/MessageEventCard";
import MessageEventPicker from "@/components/messages/MessageEventPicker";
import MessagePhoto from "@/components/messages/MessagePhoto";
import MessagePhotoRecoveryNotice from "@/components/messages/MessagePhotoRecoveryNotice";
import { useMessageInputSize } from "@/components/messages/useMessageInputSize";
import MessagePollCard from "@/components/messages/MessagePollCard";
import MessagePollComposer from "@/components/messages/MessagePollComposer";
import MessageThreadMenu from "@/components/messages/MessageThreadMenu";
import MessageVenueCard from "@/components/messages/MessageVenueCard";
import { useMessageAdultGate } from "@/components/messages/useMessageAdultGate";
import MessageVenuePicker, {
} from "@/components/messages/MessageVenuePicker";
import { authedActionFetch } from "@/lib/authedFetch";
import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { MOBILE_MEDIA_QUERY } from "@/lib/breakpoints";
import { discardBody } from "@/lib/responseBody";
import {
  MESSAGE_ATTACH_PHOTO_LABEL,
  MESSAGE_ATTACH_VENUE_LABEL,
} from "@/lib/messageAttachments";
import {
  GROUP_EMPTY_THREAD_LINE,
  GROUP_LEAVE_CONFIRM_LINE,
  GROUP_LEAVE_CONFIRM_TITLE,
  GROUP_LEAVE_FAILED_LINE,
  GROUP_LEAVE_LABEL,
  GROUP_LEFT_LINE,
  groupMemberCountLine,
} from "@/lib/messageGroupThread";
import {
  CHAT_DELETE_CONFIRM_LINE,
  CHAT_DELETE_CONFIRM_TITLE,
  CHAT_DELETE_FAILED_LINE,
  CHAT_DELETE_LABEL,
  CHAT_DELETED_LINE,
  MESSAGE_UNSEND_CONFIRM_LINE,
  MESSAGE_UNSEND_CONFIRM_TITLE,
  MESSAGE_UNSEND_FAILED_LINE,
  MESSAGE_UNSEND_LABEL,
  MESSAGE_UNSENT_LINE,
} from "@/lib/messageRemovals";
import { announceMessagesRead } from "@/lib/messagesUnreadSignal";
import type { MessagePollView } from "@/lib/messagePoll";
import {
  linkifyMessageBody,
  MAX_MESSAGE_BODY,
  otherHandleFromThreadRead,
  threadHeaderPrimaryLine,
  threadCardHandle,
  threadHeaderSecondaryLine,
  threadIdentityFromInboxRow,
  threadIdentityFromWire,
  type ConversationDTO,
  type MessageDTO,
  type ThreadIdentity,
  unreadForViewer,
} from "@/lib/messages";
import { subscribeToMessages } from "@/lib/messagesRealtime";
import {
  buildMessageTimeline,
  MESSAGE_READ_STATE_LABEL,
  type TimelineItem,
} from "@/lib/messageTimeline";
import { normalizeHandle } from "@/lib/profiles";
import { safeLocalStorage } from "@/lib/safeStorage";
import {
  isTextEntryElement,
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  softKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";

import { useMessageComposer } from "@/components/messages/useMessageComposer";
import { messagePhotos, pendingMessageLabel } from "@/lib/messageComposer";

import "@/app/messages/messages.css";
import "@/components/messages/messagePhotos.css";

// The message thread (PRD E4): bubbles (mine right / coral, theirs left /
// panel), a composer with the 1000-char cap, and a light abuse "Report"
// affordance per received message. Live via realtime SIGNALS
// (subscribeToMessages) with a MANDATORY polling fallback — the payload is never
// rendered; every signal refetches through the participant-gated API so the
// courtesy check re-applies to every row.
//
// COURTESY-CURTAIN, NOT PRIVACY: the viewer's own self-asserted `pubmax_handle`
// decides which bubbles are "mine". A GET that isn't a participant returns 404 —
// the page below shows a friendly not-found rather than a leak.
//
// Bubble width constraints: app/messages/messages.css.
//
// Timeline, reveal and read-state rules:
// docs/rules/components-venue-plan-and-message-surfaces.md.
//
// Delivery and retry rules:
// docs/rules/lib-shared-seams-stores-http-freshness-brand.md#message-retries.
//
// The phone thread fits the visual viewport. Only its message list scrolls.
// lib/softKeyboard.ts withdraws the tab bar while the keyboard is open.
//
// Attachment rules: lib/messageAttachments.ts.

const HANDLE_KEY = "pubmax_handle";
/** The counter shows only once a message is close to the cap. */
const COUNTER_FROM = MAX_MESSAGE_BODY - 100;

function readHandle(): string {
  return normalizeHandle(safeLocalStorage()?.getItem(HANDLE_KEY) ?? "");
}

/**
 * Whether Enter alone should SEND. A physical keyboard has a modifier to reach
 * for; a phone keyboard's return key is how a person starts a new line, so
 * hijacking it there would make a two-line message impossible to type. Read
 * once per mount and re-read when the pointer changes (a tablet with a keyboard
 * attached is both).
 */
function useEnterSends(): boolean {
  const [enterSends, setEnterSends] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(pointer: fine)");
    const apply = () => setEnterSends(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return enterSends;
}

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

// lib/messages validates league invitation links before they become app navigation.
function MessageBody({ body }: { body: string }): React.JSX.Element {
  const segments = useMemo(() => linkifyMessageBody(body), [body]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "mention" ? (
          <Link key={i} href={`/u/${encodeURIComponent(seg.handle)}`} className="messageMention">
            {seg.raw}
          </Link>
        ) : seg.type === "league-invite" ? (
          <Link key={i} href={seg.href} className="messageMention">{seg.text}</Link>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

type ThreadState =
  | "loading"
  | "ready"
  | "notfound"
  | "signedout"
  | "unreachable"
  /** This reader has just left a group. The thread stays; the way in does not. */
  | "left"
  /** This reader has just deleted the chat from their own inbox. */
  | "deleted";

type ThreadReadKey = {
  conversationId: string;
  accountRevision: number;
};

function sameThreadReadKey(
  key: ThreadReadKey | null,
  conversationId: string,
  accountRevision: number,
): boolean {
  return key?.conversationId === conversationId && key?.accountRevision === accountRevision;
}

/** Which picker is open. One at a time, because one attachment rides at a time. */
type OpenPicker = "venue" | "contact" | "event" | "poll" | null;

/** A removal waiting on its confirm. */
type PendingRemoval =
  | { kind: "unsend"; messageId: string }
  | { kind: "delete" }
  | { kind: "leave" };

/**
 * The inbox row for one conversation, for naming an EMPTY thread's head.
 *
 * Never throws and never rejects: a head with no name is a cosmetic gap, not a
 * thread that failed to read, and this runs inside the read. Null means the
 * inbox could not be asked at all, so the caller may ask again; a resolved read
 * with no matching row answers with an empty name and is not asked twice.
 */
async function nameFromInboxRow(
  viewerHandle: string,
  conversationId: string,
): Promise<{ identity: ThreadIdentity | null; otherHandle: string } | null> {
  try {
    const res = await authedActionFetch(
      `/api/messages?handle=${encodeURIComponent(viewerHandle)}`,
      {},
      { requiresIdentity: true },
    );
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    const body = (await res.json()) as { conversations?: ConversationDTO[] };
    const row = (body.conversations ?? []).find(
      (conversation) => conversation.id === conversationId,
    );
    if (!row) return { identity: null, otherHandle: "" };
    return {
      identity: threadIdentityFromInboxRow(row),
      otherHandle: row.otherHandle ?? "",
    };
  } catch {
    return null;
  }
}

/** The thread route marks what was waiting as read in the same read it answers. */
function announceIfWaitingRead(messages: readonly MessageDTO[], viewer: string): void {
  if (unreadForViewer(messages, viewer) > 0) announceMessagesRead();
}

export default function MessageThread({
  conversationId,
}: {
  conversationId: string;
}): React.JSX.Element {
  const { accountRevision, user, handle: authHandle } = useAuth();
  // The phase settles once per boot, and the refresh below re-keys on it so a
  // thread that waited for the session reloads the moment it answers.
  const viewerSession = useViewerSession();
  const [handle, setHandle] = useState("");
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [otherHandle, setOtherHandle] = useState("");
  const [state, setState] = useState<ThreadState>("loading");
  const [reportFailure, setReportFailure] = useState<{ owner: string; message: string } | null>(null);
  const { fromRefusal, adultGateDialog } = useMessageAdultGate();
  const [picking, setPicking] = useState<OpenPicker>(null);
  const [identity, setIdentity] = useState<ThreadIdentity | null>(null);
  // The other person's own face and name. A group is not a person, so it asks
  // for nobody; a direct thread falls back to the handle until the card lands.
  const card = usePublicProfileCard(threadCardHandle(identity, otherHandle));
  const [mobileAttachOpen, setMobileAttachOpen] = useState(false);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  // ONE removal asked at a time, and the thread's own confirm answers it.
  const [confirming, setConfirming] = useState<PendingRemoval | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removalError, setRemovalError] = useState("");
  const [removalAccountRevision, setRemovalAccountRevision] = useState(accountRevision);
  if (removalAccountRevision !== accountRevision) {
    setRemovalAccountRevision(accountRevision);
    setConfirming(null);
    setRemoving(false);
    setRemovalError("");
  }
  const listRef = useRef<HTMLUListElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const loadedForRef = useRef<ThreadReadKey | null>(null);
  const [viewRevision, setViewRevision] = useState<ThreadReadKey | null>(null);
  const requestGenerationRef = useRef(0);
  /**
   * The oldest read whose answer may still land. A read that lands raises it
   * to its own generation, so an older read answering later is dropped; a new
   * conversation or reader raises it past every read already sent.
   */
  const readFloorRef = useRef(0);
  const removedForRef = useRef<ThreadReadKey | null>(null);
  const removalEpochRef = useRef(0);
  useLayoutEffect(() => () => {
    removalEpochRef.current += 1;
    removedForRef.current = null;
  }, [accountRevision, conversationId]);
  const conversationIdRef = useRef(conversationId);
  /** Whether the inbox has already been asked to name THIS empty thread. */
  const askedInboxForNameRef = useRef(false);
  const accountRevisionRef = useRef(accountRevision);
  useLayoutEffect(() => {
    if (conversationIdRef.current === conversationId) return;
    readFloorRef.current = requestGenerationRef.current + 1;
    loadedForRef.current = null;
    setViewRevision(null);
    setRevealedId(null);
    setConfirming(null);
    setRemoving(false);
    setRemovalError("");
    setIdentity(null);
    setOtherHandle("");
    setMessages([]);
    askedInboxForNameRef.current = false;
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  useLayoutEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);
  const attachmentPickerRef = useRef<MessageAttachmentPickerHandle | null>(null);
  const enterSends = useEnterSends();
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    () => false,
  );
