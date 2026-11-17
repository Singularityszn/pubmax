"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { useAuth } from "@/components/auth/AuthProvider";
import { invalidateMessagesInboxOnFocus, readMessagesInbox } from "@/lib/messagesInboxClient";
import type { ConversationDTO } from "@/lib/messages";
import { subscribeToInbox } from "@/lib/messagesRealtime";
import { subscribeMessagesRead } from "@/lib/messagesUnreadSignal";
import { messageSnapshotKey, rememberMessageSnapshot } from "@/lib/messageReadSnapshots";
import { normalizeHandle } from "@/lib/profiles";
import { forgetSurfaceSnapshot, readSurfaceSnapshot } from "@/lib/surfaceDataCache";

const HANDLE_KEY = "pubmax_handle";
type InboxSnapshot = { conversations: ConversationDTO[]; partial: boolean };
type InboxThreadsLoaderOptions = Pick<ReturnType<typeof useAuth>, "accountRevision" | "user"> & {
  authHandle: ReturnType<typeof useAuth>["handle"];
  paneHidden: boolean;
  activeConversationId?: string;
};

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
}

export function useInboxThreadsLoader({
  accountRevision,
  user,
  authHandle,
  paneHidden,
  activeConversationId,
}: InboxThreadsLoaderOptions) {
  const activeUserId = user?.id;
  const canonicalAuthHandle = normalizeHandle(authHandle ?? "");
  const [handle, setHandle] = useState("");
  const [rows, setRows] = useState<{ readerKey: string; conversations: ConversationDTO[] } | null>(null);
  const readerKey = JSON.stringify([user?.id ?? null, accountRevision, normalizeHandle(authHandle ?? "") || readHandle()]);
  const [loadedReaderKey, setLoadedReaderKey] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  // The server refused this handle's inbox (403): the account does not own it.
  // Asking again cannot change that, so it is not `failed` and has no retry.
  const [handleNotOwned, setHandleNotOwned] = useState(false);
  const [failed, setFailed] = useState(false);
  // A read that ANSWERED but could not run one of the reads behind it. The rows
  // are real; a count or a preview may be missing. Kept apart from `failed`,
  // which is a read that did not answer at all, because the two owe the reader
  // different sentences.
  const [partial, setPartial] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);
  const accountRevisionRef = useRef(accountRevision);
  const requestGenerationRef = useRef(0);
  const pendingReadRef = useRef<{
    generation: number;
    signal?: AbortSignal;
    promise: Promise<void>;
  } | null>(null);
  const liveRef = useRef(false);
  const readsRef = useRef(new Set<AbortController>());
  const restoredKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    accountRevisionRef.current = accountRevision;
    liveRef.current = !paneHidden;
    const reads = readsRef.current;
    return () => {
      for (const read of reads) read.abort();
      reads.clear();
      liveRef.current = false;
      requestGenerationRef.current += 1;
      pendingReadRef.current = null;
    };
  }, [accountRevision, activeUserId, canonicalAuthHandle, paneHidden]);

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
    async (signal?: AbortSignal, supersede = false) => {
      const requestRevision = accountRevision;
      if (!liveRef.current || signal?.aborted || requestRevision !== accountRevisionRef.current) return;
      const pending = pendingReadRef.current;
      if (!supersede && pending && !pending.signal?.aborted && pending.generation === requestGenerationRef.current) {
        return pending.promise;
      }
      const generation = ++requestGenerationRef.current;
      const stillCurrent = () =>
        liveRef.current &&
        !signal?.aborted &&
        generation === requestGenerationRef.current &&
        requestRevision === accountRevisionRef.current;
      if (!activeUserId) {
        if (!stillCurrent()) return;
        setRows({ readerKey, conversations: [] });
        setNeedsSignIn(true);
        setHandleNotOwned(false);
        setFailed(false);
        setPartial(false);
        setLoadedReaderKey(readerKey);
        return;
      }
      const h = canonicalAuthHandle || readHandle();
      if (!h) {
        if (!stillCurrent()) return;
        setRows({ readerKey, conversations: [] });
        setNeedsSignIn(true);
        setHandleNotOwned(false);
        setFailed(false);
        setPartial(false);
        setLoadedReaderKey(readerKey);
        return;
      }
      const cacheKey = messageSnapshotKey(activeUserId, requestRevision, h)!;
      if (restoredKeyRef.current !== cacheKey) {
        restoredKeyRef.current = cacheKey;
        const held = readSurfaceSnapshot<InboxSnapshot>(cacheKey);
        if (stillCurrent()) setRows(current => current?.readerKey === readerKey ? current : { readerKey, conversations: [] });
        if (held && stillCurrent()) {
          setRows({ readerKey, conversations: held.conversations });
          setPartial(held.partial);
          setNeedsSignIn(false);
          setHandleNotOwned(false);
          setFailed(false);
          setLoadedReaderKey(readerKey);
        }
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      readsRef.current.add(controller);
      const promise = Promise.resolve().then(async () => {
        try {
          if (!stillCurrent()) return;
          const read = await readMessagesInbox(activeUserId, h, controller.signal);
          if (!stillCurrent()) return;
          setHandleNotOwned(read.status === 403);
          if (read.status === 401 || read.status === 403) {
            forgetSurfaceSnapshot(cacheKey);
            setNeedsSignIn(read.status === 401);
            setRows({ readerKey, conversations: [] });
            setFailed(false);
            setPartial(false);
            return;
          }
          if (read.status < 200 || read.status >= 300) {
            setNeedsSignIn(false);
            setFailed(true);
            setPartial(false);
            return;
          }
          setNeedsSignIn(false);
          const rows = read.conversations;
          const degraded = read.degraded;
          if (!degraded || rows.length > 0) {
            setRows({ readerKey, conversations: rows });
            rememberMessageSnapshot(cacheKey, { conversations: rows, partial: degraded });
          }
          // Degraded WITH NO ROWS may never read as an empty inbox: nothing was
          // answered, so the honest surface is the same one a failed read gets.
          setFailed(degraded && rows.length === 0);
          setPartial(degraded && rows.length > 0);
        } catch (err) {
          const aborted =
            signal?.aborted || (err instanceof Error && err.name === "AbortError");
          if (!aborted && stillCurrent()) {
            setNeedsSignIn(false);
            setHandleNotOwned(false);
            setFailed(true);
            setPartial(false);
          }
        } finally {
          signal?.removeEventListener("abort", abort);
          readsRef.current.delete(controller);
          if (stillCurrent()) setLoadedReaderKey(readerKey);
          if (pendingReadRef.current?.generation === generation) pendingReadRef.current = null;
        }
      });
      pendingReadRef.current = { generation, signal, promise };
      return promise;
    },
    // `handle` is deliberately NOT a dependency: the read derives the handle
    // itself, and re-keying on the state copy made every mount fetch the inbox
    // twice, once before the handle settled and once after.
    [accountRevision, activeUserId, canonicalAuthHandle, readerKey],
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

  // ONE read on mount. The subscription below is keyed on the handle, which
  // settles a tick after mount; keeping the two in one effect made that tick
  // refetch the whole inbox a second time.
  useEffect(() => {
    if (paneHidden) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    const onFocus = () => { invalidateMessagesInboxOnFocus(); void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, paneHidden]);

  // The subscription owns the poll: fallback cadence without a socket, a slow
  // safety poll with one, nothing while the tab is hidden.
  useEffect(() => {
    if (paneHidden || !handle || handleNotOwned) return;
    return subscribeToInbox(handle, () => void refresh(undefined, true), { poll: () => void refresh() });
  }, [refresh, handle, paneHidden, handleNotOwned]);

  // The open thread announces when it marks its messages read, and the nav
  // badge drops at once. Its row here drops its pill on the same signal, so the
  // two never disagree on one screen while the next inbox read is still away.
  // A read already in flight may have been answered before the mark-read, so
  // the signal also starts a fresh read that supersedes it: the stale answer is
  // dropped instead of putting the pill back.
  useEffect(() => {
    if (!activeConversationId) return;
    return subscribeMessagesRead(() => {
      const key = messageSnapshotKey(user?.id, accountRevision, normalizeHandle(authHandle ?? "") || readHandle());
      const held = key ? readSurfaceSnapshot<InboxSnapshot>(key) : undefined;
      if (held) rememberMessageSnapshot(key, {
        ...held,
        conversations: held.conversations.map(row => row.id === activeConversationId ? { ...row, unread: 0 } : row),
      }, true);
      setRows(heldRows => {
        if (heldRows?.readerKey !== readerKey || !heldRows.conversations.some(c => c.id === activeConversationId && (c.unread ?? 0) > 0)) return heldRows;
        return { readerKey, conversations: heldRows.conversations.map(c =>
          c.id === activeConversationId && (c.unread ?? 0) > 0 ? { ...c, unread: 0 } : c) };
      });
      void refresh(undefined, true);
    });
  }, [activeConversationId, refresh, user?.id, accountRevision, authHandle, readerKey]);

  const accountDataReady = loadedReaderKey === readerKey;
  return {
    handle,
    conversations: rows?.readerKey === readerKey ? rows.conversations : [],
    needsSignIn,
    handleNotOwned,
    failed,
    partial,
    retrying,
    retry,
    refresh,
    accountDataReady,
  };
}
