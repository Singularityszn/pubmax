"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import NavPendingIndicator from "@/components/nav/NavPendingIndicator";
import { invalidateMessagesInbox, invalidateMessagesInboxOnFocus, markMessagesInboxVisible, readMessagesInbox } from "@/lib/messagesInboxClient";
import type { ConversationDTO } from "@/lib/messages";
import { announceInboxArrival, subscribeToInbox } from "@/lib/messagesRealtime";
import { restoreMessagePushAccount } from "@/lib/messageNotificationClient";
import { MESSAGE_PUSH_DEPARTURE, releaseMessagePush, flushMessagePushReleases, queueMessagePushOperation, currentMessagePushToken } from "@/lib/messageNotificationLifecycle";
import { getAccessToken } from "@/lib/authClient";
import { readProviderAccountRevision, readProviderAccountSignal } from "@/lib/authProviderRevision";
import { useViewerSession } from "@/components/auth/useViewerSession";
import MessageArrivalNotice from "@/components/messages/MessageArrivalNotice";
import { selectMessageArrival } from "@/lib/messageArrival";
import { subscribeMessagesRead } from "@/lib/messagesUnreadSignal";
import { normalizeHandle } from "@/lib/profiles";
import { safeLocalStorage } from "@/lib/safeStorage";

const HANDLE_KEY = "pubmax_handle";

function readHandle(): string {
  return normalizeHandle(safeLocalStorage()?.getItem(HANDLE_KEY) ?? "");
}

