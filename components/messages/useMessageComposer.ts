"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useReducer, useState, type ChangeEvent } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { MESSAGE_PHOTO_FAILED_LINE } from "@/lib/messageAttachments";
import { messagePhotos, newMessageClientId, transitionComposerActivity, type ComposerActivity, type MessagePhotoDraft, type OutboxMessage, type PendingMessageAttachment } from "@/lib/messageComposer";
import { messageSendPayload, retainedMessageSendKey, type MessageSendAttempt } from "@/lib/messageSendAttempt";
import { MAX_MESSAGE_BODY, type MessageDTO } from "@/lib/messages";
import { normalizeHandle } from "@/lib/profiles";
import { preparePhotoUpload } from "@/lib/preparePhotoUpload";
import { safeLocalStorage } from "@/lib/safeStorage";
import { MESSAGE_PHOTO_LIMIT as MESSAGE_PHOTO_BATCH_LIMIT } from "@/lib/messagePhotoBudget";
import { discardMessagePhotoRecovery, rememberMessagePhotos, readMessagePhotoRecovery } from "@/lib/messagePhotoRecovery";
import { discardBody } from "@/lib/responseBody";

type Options = {
  conversationId: string;
  accountRevision: number;
  user: { id: string } | null;
  authHandle: string | null;
  refresh: () => Promise<void>;
  onStored: (message: MessageDTO) => void;
  onSignedOut: () => void;
  fromRefusal: (body: unknown) => boolean;
};

function sendBody(post: object, attachment: PendingMessageAttachment | null): BodyInit {
  if (attachment?.kind !== "photo") return JSON.stringify(post);
  const form = new FormData();
  form.append("post", JSON.stringify(post));
  form.append("photo", attachment.file, "message-photo.jpg");
  return form;
}

async function photoBytes(attachment: PendingMessageAttachment | null): Promise<Uint8Array | null> {
  return attachment?.kind === "photo" ? new Uint8Array(await attachment.file.arrayBuffer()) : null;
}

function postMessage(address: string, post: object, attachment: PendingMessageAttachment | null, signal: AbortSignal) {
  const body = sendBody(post, attachment);
  return authedActionFetch(address, {
    method: "POST", body, signal,
    ...(typeof body === "string" ? { headers: { "content-type": "application/json" } } : {}),
  }, { requiresIdentity: true });
}

