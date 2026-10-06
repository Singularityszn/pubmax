"use client";

import { Send, ChevronLeft, ImageIcon, MapPin, Plus } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import MessageAttachmentPicker, {
  type MessageAttachKind,
  type MessageAttachmentPickerHandle,
} from "@/components/messages/MessageAttachmentPicker";
import MessageAvatar from "@/components/messages/MessageAvatar";
import MessageContactCard from "@/components/messages/MessageContactCard";
import MessageContactPicker from "@/components/messages/MessageContactPicker";
import MessageEventCard from "@/components/messages/MessageEventCard";
import MessageEventPicker from "@/components/messages/MessageEventPicker";
import MessagePhoto from "@/components/messages/MessagePhoto";
import MessagePollCard from "@/components/messages/MessagePollCard";
import MessagePollComposer from "@/components/messages/MessagePollComposer";
import MessageVenueCard from "@/components/messages/MessageVenueCard";
import MessageVenuePicker, {
  type PickedVenue,
} from "@/components/messages/MessageVenuePicker";
import { authedActionFetch } from "@/lib/authedFetch";
import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { MOBILE_MEDIA_QUERY } from "@/lib/breakpoints";
import { useKeyboardInset } from "@/lib/keyboardInset";
import { discardBody } from "@/lib/responseBody";
import {
  MESSAGE_ATTACH_PHOTO_LABEL,
  MESSAGE_ATTACH_VENUE_LABEL,
  MESSAGE_PHOTO_CROP_TARGET,
  MESSAGE_PHOTO_FAILED_LINE,
} from "@/lib/messageAttachments";
import {
  GROUP_EMPTY_THREAD_LINE,
  GROUP_LEAVE_FAILED_LINE,
  GROUP_LEAVE_LABEL,
  GROUP_LEFT_LINE,
  groupMemberCountLine,
} from "@/lib/messageGroupThread";
import type { MessagePollView, MessagePollWrite } from "@/lib/messagePoll";
import {
  linkifyMentions,
  MAX_MESSAGE_BODY,
  otherHandleFromThreadIdentity,
  threadHeaderPrimaryLine,
  threadIdentityFromInboxRow,
  threadIdentityFromWire,
  type ConversationDTO,
  type MessageDTO,
  type ThreadIdentity,
} from "@/lib/messages";
import { subscribeToMessages } from "@/lib/messagesRealtime";
import {
  buildMessageTimeline,
  MESSAGE_READ_STATE_LABEL,
  type TimelineItem,
} from "@/lib/messageTimeline";
import { normalizeHandle } from "@/lib/profiles";
import {
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

import "@/app/messages/messages.css";

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
// A BUBBLE'S WIDTH IS THE ROW'S BUSINESS. Each row wraps its bubble in a
// `.messageLine`, which is the box the 75% limit lives on; putting that limit on
// the bubble made every bubble 78% of its OWN natural width, and "Yo!!" arrived
// on production as one character per line. See app/messages/messages.css.
//
// A THREAD READS LIKE A CONVERSATION. lib/messageTimeline.ts decides the day
// lines, which bubbles sit tight in one run, and where the time and the read
// state print (once, under the last bubble of a run). Tapping any bubble
// reveals its own time, and the Report control with it, so the thread is not
// a column of underlined Report links.
//
// A SENT MESSAGE APPEARS THE MOMENT IT IS SENT. The composer clears and an own
// bubble lands in the thread before the server answers; the refetch replaces
// it with the stored row, and a refused send takes it back off and puts the
// words back in the field, with the reason beside it.
//
// THE COMPOSER IS PINNED, above the phone tab bar and above the keyboard.
// lib/keyboardInset.ts measures the covered strip; lib/softKeyboard.ts says
// whether the bar has stepped aside. Both ride the root as data, so the
// stylesheet decides the geometry.
//
// A MESSAGE MAY CARRY ONE ATTACHMENT: a photo, or a pub. The photo takes the
// whole owned-image journey server-side and its bytes come back through the same
// courtesy gate the thread does (components/messages/MessagePhoto.tsx). The pub
// stores an id alone (no coordinate of any kind rides in a message) and its
// card is resolved live on the read path.

const HANDLE_KEY = "pubmax_handle";
/** The counter shows only once a message is close to the cap. */
const COUNTER_FROM = MAX_MESSAGE_BODY - 100;

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
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

type ThreadState =
  | "loading"
  | "ready"
  | "notfound"
  | "signedout"
  | "unreachable"
  /** This reader has just left a group. The thread stays; the way in does not. */
  | "left";

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

/** What is riding on the NEXT message. At most one, by design. */
type PendingAttachment =
  | { kind: "photo"; file: File; previewUrl: string }
  | { kind: "venue"; venue: PickedVenue }
  | { kind: "contact"; handle: string }
  | { kind: "event"; planId: string }
  | { kind: "poll"; poll: MessagePollWrite };

/** Which picker is open. One at a time, because one attachment rides at a time. */
type OpenPicker = "venue" | "contact" | "event" | "poll" | null;

/** What the composer's pending row says about what is ready to send. */
function pendingLabel(pending: PendingAttachment): string {
  switch (pending.kind) {
    case "photo":
      return "Photo ready to send";
    case "venue":
      return pending.venue.name;
    case "contact":
      return `@${pending.handle}`;
    case "event":
      return "Plan ready to send";
    case "poll":
      return pending.poll.question;
  }
}

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

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** An own message the server has not answered for yet. */
type OutboxMessage = MessageDTO & { pendingPhotoUrl?: string };

let outboxSeq = 0;

/**
 * The id ONE send attempt is known by, end to end. A uuid because the column
 * migration 0149 adds is a uuid; `crypto.randomUUID` is absent on an insecure
 * origin and in some older browsers, so the fallback keeps the shape rather
 * than sending something the write path would refuse.
 */
function newClientMessageId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const hex = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

function outboxMessage(
  conversationId: string,
  handle: string,
  body: string,
  pending: PendingAttachment | null,
): OutboxMessage {
  outboxSeq += 1;
  return {
    id: `outbox-${outboxSeq}`,
    conversationId,
    senderHandle: handle,
    body,
    createdAt: new Date().toISOString(),
    read: false,
    flagged: false,
    ...(pending?.kind === "photo" ? { pendingPhotoUrl: pending.previewUrl } : {}),
  };
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
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [otherHandle, setOtherHandle] = useState("");
  const [state, setState] = useState<ThreadState>("loading");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [picking, setPicking] = useState<OpenPicker>(null);
  const [identity, setIdentity] = useState<ThreadIdentity | null>(null);
  const [mobileAttachOpen, setMobileAttachOpen] = useState(false);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
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
  const conversationIdRef = useRef(conversationId);
  /** Whether the inbox has already been asked to name THIS empty thread. */
  const askedInboxForNameRef = useRef(false);
  const accountRevisionRef = useRef(accountRevision);
  useLayoutEffect(() => {
    if (conversationIdRef.current === conversationId) return;
    readFloorRef.current = requestGenerationRef.current + 1;
    loadedForRef.current = null;
    setViewRevision(null);
    setOutbox([]);
    setRevealedId(null);
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** Claimed before the first await in `send`; see the note there. */
  const sendInFlightRef = useRef(false);
  const cropCardRef = useRef<HTMLDivElement | null>(null);
  const enterSends = useEnterSends();
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    () => false,
  );
  const keyboardInset = useKeyboardInset();
  const keyboardOpen = useSyncExternalStore(
    subscribeSoftKeyboard,
    readSoftKeyboardOpen,
    serverSoftKeyboardOpen,
  );

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

  // The crop step declares itself modal, so it has to BE one: the rest of the
  // page goes inert, Tab cycles inside the card, Escape leaves, and focus lands
  // in the card rather than staying on the file input behind it. Without this a
  // keyboard reader tabbed straight out into the thread and composer beneath.
  const cropOpen = cropping !== null;
  useFocusTrap(cropOpen, cropCardRef);
  useDismissOnEscape(cropOpen, () => setCropping(null));
  useEffect(() => {
    if (!cropOpen) return;
    cropCardRef.current?.focus({ preventScroll: true });
  }, [cropOpen]);

  // Refetch the thread through the participant-gated API. A 404 = we're not a
  // participant (or the conversation is gone) → show not-found, never a leak.
  // Wave I2: 401 without sign-in -> signedout; Bearer via authedActionFetch.
  // A fetch that fails before THIS conversation has loaded lands on
  // "unreachable" so the loading line only ever stands for a load that is still
  // running; once this conversation HAS loaded, a failed poll keeps the messages
  // already on screen. The ref is keyed by id, not a bare flag: the thread pane
  // sits beside the inbox, so switching conversations reuses this instance.
  // A NEWER READ DOES NOT CANCEL AN OLDER ONE. An upstream outage the SDK
  // retries can hold a read past the next poll; when each poll superseded the
  // read before it, no answer ever landed. Every read of this thread may land
  // unless a newer one already has (see readFloorRef).
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const requestRevision = accountRevision;
      if (requestRevision !== accountRevisionRef.current) return;
      const requestKey: ThreadReadKey = { conversationId, accountRevision: requestRevision };
      const generation = requestGenerationRef.current + 1;
      requestGenerationRef.current = generation;
      const stillCurrent = () =>
        !signal?.aborted &&
        generation >= readFloorRef.current &&
        conversationIdRef.current === requestKey.conversationId &&
        accountRevisionRef.current === requestKey.accountRevision;
      const land = () => {
        readFloorRef.current = generation;
      };
      if (!user) {
        if (!stillCurrent()) return;
        land();
        loadedForRef.current = null;
        setViewRevision(viewerSession.unresolved ? null : requestKey);
        // The live session has not answered yet: a thread that cannot be read
        // is still loading. Calling it signed-out here showed a signed-in
        // drinker the sign-in door on their own conversation.
        setState(viewerSession.unresolved ? "loading" : "signedout");
        return;
      }
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (!h) {
        if (!stillCurrent()) return;
        land();
        loadedForRef.current = null;
        setViewRevision(requestKey);
        setState("signedout");
        return;
      }
      try {
        const res = await authedActionFetch(
          `/api/messages/${encodeURIComponent(conversationId)}?handle=${encodeURIComponent(h)}`,
          { signal }, { requiresIdentity: true },
        );
        if (!stillCurrent()) {
          discardBody(res);
          return;
        }
        land();
        if (res.status === 401) {
          discardBody(res);
          loadedForRef.current = null;
          setViewRevision(requestKey);
          setState("signedout");
          return;
        }
        if (res.status === 404) {
          discardBody(res);
          loadedForRef.current = null;
          setViewRevision(requestKey);
          setState("notfound");
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setViewRevision(requestKey);
          if (!sameThreadReadKey(loadedForRef.current, conversationId, requestRevision)) {
            setState("unreachable");
          }
          return;
        }
        const body = (await res.json()) as {
          messages?: MessageDTO[];
          conversation?: {
            kind?: string;
            members?: unknown;
            title?: unknown;
          };
        };
        if (!stillCurrent()) return;
        land();
        const next = Array.isArray(body.messages) ? body.messages : [];
        loadedForRef.current = requestKey;
        setViewRevision(requestKey);
        setMessages(next);
        // WHO THE THREAD IS WITH comes from the read's membership when it has
        // one; only then may a group title win. An empty direct thread has no
        // message to read a name off, so the inbox row for this id names it.
        // A GROUP is named by its title or its people, never by one of them,
        // so its head keeps drawing from the group's own name.
        const identityFromRead = threadIdentityFromWire(body.conversation);
        let nextIdentity: ThreadIdentity | null = identityFromRead;
        let nextOther =
          identityFromRead && identityFromRead.kind !== "group"
            ? otherHandleFromThreadIdentity(identityFromRead, h)
            : "";
        if (!identityFromRead) {
          const me = normalizeHandle(h);
          const theirs = next.find(
            (message) => normalizeHandle(message.senderHandle) !== me,
          );
          if (theirs) {
            nextOther = theirs.senderHandle;
          } else if (next.length === 0 && !askedInboxForNameRef.current) {
            // ONE read of the inbox per thread, and only for an empty one with
            // no membership: it names the head and nothing else leans on it, so
            // it may never fail a thread read that already succeeded, and a
            // request that never landed is asked again on the next refresh.
            const named = await nameFromInboxRow(h, conversationId);
            if (!stillCurrent()) return;
            if (named) {
              askedInboxForNameRef.current = true;
              nextIdentity = named.identity;
              if (named.identity?.kind !== "group") nextOther = named.otherHandle;
            }
          }
        }
        if (!stillCurrent()) return;
        // A NAME ALREADY LEARNED FOR THIS THREAD IS NEVER TAKEN BACK. A later
        // read that carries no membership leaves the head as it was rather than
        // flipping a named person back to the neutral word.
        setIdentity((previous) => nextIdentity ?? previous);
        setOtherHandle((previous) => nextOther || previous);
        setState("ready");
      } catch (err) {
        // An abort is our own teardown, never a failure the reader should see.
        const aborted =
          signal?.aborted || (err instanceof Error && err.name === "AbortError");
        if (!aborted && stillCurrent()) {
          land();
          setViewRevision(requestKey);
          if (!sameThreadReadKey(loadedForRef.current, conversationId, requestRevision)) {
            setState("unreachable");
          }
        }
      }
    },
    [accountRevision, conversationId, user, authHandle, viewerSession.unresolved],
  );

  // ONE OWNER OF THE POLL. subscribeToMessages owns every timer: the fallback
  // cadence when the socket is not live, a slow safety poll when it is, and no
  // poll at all while the tab is hidden. A second interval here used to poll
  // every ten seconds whatever the socket was doing and whether anyone was
  // looking. `handle` is deliberately not a dependency: the read derives the
  // handle itself, and re-keying on the state copy fetched the thread twice.
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    // Realtime signal-only nudge with a mandatory polling fallback. The nudge
    // never carries content - it just triggers the same gated refetch.
    const unsub = subscribeToMessages(conversationId, () => void refresh(), {
      poll: () => void refresh(),
    });
    return () => {
      controller.abort();
      // A read sent for the reader or thread this effect was keyed on may not
      // land on the next one.
      readFloorRef.current = requestGenerationRef.current + 1;
      window.removeEventListener("focus", onFocus);
      unsub();
    };
  }, [conversationId, refresh]);

  // The newest message is what a thread opens on and what a send lands on.
  // The list scrolls on its own inside the desktop split; on a phone the page
  // is the scroller and the composer is pinned over its foot, so the end
  // marker is scrolled clear of the composer rather than merely into view.
  // With no thread drawn (loading, not found, the retry panel) there is no
  // newest to show: pinning the page foot then pushed the retry panel above a
  // phone's fold, so a cold failure is left where the page starts.
  const scrollToNewest = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    if (getComputedStyle(list).overflowY === "auto") {
      list.scrollTop = list.scrollHeight;
      return;
    }
    const page = document.documentElement;
    // A page no taller than its viewport has nowhere to scroll to (and a DOM
    // with no layout, as in a unit test, measures zero here).
    if (page.scrollHeight <= window.innerHeight) return;
    window.scrollTo({ top: page.scrollHeight });
  }, []);

  useEffect(() => {
    scrollToNewest();
  }, [messages, outbox, keyboardInset, scrollToNewest]);

  // A viewport that changes height under an open thread (a keyboard on a
  // browser that shrinks the layout viewport, a rotation) keeps the newest
  // message in view rather than leaving the reader looking at the middle.
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(scrollToNewest);
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [scrollToNewest]);

  // The field grows with what is typed and stops at the CSS max-height, where
  // it starts scrolling. Measured off scrollHeight each change, because a row
  // count cannot know how a line wrapped.
  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [draft]);

  // A preview object URL belongs to the pending photo, so it is released when
  // that photo is replaced, sent or taken off.
  useEffect(() => {
    if (pending?.kind !== "photo") return;
    const url = pending.previewUrl;
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  const over = draft.length > MAX_MESSAGE_BODY;
  // A photo is a message. Something to send is text, an attachment, or both.
  const hasSomething = draft.trim().length > 0 || pending !== null;
  const canSend = hasSomething && !over && !sending;

  const clearPending = useCallback(() => {
    setPending(null);
    setCropping(null);
    setPicking(null);
  }, []);

  /** One picker at a time, because one attachment rides at a time. */
  const openPicker = useCallback((next: Exclude<OpenPicker, null>) => {
    setCropping(null);
    setPicking((current) => (current === next ? null : next));
  }, []);

  const handlePhotoFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setError("");
    setCropping(file);
  }, []);

  const handleAttachKindSelected = useCallback((kind: MessageAttachKind) => {
    trackEvent("message_attach_selected", { kind });
  }, []);

  const send = useCallback(async () => {
    // LATCHED ON A REF, CLAIMED BEFORE THE FIRST AWAIT - the plan-route rule.
    // `sending` is React state, committed a microtask after the event, so two
    // taps in one task both read it false and both posted.
    if (sendInFlightRef.current) return;
    const h = normalizeHandle(authHandle ?? "") || readHandle();
    const bodyText = draft.trim();
    if (!user || !h || over) return;
    if (!bodyText && !pending) return;
    sendInFlightRef.current = true;
    const sentPending = pending;
    const optimistic = outboxMessage(conversationId, h, bodyText, sentPending);
    // ONE ID FOR THIS ATTEMPT, minted here and sent on every retry of it, so a
    // connection reset after the row committed cannot store the line twice
    // (migration 0149's unique index is the other half).
    const clientMessageId = newClientMessageId();
    setSending(true);
    setError("");
    // The bubble lands and the field clears NOW; the server's answer replaces
    // the bubble or takes it back.
    setOutbox((rows) => [...rows, optimistic]);
    setDraft("");
    setPending(null);
    setCropping(null);
    setPicking(null);
    // A REFUSED SEND KEEPS WHAT THE DRINKER WROTE. The field was cleared at the
    // tap, so somebody who started the next line while the first was in flight
    // used to lose the first one outright: the bubble went, the text was
    // dropped for being "not empty", and all that was left was an error with
    // nothing to try again with. The failed line goes back at the TOP of
    // whatever is in the field, and a newly picked attachment is never
    // overwritten by the one that failed.
    const takeBack = () => {
      setOutbox((rows) => rows.filter((row) => row.id !== optimistic.id));
      if (bodyText) {
        setDraft((current) => (current.trim() ? `${bodyText}\n${current}` : bodyText));
      }
      if (sentPending) setPending((current) => current ?? sentPending);
    };
    try {
      const address = `/api/messages/${encodeURIComponent(conversationId)}`;
      // AT MOST ONE attachment names itself on the wire, and the server refuses
      // a body that names two, so this spread is the browser half of one rule
      // rather than a second copy of it.
      const post = {
        action: "send",
        handle: h,
        body: bodyText,
        clientMessageId,
        ...(sentPending?.kind === "venue" ? { venueId: sentPending.venue.id } : {}),
        ...(sentPending?.kind === "contact" ? { contactHandle: sentPending.handle } : {}),
        ...(sentPending?.kind === "event" ? { planId: sentPending.planId } : {}),
        ...(sentPending?.kind === "poll" ? { poll: sentPending.poll } : {}),
      };

      let res: Response;
      if (sentPending?.kind === "photo") {
        // The photo lane is multipart: one JSON part and one file, exactly the
        // shape the pub wall already sends.
        const form = new FormData();
        form.append("post", JSON.stringify(post));
        form.append("photo", sentPending.file);
        res = await authedActionFetch(address, { method: "POST", body: form }, { requiresIdentity: true });
      } else {
        res = await authedActionFetch(address, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(post),
        }, { requiresIdentity: true });
      }

      if (res.status === 401) {
        discardBody(res);
        takeBack();
        setState("signedout");
        return;
      }
      if (res.status === 429) {
        discardBody(res);
        takeBack();
        setError("Too many messages, slow down.");
        return;
      }
      if (!res.ok) {
        // The server's own sentence when it has one: a refused photo and a
        // conversation that is gone are different things to be told.
        const body: unknown = await res.json().catch(() => null);
        takeBack();
        setError(
          offlineOrMessage(errorMessageFrom(
                body,
                sentPending ? MESSAGE_PHOTO_FAILED_LINE : "Could not send that message. Try again.")
              ),
        );
        return;
      }
      // A SEND IS ONE REQUEST. The POST's own answer is the stored row, so the
      // outbox bubble is replaced by it in place; nothing is refetched to show
      // your own message. A body with no row falls back to the gated refetch.
      const body = (await res.json().catch(() => null)) as { message?: MessageDTO } | null;
      const stored = body?.message;
      if (stored && typeof stored.id === "string") {
        setMessages((rows) => (rows.some((row) => row.id === stored.id) ? rows : [...rows, stored]));
      } else {
        await refresh();
      }
      setOutbox((rows) => rows.filter((row) => row.id !== optimistic.id));
    } catch {
      takeBack();
      setError(
        offlineOrMessage(sentPending
            ? MESSAGE_PHOTO_FAILED_LINE
            : "Could not send that message. Try again.")
      );
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  }, [conversationId, draft, over, pending, refresh, user, authHandle]);

  /**
   * Answering a poll. The card shows the server's OWN tally rather than one
   * counted here, because a count derived in two places is two counts.
   */
  const vote = useCallback(
    async (messageId: string, optionIndex: number): Promise<MessagePollView | null> => {
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (!user || !h) return null;
      const res = await authedActionFetch(
        `/api/messages/${encodeURIComponent(conversationId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "vote", handle: h, messageId, optionIndex }),
        },
        { requiresIdentity: true },
      );
      if (!res.ok) {
        discardBody(res);
        return null;
      }
      const body = (await res.json().catch(() => null)) as { poll?: MessagePollView } | null;
      return body?.poll ?? null;
    },
    [conversationId, user, authHandle],
  );

  const leaveGroup = useCallback(async () => {
    const h = normalizeHandle(authHandle ?? "") || readHandle();
    if (!user || !h) return;
    setError("");
    try {
      const res = await authedActionFetch(
        `/api/messages/${encodeURIComponent(conversationId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "leave", handle: h }),
        },
        { requiresIdentity: true },
      );
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        setError(offlineOrMessage(errorMessageFrom(body, GROUP_LEAVE_FAILED_LINE)));
        return;
      }
      discardBody(res);
      // NO NAVIGATION. The thread is still on screen and still readable, so
      // the honest thing is to SAY what happened and offer the way back, the
      // same shape every other refused or finished state here takes. A
      // redirect would take the words away mid-sentence.
      setState("left");
    } catch {
      setError(offlineOrMessage(GROUP_LEAVE_FAILED_LINE));
    }
  }, [conversationId, user, authHandle]);

  const report = useCallback(
    async (messageId: string) => {
      const h = normalizeHandle(authHandle ?? "") || readHandle();
      if (!user || !h) return;
      setError("");
      try {
        const res = await authedActionFetch(`/api/messages/${encodeURIComponent(conversationId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "report", handle: h, messageId }),
        }, { requiresIdentity: true });
        if (!res.ok) {
          const body: unknown = await res.json().catch(() => null);
          setError(
            offlineOrMessage(errorMessageFrom(body, "Could not report that message. Try again."))
          );
          return;
        }
        discardBody(res);
        await refresh();
      } catch {
        setError(
          offlineOrMessage("Could not report that message. Try again.")
        );
      }
    },
    [conversationId, refresh, user, authHandle],
  );

  const timeline = useMemo<TimelineItem[]>(() => {
    const rows: MessageDTO[] = outbox.length > 0 ? [...messages, ...outbox] : messages;
    return buildMessageTimeline(rows, handle, new Date());
  }, [messages, outbox, handle]);
  const outboxIds = useMemo(() => new Set(outbox.map((row) => row.id)), [outbox]);
  const outboxPhotoUrls = useMemo(
    () => new Map(outbox.map((row) => [row.id, row.pendingPhotoUrl])),
    [outbox],
  );

  if (!sameThreadReadKey(viewRevision, conversationId, accountRevision)) {
    return <p className="conversationPreview">With you in a sec.</p>;
  }

  if (state === "signedout" && viewerSession.signedOut) {
    return (
      <div className="conversationPreview messagesSignInPrompt">
        <p>Sign in to read and send messages.</p>
        <SignInButton />
      </div>
    );
  }
  if (state === "signedout") {
    return <p className="conversationPreview">With you in a sec.</p>;
  }
  if (state === "left") {
    return (
      <p className="conversationPreview" role="status">
        {GROUP_LEFT_LINE} <Link href="/messages">Back to inbox</Link>
      </p>
    );
  }
  if (state === "notfound") {
    return (
      <p className="conversationPreview">
        Conversation not found. <Link href="/messages">Back to inbox</Link>
      </p>
    );
  }
  if (state === "unreachable") {
    return (
      <div className="threadFailure" role="status">
        <p>This conversation won&rsquo;t open right now. Your messages are safe.</p>
        <button
          type="button"
          className="threadRetryBtn"
          onClick={() => {
            setState("loading");
            void refresh();
          }}
        >
          Try again
        </button>
        <Link href="/messages">Back to inbox</Link>
      </div>
    );
  }

  /**
   * WHAT RODE WITH ONE MESSAGE. A nested function rather than a component, the
   * decomposition idiom this tree already uses: the element tree stays
   * identical where a component would add a fibre, and ESLint scores the
   * branch count here rather than on the whole thread.
   */
  function renderAttachment(m: MessageDTO, sendingRow: boolean): React.JSX.Element | null {
    const attachment = m.attachment;
    if (!attachment) return null;
    if (attachment.kind === "photo") {
      return (
        <MessagePhoto
          url={attachment.url}
          width={attachment.width}
          height={attachment.height}
          senderHandle={m.senderHandle}
          handle={handle}
        />
      );
    }
    if (attachment.kind === "venue") return <MessageVenueCard card={attachment.card} />;
    if (attachment.kind === "contact") return <MessageContactCard card={attachment.card} />;
    if (attachment.kind === "event") return <MessageEventCard card={attachment.card} />;
    return (
      <MessagePollCard
        poll={attachment.poll}
        disabled={sendingRow}
        onVote={(optionIndex) => vote(m.id, optionIndex)}
      />
    );
  }

  const showCounter = draft.length >= COUNTER_FROM;
  const isGroup = identity?.kind === "group";
  // ONE naming rule for every kind (`threadHeaderPrimaryLine`), the same one
  // the inbox row reads through `conversationRowName`: a direct thread is the
  // other person, a group is its title or its people. Null is the neutral word.
  const threadName = threadHeaderPrimaryLine(identity, otherHandle, handle);

  /** Whichever picker is open, in the composer dock. One at a time, by design. */
  function renderPicker(): React.JSX.Element | null {
    if (picking === "venue") {
      return (
        <MessageVenuePicker
          onCancel={() => setPicking(null)}
          onPick={(venue) => {
            setPicking(null);
            setPending({ kind: "venue", venue });
          }}
        />
      );
    }
    if (picking === "contact") {
      return (
        <MessageContactPicker
          onCancel={() => setPicking(null)}
          onPick={(contactHandle) => {
            setPicking(null);
            setPending({ kind: "contact", handle: contactHandle });
          }}
        />
      );
    }
    if (picking === "event") {
      return (
        <MessageEventPicker
          onCancel={() => setPicking(null)}
          onPick={(planId) => {
            setPicking(null);
            setPending({ kind: "event", planId });
          }}
        />
      );
    }
    if (picking === "poll") {
      return (
        <MessagePollComposer
          onCancel={() => setPicking(null)}
          onPick={(poll) => {
            setPicking(null);
            setPending({ kind: "poll", poll });
          }}
        />
      );
    }
    return null;
  }

  /** Who the thread is with. A group is named by its people, never linked to. */
  function renderThreadWith(): React.JSX.Element {
    if (isGroup) {
      // A GROUP IS NOT A PERSON, so its head is not a link to a profile: its
      // name is the title or the people in it.
      return (
        <span className="threadWith">
          <MessageAvatar handle={otherHandle || (threadName ?? "")} size={36} />
          <span className="threadWithGroup">
            <span className="threadWithHandle">{threadName}</span>
            <span className="threadWithMembers">
              {groupMemberCountLine(identity?.members.length ?? 0)}
            </span>
          </span>
        </span>
      );
    }
    if (threadName) {
      return (
        <Link href={`/u/${encodeURIComponent(otherHandle)}`} className="threadWith">
          <MessageAvatar handle={otherHandle} size={36} />
          <span className="threadWithHandle">{threadName}</span>
        </Link>
      );
    }
    return (
      <span className="threadWith">
        <span className="threadWithHandle">Conversation</span>
      </span>
    );
  }

  return (
    <div className="messageThread">
      {/* The shell is `display: contents`: it carries the keyboard facts as
          data for the stylesheet and the marker that hides the compose
          control, and draws no box of its own. */}
      <div
        className="messageThreadShell pageHidesCreateFab"
        data-keyboard-open={keyboardOpen ? "" : undefined}
        style={{ "--keyboard-inset": `${keyboardInset}px` } as React.CSSProperties}
      >
      <div className="threadHeader">
        <Link href="/messages" className="threadBackLink" aria-label="Back to inbox">
          <ChevronLeft size={24} aria-hidden="true" />
        </Link>
        {renderThreadWith()}
        {isGroup ? (
          <button type="button" className="threadLeaveBtn" onClick={() => void leaveGroup()}>
            {GROUP_LEAVE_LABEL}
          </button>
        ) : null}
      </div>

      {state === "loading" ? (
        <p className="conversationPreview">With you in a sec.</p>
      ) : (
        <ul className="threadMessages" ref={listRef}>
          {timeline.length === 0 ? (
            <li className="threadEmpty" aria-live="polite">
              {otherHandle ? <MessageAvatar handle={otherHandle} size={72} /> : null}
              <p className="threadEmptyTitle">
                {threadName ?? "Nothing here yet."}
              </p>
              <p className="threadEmptyLine">
                {isGroup
                  ? GROUP_EMPTY_THREAD_LINE
                  : "Say hello. This one stays between the two of you."}
              </p>
            </li>
          ) : null}
          {timeline.map((item) => {
            if (item.kind === "day") {
              return (
                <li key={`day-${item.key}`} className="threadDay" aria-label={item.label}>
                  <span>{item.label}</span>
                </li>
              );
            }
            const m = item.message;
            const mine = item.mine;
            const sendingRow = outboxIds.has(m.id);
            const revealed = revealedId === m.id;
            const pendingPhoto = outboxPhotoUrls.get(m.id);
            return (
              <li
                key={m.id}
                className={mine ? "messageRow messageRowMine" : "messageRow"}
                data-first={item.first ? "" : undefined}
                data-last={item.last ? "" : undefined}
                data-revealed={revealed ? "" : undefined}
                data-sending={sendingRow ? "" : undefined}
              >
                {/* The box the 75% width limit lives on. */}
                <div className="messageLine">
                  <div
                    className={[
                      mine ? "messageBubble messageBubbleMine" : "messageBubble messageBubbleTheirs",
                      (m.attachment?.kind === "photo" || pendingPhoto) && !m.body ? "messageBubblePhoto" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => setRevealedId((current) => (current === m.id ? null : m.id))}
                  >
                    {renderAttachment(m, sendingRow)}
                    {pendingPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local object URL for the photo on its way
                      <img className="messagePhotoSending" src={pendingPhoto} alt="" />
                    ) : null}
                    {m.body ? <MessageBody body={m.body} /> : null}
                  </div>
                  <div className="messageMeta">
                    <time className="messageClock" dateTime={m.createdAt}>
                      {item.clock}
                    </time>
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
                  {sendingRow ? (
                    <span className="messageReadState">Sending</span>
                  ) : item.readState ? (
                    <span className="messageReadState">
                      {MESSAGE_READ_STATE_LABEL[item.readState]}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
          <li className="threadListEnd" aria-hidden="true">
            <div ref={listEndRef} />
          </li>
        </ul>
      )}

      <MessageAttachmentPicker
        ref={attachmentPickerRef}
        open={mobileAttachOpen}
        disabled={sending}
        onOpenChange={setMobileAttachOpen}
        onFileChange={handlePhotoFileChange}
        onKindSelected={handleAttachKindSelected}
        onAttachmentKind={(kind) => {
          trackEvent("message_attach_selected", { kind });
          openPicker(kind);
        }}
      />

      {cropping ? (
        <div className="messageCropOverlay">
          <div
            ref={cropCardRef}
            className="messageCropCard"
            role="dialog"
            aria-modal="true"
            aria-label="Crop photo"
            tabIndex={-1}
          >
            <ProfileImageCropper
              key={fileKey(cropping)}
              target={MESSAGE_PHOTO_CROP_TARGET}
              file={cropping}
              busy={sending}
              onCancel={() => setCropping(null)}
              onCropped={(file) => {
                setCropping(null);
                setPending({ kind: "photo", file, previewUrl: URL.createObjectURL(file) });
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="composerDock">
        {error ? <p className="threadError" role="alert">{error}</p> : null}

        {renderPicker()}

        {pending ? (
          <div className="composerPending">
            {pending.kind === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL for the photo about to send
              <img className="composerPendingThumb" src={pending.previewUrl} alt="" />
            ) : (
              <MapPin size={18} aria-hidden="true" className="composerPendingIcon" />
            )}
            <span className="composerPendingLabel">{pendingLabel(pending)}</span>
            <button type="button" className="composerPendingRemove" onClick={clearPending}>
              Remove
            </button>
          </div>
        ) : null}

        <div className="composer">
          <div className="composerControls">
            {/* THE SHEET IS THE ONE HOME FOR EVERY KIND, at every width: five
                kinds is five icons, and a composer row cannot hold five and a
                field and Send on a 320px screen. The two shortcuts beside it
                are the two a drinker reaches for most. */}
            {isMobileViewport ? (
              <button
                type="button"
                className="composerMobileAttach"
                aria-label="Add an attachment"
                aria-expanded={mobileAttachOpen}
                disabled={sending}
                onClick={() => {
                  setPicking(null);
                  setMobileAttachOpen(true);
                }}
              >
                <Plus size={22} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="composerAttach composerMoreDesktop"
                aria-label="More to attach"
                aria-expanded={mobileAttachOpen}
                disabled={sending}
                onClick={() => {
                  setPicking(null);
                  setMobileAttachOpen(true);
                }}
              >
                <Plus size={20} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="composerAttach composerPhotoDesktop"
              aria-label={MESSAGE_ATTACH_PHOTO_LABEL}
              aria-pressed={pending?.kind === "photo"}
              disabled={sending}
              onClick={() => {
                setPicking(null);
                attachmentPickerRef.current?.select("photos");
              }}
            >
              <ImageIcon size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="composerAttach composerVenueDesktop"
              aria-label={MESSAGE_ATTACH_VENUE_LABEL}
              aria-pressed={pending?.kind === "venue"}
              disabled={sending}
              onClick={() => openPicker("venue")}
            >
              <MapPin size={20} aria-hidden="true" />
            </button>
          </div>
          <div className="composerField">
            <textarea
              ref={inputRef}
              className="composerInput"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message…"
              maxLength={MAX_MESSAGE_BODY + 100}
              rows={1}
              aria-label="Message"
              /* A message is somebody talking. The keyboard helps them the way it
                 helps them everywhere else: sentence case, autocorrect on, spelling
                 checked. Turning these off is what makes a web composer feel unlike
                 the messaging app beside it. */
              autoCapitalize="sentences"
              autoCorrect="on"
              spellCheck
              enterKeyHint={enterSends ? "send" : "enter"}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                // On a phone the return key writes a new line; only a keyboard with
                // a modifier to spare sends on it.
                if (!enterSends) return;
                e.preventDefault();
                if (canSend) void send();
              }}
            />
            {showCounter ? (
              <span
                className={over ? "composerCount composerCountOver" : "composerCount"}
                aria-live="polite"
              >
                {draft.length}/{MAX_MESSAGE_BODY}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="composerSend"
            aria-label="Send"
            disabled={!canSend}
            onClick={() => void send()}
          >
            <Send size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
