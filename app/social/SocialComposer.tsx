"use client";

import { useEffect, useRef, useState } from "react";

import { NIGHT_AREAS } from "@/lib/nightAreas";
import { readSocialDraftPhoto, saveSocialDraftPhoto } from "@/lib/socialComposerDrafts";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

type VenueChoice = { id: string; name: string; borough: string };
type Draft = { requestKey: string; body: string; altText: string; area: string; venueId: string | null; venueName: string; visibility: "friends" | "public"; kind: "standard" | "feature_request"; hashtags: string; tagHandles: string };

function initialDraft(post?: SocialPostDTO): Draft {
  return {
    requestKey: globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    body: post?.body ?? "", altText: post?.photo?.altText ?? "", area: post?.area ?? "",
    venueId: post?.venueId ?? null, venueName: "", visibility: post?.visibility === "public" ? "public" : "friends",
    kind: post?.kind ?? "standard", hashtags: post?.hashtags.join(" ") ?? "", tagHandles: "",
  };
}

export default function SocialComposer({ post, draftScope, onSaved }: { post?: SocialPostDTO; draftScope: string; onSaved: (post?: SocialPostDTO) => void }) {
  const editing = Boolean(post);
  const draftKey = `pubmaxx:social-composer:v1:${draftScope}:${post?.id ?? "new"}`;
  const initialPostRef = useRef(post);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => initialDraft(post));
  const [photo, setPhoto] = useState<File | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [revision, setRevision] = useState(post?.revision ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [concurrent, setConcurrent] = useState(false);
  const [venueResults, setVenueResults] = useState<VenueChoice[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeComposer() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useDismissOnEscape(open, closeComposer);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      let nextDraft = initialDraft(initialPostRef.current);
      try { const saved = localStorage.getItem(draftKey); if (saved) nextDraft = { ...nextDraft, ...JSON.parse(saved) as Partial<Draft> }; } catch { /* Ignore invalid local draft. */ }
      const savedPhoto = await readSocialDraftPhoto(draftKey).catch(() => null);
      if (!active) return;
      setDraft(nextDraft);
      setPhoto(savedPhoto);
      setDraftReady(true);
    };
    void restore();
    return () => { active = false; };
  }, [draftKey]);
  useEffect(() => { if (!draftReady) return; const timer = window.setTimeout(() => localStorage.setItem(draftKey, JSON.stringify(draft)), 300); return () => window.clearTimeout(timer); }, [draft, draftKey, draftReady]);
  useEffect(() => { if (draftReady) void saveSocialDraftPhoto(draftKey, photo).catch(() => undefined); }, [draftKey, draftReady, photo]);
  useEffect(() => { if (open) bodyRef.current?.focus(); }, [open]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((control) => !control.hasAttribute("hidden"));
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", keepFocusInside);
    return () => dialog.removeEventListener("keydown", keepFocusInside);
  }, [open]);
  useEffect(() => {
    if (!open || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`pubmaxx-social-draft-${draftScope}`);
    channel.onmessage = (event: MessageEvent<{ key?: string }>) => {
      if (event.data?.key === draftKey) setConcurrent(true);
    };
    channel.postMessage({ key: draftKey });
    return () => channel.close();
  }, [draftKey, draftScope, open]);
  useEffect(() => {
    if (!open || draft.venueName.trim().length < 2 || draft.venueId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => fetch(`/api/social/venues?q=${encodeURIComponent(draft.venueName)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : { venues: [] })
      .then((result: { venues?: VenueChoice[] }) => setVenueResults(result.venues ?? [])).catch(() => undefined), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft.venueId, draft.venueName, open]);

  async function loadLatest() {
    if (!post) return;
    const response = await fetch(`/api/social/posts/${post.id}`, { cache: "no-store" });
    const value = await response.json() as { post?: SocialPostDTO };
    if (response.ok && value.post) { setRevision(value.post.revision); setConflict(false); setError("Latest revision loaded. Your draft is unchanged."); }
  }

  async function submit() {
    setBusy(true); setError(null); setConflict(false);
    const hashtags = draft.hashtags.split(/[\s,]+/).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean);
    const payload = {
      ...(editing ? { expectedRevision: revision } : {}), kind: draft.kind, visibility: draft.visibility,
      body: draft.body, area: draft.area || null, venueId: draft.venueId, hashtags, commentPolicy: "open",
      ...(photo || (editing && post?.photo && !removePhoto) ? { photoAltText: draft.altText } : {}),
      ...(photo ? { tagHandles: draft.tagHandles.split(/[\s,]+/).filter(Boolean) } : {}),
      ...(editing && removePhoto && !photo ? { removePhoto: true } : {}),
    };
    const requestBody: BodyInit = photo ? (() => { const form = new FormData(); form.set("post", JSON.stringify(payload)); form.set("photo", photo); return form; })() : JSON.stringify(payload);
    try {
      const response = await fetch(editing ? `/api/social/posts/${post!.id}` : "/api/social/posts", {
        method: editing ? "PATCH" : "POST", credentials: "same-origin",
        headers: photo
          ? { "Idempotency-Key": draft.requestKey }
          : { "Content-Type": "application/json", "Idempotency-Key": draft.requestKey },
        body: requestBody,
      });
      const result = await response.json() as { error?: string; post?: SocialPostDTO };
      if (!response.ok) {
        if (response.status === 409) { setConflict(true); throw new Error("Post changed. Your draft is still here."); }
        throw new Error(result.error ?? "Post was not saved.");
      }
      localStorage.removeItem(draftKey); void saveSocialDraftPhoto(draftKey, null);
      const savedPost = editing ? result.post ?? post : undefined;
      initialPostRef.current = savedPost;
      setDraft(initialDraft(savedPost));
      if (savedPost) setRevision(savedPost.revision);
      setPhoto(null); setRemovePhoto(false); closeComposer(); onSaved(result.post);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Post was not saved."); }
    finally { setBusy(false); }
  }

  const attachedPhoto = Boolean(photo || (post?.photo && !removePhoto));
  return <>
    <button ref={triggerRef} className={editing ? "socialEditButton" : "socialButton socialComposeOpen"} type="button" disabled={!draftReady} onClick={() => setOpen(true)}>{editing ? "Edit post" : "New post"}</button>
    {open ? <div className="socialComposerBackdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeComposer(); }}><section ref={dialogRef} className="socialComposer" role="dialog" aria-modal="true" aria-labelledby={`social-composer-title-${post?.id ?? "new"}`}>
      <header><button type="button" onClick={closeComposer}>Cancel</button><h2 id={`social-composer-title-${post?.id ?? "new"}`}>{editing ? "Edit post" : "New post"}</h2><button type="button" disabled={busy || (!draft.body.trim() && !attachedPhoto) || Boolean(attachedPhoto && !draft.altText.trim())} onClick={() => void submit()}>{busy ? "Saving…" : editing ? "Save" : "Post"}</button></header>
      <textarea ref={bodyRef} aria-label="Post" maxLength={2000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.currentTarget.value })} />
      <label className="socialPhotoPicker"><span>{photo ? photo.name : post?.photo && !removePhoto ? "Replace photo" : "Add photo"}</span><input aria-label="Photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setPhoto(event.currentTarget.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
      {post?.photo && !photo ? <button type="button" className="socialRemovePhoto" onClick={() => setRemovePhoto((value) => !value)}>{removePhoto ? "Keep photo" : "Remove photo"}</button> : null}
      {attachedPhoto ? <label>Photo description<input required maxLength={300} value={draft.altText} onChange={(event) => setDraft({ ...draft, altText: event.currentTarget.value })} /></label> : null}
      <label>Area<select value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.currentTarget.value })}><option value="">None</option>{NIGHT_AREAS.map((area) => <option key={area.slug} value={area.slug}>{area.name}</option>)}</select></label>
      {draft.venueId ? <div className="socialSelectedVenue" aria-label="Selected Venue"><span>{draft.venueName || "Venue selected"}</span><button type="button" onClick={() => setDraft({ ...draft, venueId: null, venueName: "" })}>Remove venue</button></div> : <label>Venue - Friends only<input value={draft.venueName} onChange={(event) => setDraft({ ...draft, venueName: event.currentTarget.value, venueId: null })} /></label>}
      {venueResults.length > 0 && !draft.venueId ? <ul className="socialVenueResults">{venueResults.map((venue) => <li key={venue.id}><button type="button" onClick={() => { setDraft({ ...draft, venueId: venue.id, venueName: venue.name }); setVenueResults([]); }}>{venue.name}, {venue.borough}</button></li>)}</ul> : null}
      <label>Hashtags<input value={draft.hashtags} onChange={(event) => setDraft({ ...draft, hashtags: event.currentTarget.value })} /></label>
      {photo ? <label>Photo tags<input value={draft.tagHandles} onChange={(event) => setDraft({ ...draft, tagHandles: event.currentTarget.value })} /></label> : null}
      <label>Visibility<select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.currentTarget.value as Draft["visibility"] })}><option value="friends">Friends</option><option value="public">Public</option></select></label>
      <label>Post type<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value as Draft["kind"] })}><option value="standard">Post</option><option value="feature_request">Feature request</option></select></label>
      {error ? <p role="alert">{error}</p> : null}{conflict ? <button type="button" onClick={() => void loadLatest()}>Load latest</button> : null}
      {concurrent ? <p role="status">This draft is open in another tab.</p> : null}
    </section></div> : null}
  </>;
}
