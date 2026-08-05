"use client";

import { useEffect, useRef, useState } from "react";

import { NIGHT_AREAS } from "@/lib/nightAreas";
import { readSocialDraftPhoto, saveSocialDraftPhoto } from "@/lib/socialComposerDrafts";

const DRAFT_KEY = "pubmaxx:social-composer:v1";

type VenueChoice = { id: string; name: string; borough: string };
type Draft = { body: string; altText: string; area: string; venueId: string | null; venueName: string; visibility: "friends" | "public"; kind: "standard" | "feature_request"; hashtags: string; tagHandles: string };
const EMPTY: Draft = { body: "", altText: "", area: "", venueId: null, venueName: "", visibility: "friends", kind: "standard", hashtags: "", tagHandles: "" };

export default function SocialComposer({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [venueResults, setVenueResults] = useState<VenueChoice[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setDraft({ ...EMPTY, ...JSON.parse(saved) as Partial<Draft> });
    } catch { /* Invalid local draft is ignored. */ }
    void readSocialDraftPhoto(DRAFT_KEY).then(setPhoto).catch(() => undefined);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)), 300);
    return () => window.clearTimeout(timer);
  }, [draft]);
  useEffect(() => { void saveSocialDraftPhoto(DRAFT_KEY, photo).catch(() => undefined); }, [photo]);
  useEffect(() => { if (open) bodyRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open || draft.venueName.trim().length < 2 || draft.venueId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => fetch(`/api/social/venues?q=${encodeURIComponent(draft.venueName)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : { venues: [] })
      .then((result: { venues?: VenueChoice[] }) => setVenueResults(result.venues ?? [])).catch(() => undefined), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft.venueId, draft.venueName, open]);

  async function submit() {
    setBusy(true); setError(null);
    const hashtags = draft.hashtags.split(/[\s,]+/).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean);
    const post = {
      kind: draft.kind,
      visibility: draft.visibility,
      body: draft.body,
      area: draft.area || null,
      venueId: draft.venueId,
      hashtags,
      commentPolicy: "everyone",
      ...(photo ? { photoAltText: draft.altText, tagHandles: draft.tagHandles.split(/[\s,]+/).filter(Boolean) } : {}),
    };
    const body: BodyInit = photo ? (() => { const form = new FormData(); form.set("post", JSON.stringify(post)); form.set("photo", photo); return form; })() : JSON.stringify(post);
    try {
      const response = await fetch("/api/social/posts", { method: "POST", credentials: "same-origin", headers: photo ? undefined : { "Content-Type": "application/json" }, body });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Post was not saved.");
      localStorage.removeItem(DRAFT_KEY); void saveSocialDraftPhoto(DRAFT_KEY, null); setDraft(EMPTY); setPhoto(null); setOpen(false); onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Post was not saved."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <button className="socialButton socialComposeOpen" type="button" onClick={() => setOpen(true)}>New post</button>
      {open ? (
        <div className="socialComposerBackdrop" role="presentation">
          <section className="socialComposer" role="dialog" aria-modal="true" aria-labelledby="social-composer-title">
            <header><button type="button" onClick={() => setOpen(false)}>Cancel</button><h2 id="social-composer-title">New post</h2><button type="button" disabled={busy || (!draft.body.trim() && !photo) || Boolean(photo && !draft.altText.trim())} onClick={() => void submit()}>{busy ? "Posting…" : "Post"}</button></header>
            <textarea ref={bodyRef} aria-label="Post" maxLength={1000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.currentTarget.value })} />
            <label>Photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)} /></label>
            {photo ? <label>Photo description<input required maxLength={300} value={draft.altText} onChange={(event) => setDraft({ ...draft, altText: event.currentTarget.value })} /></label> : null}
            <label>Area<select value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.currentTarget.value })}><option value="">None</option>{NIGHT_AREAS.map((area) => <option key={area.slug} value={area.slug}>{area.name}</option>)}</select></label>
            <label>Venue - Friends only<input value={draft.venueName} onChange={(event) => setDraft({ ...draft, venueName: event.currentTarget.value, venueId: null })} /></label>
            {venueResults.length > 0 && !draft.venueId ? <ul className="socialVenueResults">{venueResults.map((venue) => <li key={venue.id}><button type="button" onClick={() => { setDraft({ ...draft, venueId: venue.id, venueName: venue.name }); setVenueResults([]); }}>{venue.name}, {venue.borough}</button></li>)}</ul> : null}
            <label>Hashtags<input value={draft.hashtags} onChange={(event) => setDraft({ ...draft, hashtags: event.currentTarget.value })} /></label>
            {photo ? <label>Photo tags<input value={draft.tagHandles} onChange={(event) => setDraft({ ...draft, tagHandles: event.currentTarget.value })} /></label> : null}
            <label>Visibility<select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.currentTarget.value as Draft["visibility"] })}><option value="friends">Friends</option><option value="public">Public</option></select></label>
            <label>Post type<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value as Draft["kind"] })}><option value="standard">Post</option><option value="feature_request">Feature request</option></select></label>
            {error ? <p role="alert">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
