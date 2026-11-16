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
  form.append("photo", attachment.file);
  return form;
}

export function useMessageComposer(options: Options) {
  const { conversationId, accountRevision, user, authHandle, refresh, onStored, onSignedOut, fromRefusal } = options;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessageAttachment | null>(null);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const owner = `${conversationId}:${accountRevision}`;
  const [activity, dispatch] = useReducer(transitionComposerActivity, { phase: "ready", scope: owner } as ComposerActivity);
  const sending = activity.phase === "sending";
  const preparing = activity.phase === "preparing";
  const error = activity.phase === "failed" ? activity.message : "";
  const setError = useCallback((message: string) => dispatch(message ? { type: "fail", scope: owner, message } : { type: "clear-error", scope: owner }), [owner]);
  const inFlight = useRef(false);
  const unsentKey = useRef<MessageSendAttempt | null>(null);
  const scope = useRef(0);
  const pick = useRef(0);
  const ownedUrls = useRef(new Set<string>());
  const [renderedOwner, setRenderedOwner] = useState(owner);
  if (renderedOwner !== owner) {
    setRenderedOwner(owner);
    setDraft(""); setPending(null); setOutbox([]); dispatch({ type: "reset", scope: owner });
  }

  useLayoutEffect(() => {
    const urls = ownedUrls.current;
    scope.current += 1;
    pick.current += 1;
    inFlight.current = false;
    unsentKey.current = null;
    return () => {
      scope.current += 1;
      pick.current += 1;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [conversationId, accountRevision]);

  useEffect(() => {
    const live = new Set([...messagePhotos(pending).map(photo => photo.previewUrl), ...outbox.flatMap(row => row.pendingPhoto ? [row.pendingPhoto.previewUrl] : [])]);
    for (const url of ownedUrls.current) {
      if (live.has(url)) continue;
      URL.revokeObjectURL(url);
      ownedUrls.current.delete(url);
    }
  }, [pending, outbox]);

  const clearPending = useCallback(() => { pick.current += 1; dispatch({ type: "finish", scope: owner }); setPending(null); }, [owner]);

  const selectPhotos = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || inFlight.current) return;
    const selection = ++pick.current;
    const revision = scope.current;
    const signal = readProviderAccountSignal();
    const photos: MessagePhotoDraft[] = [];
    dispatch({ type: "prepare", scope: owner }); setError("");
    try {
      for (const file of files) {
        const prepared = await preparePhotoUpload(file);
        if (revision !== scope.current || selection !== pick.current || signal.aborted) return;
        photos.push({ ...prepared, previewUrl: URL.createObjectURL(prepared.file) });
      }
      const first = photos[0];
      if (first) {
        for (const photo of photos) ownedUrls.current.add(photo.previewUrl);
        setPending({ kind: "photo", ...first, remaining: photos.slice(1) });
      }
    } catch (cause) {
      if (revision === scope.current && selection === pick.current && !signal.aborted) setError(cause instanceof Error ? cause.message : "Could not prepare that photo. Try another one.");
    } finally {
      const committed = photos.length === files.length && revision === scope.current && selection === pick.current && !signal.aborted;
      if (!committed) for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
      if (revision === scope.current && selection === pick.current) dispatch({ type: "finish", scope: owner });
    }
  }, [owner, setError]);

  const send = useCallback(async () => {
    const handle = normalizeHandle(authHandle ?? "");
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
        const bytes = attachment?.kind === "photo" ? new Uint8Array(await attachment.file.arrayBuffer()) : null;
        if (!current()) return;
        const clientMessageId = retainedMessageSendKey(unsentKey.current, payload, bytes) ?? newMessageClientId();
        unsentKey.current = { key: clientMessageId, payload, photo: bytes };
        const keyedPost = { ...post, clientMessageId };
        const body = sendBody(keyedPost, attachment);
        const response = await authedActionFetch(`/api/messages/${encodeURIComponent(conversationId)}`, {
          method: "POST", body, signal,
          ...(typeof body === "string" ? { headers: { "content-type": "application/json" } } : {}),
        }, { requiresIdentity: true });
        if (!current()) { discardBody(response); return; }
        if (response.status === 401) { discardBody(response); takeBack(); onSignedOut(); return; }
        if (response.status === 429) { discardBody(response); takeBack(); setError("Too many messages, slow down."); return; }
        const result: unknown = await response.json().catch(() => null);
        if (!current()) return;
        if (!response.ok) {
          takeBack();
          if (!fromRefusal(result)) setError(offlineOrMessage(errorMessageFrom(result, attachment ? MESSAGE_PHOTO_FAILED_LINE : "Could not send that message. Try again.")));
          return;
        }
        const stored = (result as { message?: MessageDTO } | null)?.message;
        if (stored && typeof stored.id === "string") onStored(stored);
        else await refresh();
        if (!current()) return;
        setOutbox(value => value.filter(item => item.id !== row.id));
        unsentKey.current = null;
      }
    } catch {
      takeBack();
      if (current()) setError(offlineOrMessage(pending ? MESSAGE_PHOTO_FAILED_LINE : "Could not send that message. Try again."));
    } finally {
      if (revision === scope.current) { inFlight.current = false; dispatch({ type: "finish", scope: owner }); }
    }
  }, [conversationId, authHandle, draft, pending, preparing, user, refresh, onStored, onSignedOut, fromRefusal, owner, setError]);

  return { draft, setDraft, pending, setPending, outbox, sending, preparing, error, setError, selectPhotos, clearPending, send };
}