export default function MessagesLink(): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  const { accountRevision, user, handle: authHandle } = useAuth();
  const viewerSession = useViewerSession();
  const activeUserId = user?.id;
  const [handle, setHandle] = useState("");
  const [unreadResult, setUnreadResult] = useState<{
    userId: string;
    handle: string;
    count: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previousRef = useRef<{ userId: string; rows: ConversationDTO[] } | null>(null);
  const [arrival, setArrival] = useState<{ userId: string; conversation: ConversationDTO } | null>(null);

  useEffect(() => {
    if (viewerSession.unresolved) return;
    const controllers = new Set<AbortController>();
    const stop = () => { for (const controller of controllers) controller.abort(); controllers.clear(); };
    const restore = () => {
      if (document.visibilityState === "hidden") return;
      if (!activeUserId) { void releaseMessagePush().catch(() => undefined); return; }
      const controller = new AbortController();
      controllers.add(controller);
      void restoreMessagePushAccount(controller.signal, activeUserId).catch(() => undefined).finally(() => controllers.delete(controller));
    };
    window.addEventListener(MESSAGE_PUSH_DEPARTURE, stop);
    window.addEventListener("online", restore);
    document.addEventListener("visibilitychange", restore);
    restore();
    return () => { stop(); window.removeEventListener(MESSAGE_PUSH_DEPARTURE, stop); window.removeEventListener("online", restore); document.removeEventListener("visibilitychange", restore); };
  }, [activeUserId, viewerSession.unresolved]);

  const dismissArrival = useCallback(() => setArrival(null), []);

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

  const effectiveHandle = normalizeHandle(authHandle ?? "") || handle.trim();
  const unread = unreadResult?.userId === user?.id && unreadResult?.handle === effectiveHandle
    ? unreadResult.count
    : 0;

  const refresh = useCallback(async (supersede = false) => {
    if (document.visibilityState === "hidden") return;
    if (abortRef.current && !abortRef.current.signal.aborted && !supersede) return;
    if (!activeUserId) {
      setUnreadResult(null);
      return;
    }
    const h = effectiveHandle;
    if (!h) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const read = await readMessagesInbox(activeUserId, h, controller.signal);
      if (controller.signal.aborted || abortRef.current !== controller || read.status < 200 || read.status >= 300) return;
      const rows = read.conversations;
      const total = rows.reduce((sum, c) => sum + (c.unread || 0), 0);
      const previous = previousRef.current?.userId === activeUserId ? previousRef.current.rows : null;
      const candidates = !read.degraded && previous ? rows.filter((row) => {
        const old = previous.find((item) => item.id === row.id);
        return row.lastMessageId && !row.lastFromMe && (row.unread ?? 0) > 0 && row.lastMessageId !== old?.lastMessageId;
      }) : [];
      setUnreadResult({ userId: activeUserId, handle: h, count: total });
      const incoming = await selectMessageArrival(candidates, controller.signal, (row) => pathnameRef.current === `/messages/${row.id}`);
      if (controller.signal.aborted || abortRef.current !== controller) return;
      if (!read.degraded) previousRef.current = { userId: activeUserId, rows };
      if (incoming) setArrival({ userId: activeUserId, conversation: incoming });
    } catch {
      // aborted / offline — leave the badge as-is; the nav never breaks on this.
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [effectiveHandle, activeUserId]);

  useEffect(() => {
    // Never setState synchronously in the effect body (react-hooks/set-state-in-effect).
    if (!activeUserId) {
      void Promise.resolve().then(() => setUnreadResult(null));
      return;
    }
    let mounted = true;
    void Promise.resolve().then(() => { if (mounted) void refresh(); });
    const stop = subscribeToInbox(effectiveHandle, () => void refresh(true), { poll: () => void refresh() });
    const onVisibility = (event: Event) => {
      if (document.visibilityState === "hidden") abortRef.current?.abort();
      else {
        invalidateMessagesInbox(effectiveHandle, false);
        void refresh();
        markMessagesInboxVisible(effectiveHandle, event.timeStamp);
      }
    };
    const onFocus = () => { invalidateMessagesInboxOnFocus(effectiveHandle); void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    const onPush = (event: MessageEvent) => {
      const reply = event.ports[0];
      if (event.data?.type === "pubmax:message-preview-auth" && event.data.recipientId === activeUserId && reply) {
        const revision = readProviderAccountRevision();
        void queueMessagePushOperation(async () => flushMessagePushReleases(AbortSignal.timeout(1_000), await currentMessagePushToken() ?? ""))
          .then(getAccessToken).then((token) => {
            reply.postMessage({ token: revision === readProviderAccountRevision() && !readProviderAccountSignal().aborted ? token : null });
          }).catch(() => reply.postMessage({ token: null }));
      }
      if (event.data?.type === "pubmax:message-arrival" && event.data.recipientId === activeUserId) { announceInboxArrival(effectiveHandle); }
    };
    navigator.serviceWorker?.addEventListener("message", onPush);
    // A completed thread read supersedes an older unread-count request.
    const unsubscribeRead = subscribeMessagesRead(() => void refresh(true));
    return () => {
      mounted = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      abortRef.current?.abort();
      navigator.serviceWorker?.removeEventListener("message", onPush);
      unsubscribeRead();
    };
  }, [refresh, accountRevision, activeUserId, effectiveHandle]);

  // A signed-out visitor has no inbox, so the link is not drawn for them at all
  // (Oct 2026 UX audit). It appears once a session exists.
  if (!user) return null;

  const label = unread > 0 ? `Messages, ${unread} unread` : "Messages";

  return (
    <>
    <Link
      href="/messages"
      // Warmed on intent by the handler below, so Next's automatic on-sight
      // prefetch is turned off: this control rides SiteNav on every route, and
      // a dynamic route prefetched on sight is a server render queued in front
      // of the page the reader is waiting for (components/nav/IntentLink.tsx).
      prefetch={false}
      className="siteNavBell navPendingLink"
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
      <MessageSquare size={20} aria-hidden="true" />
      {unread > 0 ? (
        <span className="siteNavBellBadge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
      <NavPendingIndicator />
    </Link>
    {arrival?.userId === user.id && pathname !== `/messages/${arrival.conversation.id}` ? <MessageArrivalNotice key={`${arrival.conversation.id}:${arrival.conversation.lastMessageId}`} conversation={arrival.conversation} inbox={pathname === "/messages"} currentPath={pathname} onDismiss={dismissArrival} /> : null}
    </>
  );
}