export function useMessageComposer(options: Options) {
  const { conversationId, accountRevision, user, authHandle, refresh, onStored, onSignedOut, fromRefusal } = options;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessageAttachment | null>(null);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [sentPhotos, setSentPhotos] = useState<Record<string, { url: string; handle: string; photo: MessagePhotoDraft }>>({});
  const owner = `${user?.id ?? ""}:${accountRevision}:${conversationId}`;
  const [activity, dispatch] = useReducer(transitionComposerActivity, { phase: "ready", scope: owner } as ComposerActivity);
  const sending = activity.phase === "sending";
  const preparing = activity.phase === "preparing";
  const preparationProgress = activity.phase === "preparing" ? { completed: activity.completed, total: activity.total } : null;
  const error = activity.phase === "failed" ? activity.message : "";
  const retrySend = activity.phase === "failed" && activity.operation === "send";
  const setError = useCallback((message: string, operation: "prepare" | "send" = "send") => dispatch(message ? { type: "fail", scope: owner, message, operation } : { type: "clear-error", scope: owner }), [owner]);
  const inFlight = useRef(false);
  const unsentKey = useRef<MessageSendAttempt | null>(null);
  const scope = useRef(0);
  const pick = useRef(0);
  const ownedUrls = useRef(new Set<string>());
  const [renderedOwner, setRenderedOwner] = useState(owner);
  if (renderedOwner !== owner) {
    setRenderedOwner(owner);
    setDraft(""); setPending(null); setOutbox([]); setSentPhotos({}); dispatch({ type: "reset", scope: owner });
  }

  useLayoutEffect(() => {
    scope.current += 1;
    pick.current += 1;
    inFlight.current = false;
    unsentKey.current = null;
    return () => {
      scope.current += 1;
      pick.current += 1;
    };
  }, [owner]);

  useEffect(() => {
    const urls = ownedUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [owner]);

  useEffect(() => {
    const live = new Set([...messagePhotos(pending).map(photo => photo.previewUrl), ...outbox.flatMap(row => row.pendingPhoto ? [row.pendingPhoto.previewUrl] : []), ...Object.values(sentPhotos).map(sent => sent.photo.previewUrl)]);
    for (const url of ownedUrls.current) {
      if (live.has(url)) continue;
      URL.revokeObjectURL(url);
      ownedUrls.current.delete(url);
    }
  }, [pending, outbox, sentPhotos]);

  useEffect(() => {
    const revision = scope.current;
    queueMicrotask(() => {
      if (revision !== scope.current) return;
      const recovery = readMessagePhotoRecovery(owner);
      if (!recovery) return;
      const photos = recovery.photos.map(photo => ({ ...photo, previewUrl: URL.createObjectURL(photo.file) }));
      for (const photo of photos) ownedUrls.current.add(photo.previewUrl);
      const first = photos[0];
      if (!first) return;
      unsentKey.current = recovery.attempt;
      setDraft(recovery.body);
      setPending({ kind: "photo", ...first, remaining: photos.slice(1) });
      if (recovery.failure) setError(recovery.failure.message, recovery.failure.operation);
    });
  }, [owner, setError]);

  useLayoutEffect(() => {
    const photos = messagePhotos(pending);
    if (photos.length) rememberMessagePhotos(owner, {
      photos: photos.map(({ file, width, height }) => ({ file, width, height })), body: draft, attempt: unsentKey.current,
      failure: activity.phase === "failed" ? { message: activity.message, operation: activity.operation } : null,
    }, readProviderAccountSignal());
  }, [owner, pending, draft, activity]);

  const abandon = useCallback(() => {
    scope.current += 1;
    pick.current += 1;
    inFlight.current = false;
    unsentKey.current = null;
    setDraft(""); setPending(null); setOutbox([]); setSentPhotos({});
    dispatch({ type: "reset", scope: owner });
    discardMessagePhotoRecovery(owner);
  }, [owner]);

  const cancelPreparation = useCallback(() => {
    if (inFlight.current) return;
    pick.current += 1; dispatch({ type: "finish", scope: owner });
  }, [owner]);
  const clearPending = useCallback(() => {
    if (inFlight.current) return;
    pick.current += 1; dispatch({ type: "reset", scope: owner }); setPending(null);
    discardMessagePhotoRecovery(owner);
  }, [owner]);
  const chooseAttachment = useCallback((attachment: PendingMessageAttachment) => {
    if (inFlight.current) return;
    pick.current += 1; dispatch({ type: "reset", scope: owner }); setPending(attachment);
    discardMessagePhotoRecovery(owner);
  }, [owner]);

  const selectPhotos = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || inFlight.current) return;
    const selection = ++pick.current;
    if (files.length > MESSAGE_PHOTO_BATCH_LIMIT) {
      setError(`Choose up to ${MESSAGE_PHOTO_BATCH_LIMIT} photos at a time.`, "prepare");
      return;
    }
    const revision = scope.current;
    const signal = readProviderAccountSignal();
    const photos: MessagePhotoDraft[] = [];
    dispatch({ type: "prepare", scope: owner, total: files.length }); setError("");
    try {
      for (const file of files) {
        const prepared = await preparePhotoUpload(file);
        if (revision !== scope.current || selection !== pick.current || signal.aborted) return;
        photos.push({ ...prepared, previewUrl: URL.createObjectURL(prepared.file) });
        dispatch({ type: "progress", scope: owner, completed: photos.length });
      }
      const first = photos[0];
      if (first) {
        for (const photo of photos) ownedUrls.current.add(photo.previewUrl);
        setPending({ kind: "photo", ...first, remaining: photos.slice(1) });
      }
    } catch (cause) {
      if (revision === scope.current && selection === pick.current && !signal.aborted) setError(cause instanceof Error ? cause.message : "Could not prepare that photo. Try another one.", "prepare");
    } finally {
      const committed = photos.length === files.length && revision === scope.current && selection === pick.current && !signal.aborted;
      if (!committed) for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
      if (revision === scope.current && selection === pick.current) dispatch({ type: "finish", scope: owner });
    }
  }, [owner, setError]);

  const acknowledge = useCallback((stored: MessageDTO, attachment: PendingMessageAttachment | null, handle: string) => {
    if (attachment?.kind === "photo" && stored.attachment?.kind === "photo") {
      const url = stored.attachment.url;
      setSentPhotos(value => ({ ...value, [stored.id]: { url, handle, photo: attachment } }));
    }
    onStored(stored);
  }, [onStored]);

  const send = useCallback(async () => {
    const handle = normalizeHandle(authHandle ?? "") || normalizeHandle(safeLocalStorage()?.getItem("pubmax_handle") ?? "");
    const bodyText = draft.trim();
    if (inFlight.current || preparing || !user || !handle || draft.length > MAX_MESSAGE_BODY || (!bodyText && !pending)) return;
    inFlight.current = true;
    const revision = scope.current;
    const signal = readProviderAccountSignal();
    const current = () => revision === scope.current && !signal.aborted;
    const photos = messagePhotos(pending);
    const jobs: Array<PendingMessageAttachment | null> = photos.length ? photos.map(photo => ({ kind: "photo", ...photo, remaining: undefined })) : [pending];
    const rows = jobs.map((attachment, index): OutboxMessage => ({
      id: `outbox-${newMessageClientId()}`, conversationId, senderHandle: handle,
      body: index === 0 ? bodyText : "", createdAt: new Date().toISOString(), read: false, flagged: false,
      ...(attachment?.kind === "photo" ? { pendingPhoto: attachment } : {}), queued: index > 0,
    }));
    if (photos.length) rememberMessagePhotos(owner, {
      photos: photos.map(({ file, width, height }) => ({ file, width, height })), body: bodyText, attempt: unsentKey.current,
      failure: null,
    }, signal);
    dispatch({ type: "send", scope: owner }); setError(""); setOutbox(rows); setDraft(""); setPending(null);
    let index = 0;
    const takeBack = () => {
      if (!current()) return;
      setOutbox([]);
      if (index === 0 && bodyText) setDraft(value => value.trim() ? `${bodyText}\n${value}` : bodyText);
      const failed = jobs[index];
      if (failed?.kind === "photo") {
        setPending(value => value ?? { ...failed, remaining: photos.slice(index + 1) });
      } else if (failed) setPending(value => value ?? failed);
    };
    try {
      for (; index < jobs.length; index += 1) {
        if (!current()) return;
        const attachment = jobs[index] ?? null;
        const row = rows[index]!;
        setOutbox(value => value.map(item => item.id === row.id ? { ...item, queued: false } : item));
        const { post, payload } = messageSendPayload({ conversationId, senderId: user.id, handle, body: row.body, attachment });
        const bytes = await photoBytes(attachment);
        if (!current()) return;
        const clientMessageId = retainedMessageSendKey(unsentKey.current, payload, bytes) ?? newMessageClientId();
        unsentKey.current = { key: clientMessageId, payload, photo: bytes };
        if (photos.length) rememberMessagePhotos(owner, {
          photos: photos.slice(index).map(({ file, width, height }) => ({ file, width, height })), body: row.body, attempt: unsentKey.current,
          failure: null,
        }, signal);
        const keyedPost = { ...post, clientMessageId };
        const response = await postMessage(`/api/messages/${encodeURIComponent(conversationId)}`, keyedPost, attachment, signal);
        if (!current()) { discardBody(response); return; }
        if (response.status === 401) { discardBody(response); takeBack(); onSignedOut(); return; }
        const result: unknown = await response.json().catch(() => null);
        if (!current()) return;
        if (!response.ok) {
          takeBack();
          if (!fromRefusal(result)) setError(offlineOrMessage(errorMessageFrom(result, attachment ? MESSAGE_PHOTO_FAILED_LINE : "Could not send that message. Try again.")));
          return;
        }
        const stored = (result as { message?: MessageDTO } | null)?.message;
        if (stored && typeof stored.id === "string") acknowledge(stored, attachment, handle);
        else await refresh();
        if (!current()) return;
        setOutbox(value => value.filter(item => item.id !== row.id));
        unsentKey.current = null;
        if (photos.length) rememberMessagePhotos(owner, {
          photos: photos.slice(index + 1).map(({ file, width, height }) => ({ file, width, height })), body: "", attempt: null,
          failure: null,
        }, signal);
      }
    } catch {
      takeBack();
      if (current()) setError(offlineOrMessage(pending ? MESSAGE_PHOTO_FAILED_LINE : "Could not send that message. Try again."));
    } finally {
      if (revision === scope.current) { inFlight.current = false; dispatch({ type: "finish", scope: owner }); }
    }
  }, [conversationId, authHandle, draft, pending, preparing, user, refresh, acknowledge, onSignedOut, fromRefusal, owner, setError]);

  const releaseSentPhoto = useCallback((id: string, previewUrl?: string) => {
    setSentPhotos(value => {
      if (!value[id] || value[id].photo.previewUrl !== previewUrl) return value;
      const next = { ...value };
      delete next[id];
      return next;
    });
  }, []);

  return { sentPhotos, releaseSentPhoto, draft, setDraft, pending, setPending: chooseAttachment, outbox, sending, preparing, preparationProgress, error, retrySend, selectPhotos, clearPending, cancelPreparation, abandon, send };
}
