"use client";

import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { nightAreasByCity } from "@/lib/nightAreas";
import { getCity } from "@/lib/cities";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch, authedActionJson } from "@/lib/authedFetch";
import { readSocialDraftPhoto, saveSocialDraftPhoto } from "@/lib/socialComposerDrafts";
import {
  HIDDEN_NAME_OWN_LINE,
  HIDDEN_NAME_TOGGLE_HINT,
  HIDDEN_NAME_TOGGLE_LABEL,
} from "@/lib/socialHiddenName";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { SOCIAL_REVIEW_MAX, SOCIAL_REVIEW_MIN, SOCIAL_REVIEW_STEP } from "@/lib/socialPostReviews";
import {
  formatSocialVideoDuration,
  isSocialVideoType,
  SOCIAL_VIDEO_MAX_BYTES,
  SOCIAL_VIDEO_MAX_SECONDS,
  SOCIAL_VIDEO_TYPES,
} from "@/lib/socialPostVideos";
import ExtraPhotosEditor, { type ExtraPhotoDraft, uploadExtraPhotos } from "@/components/social/ExtraPhotosEditor";
import ReviewStars from "@/components/social/ReviewStars";

type VenueChoice = { id: string; name: string; borough: string };
type Draft = {
  requestKey: string;
  body: string;
  altText: string;
  area: string;
  venueId: string | null;
  venueName: string;
  visibility: SocialPostDTO["visibility"];
  kind: SocialPostDTO["kind"];
  hashtags: string;
  tagHandles: string;
  /** The author's own score for the picked pub. Absent on drafts saved before scores. */
  rating?: number | null;
  /** Readers see "a PUBMAXXER". New posts only; absent on older drafts. */
  nameHidden?: boolean;
};
type DraftChannelMessage = {
  key?: string;
  type?: "hello" | "present";
};

function isAbortError(cause: unknown): boolean {
  return typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    cause.name === "AbortError";
}

function initialDraft(post?: SocialPostDTO): Draft {
  return {
    requestKey:
      globalThis.crypto?.randomUUID?.() ??
      `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    body: post?.body ?? "",
    altText: post?.photo?.altText ?? "",
    area: post?.area ?? "",
    venueId: post?.venueId ?? null,
    venueName: post?.venueName ?? "",
    visibility: post?.visibility ?? "friends",
    kind: post?.kind ?? "standard",
    hashtags: post?.hashtags.join(" ") ?? "",
    tagHandles: "",
    rating: null,
    nameHidden: false,
  };
}

function draftHasChanges(
  draft: Draft,
  post: SocialPostDTO | undefined,
  photo: File | null,
  removePhoto: boolean,
): boolean {
  return Boolean(
    photo ||
      removePhoto ||
      draft.body !== (post?.body ?? "") ||
      draft.altText !== (post?.photo?.altText ?? "") ||
      draft.area !== (post?.area ?? "") ||
      draft.venueId !== (post?.venueId ?? null) ||
      draft.venueName !== (post?.venueName ?? "") ||
      draft.visibility !== (post?.visibility ?? "friends") ||
      draft.kind !== (post?.kind ?? "standard") ||
      draft.hashtags !== (post?.hashtags.join(" ") ?? "") ||
      draft.tagHandles !== "" ||
      (draft.rating ?? null) !== null ||
      draft.nameHidden === true
  );
}

function PhotoEditor({
  post,
  draft,
  photo,
  previewSource,
  removePhoto,
  fileInputRef,
  onDraft,
  onPhoto,
  onClearSelected,
  onToggleExisting,
}: {
  post?: SocialPostDTO;
  draft: Draft;
  photo: File | null;
  previewSource: string | null;
  removePhoto: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDraft: (draft: Draft) => void;
  onPhoto: (photo: File | null) => void;
  onClearSelected: () => void;
  onToggleExisting: () => void;
}) {
  const attachedPhoto = Boolean(photo || (post?.photo && !removePhoto));
  return (
    <>
      <label className="socialPhotoPicker">
        <span className="socialPhotoCue" aria-hidden="true">+</span>
        <span>{photo ? photo.name : post?.photo && !removePhoto ? "Replace photo" : "Add photo"}</span>
        <input ref={fileInputRef} aria-label="Add photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onPhoto(event.currentTarget.files?.[0] ?? null)} />
      </label>
      {previewSource ? (
        <figure className="socialComposerPhotoPreview">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL or private signed delivery route. */}
          <img src={previewSource} alt={photo ? "Selected photo preview" : draft.altText} />
        </figure>
      ) : null}
      {photo ? (
        <button type="button" className="socialRemovePhoto" onClick={onClearSelected}>Remove selected photo</button>
      ) : post?.photo ? (
        <button type="button" className="socialRemovePhoto" onClick={onToggleExisting}>{removePhoto ? "Keep photo" : "Remove photo"}</button>
      ) : null}
      {attachedPhoto ? (
        <label>Photo description<input required maxLength={300} value={draft.altText} onChange={(event) => onDraft({ ...draft, altText: event.currentTarget.value })} /></label>
      ) : null}
    </>
  );
}

function VenueEditor({
  draft,
  results,
  activeIndex,
  listId,
  announcement,
  onDraft,
  onActiveIndex,
  onClearResults,
  onSelect,
}: {
  draft: Draft;
  results: VenueChoice[];
  activeIndex: number;
  listId: string;
  announcement: string;
  onDraft: (draft: Draft) => void;
  onActiveIndex: (index: number | ((current: number) => number)) => void;
  onClearResults: () => void;
  onSelect: (venue: VenueChoice) => void;
}) {
  return (
    <>
      {draft.venueId ? (
        <div className="socialSelectedVenue" aria-label="Selected venue">
          <span>{draft.venueName}</span>
          <button type="button" onClick={() => onDraft({ ...draft, venueId: null, venueName: "" })}>Remove venue</button>
        </div>
      ) : (
        <label>
          Venue, friends only
          <input
            role="combobox" aria-autocomplete="list" aria-expanded={results.length > 0}
            aria-controls={listId} aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
            value={draft.venueName}
            onChange={(event) => {
              const venueName = event.currentTarget.value;
              if (venueName.trim().length < 2) onClearResults();
              onDraft({ ...draft, venueName, venueId: null });
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault(); onActiveIndex((current) => Math.min(current + 1, results.length - 1));
              } else if (event.key === "ArrowUp" && results.length > 0) {
                event.preventDefault(); onActiveIndex((current) => current <= 0 ? results.length - 1 : current - 1);
              } else if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault(); onSelect(results[activeIndex]);
              } else if (event.key === "Escape" && results.length > 0) {
                event.preventDefault(); event.stopPropagation(); onClearResults();
              }
            }}
          />
        </label>
      )}
      <p className="srOnly" role="status" aria-live="polite">{announcement}</p>
      {results.length > 0 && !draft.venueId ? (
        <ul id={listId} className="socialVenueResults" role="listbox" aria-label="Venue results">
          {results.map((venue, index) => (
            <li key={venue.id} role="presentation"><button id={`${listId}-option-${index}`} type="button" role="option" aria-selected={activeIndex === index} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(venue)}>{venue.name}, {venue.borough}</button></li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * Score the pub the post names, the way a review app asks: one slider in half
 * stars, and a way back to no score. It is the author's own score and nothing
 * adds it to anybody else's.
 */
function ReviewEditor({ draft, onDraft }: { draft: Draft; onDraft: (draft: Draft) => void }) {
  const rating = draft.rating ?? null;
  const inputId = useId();
  return (
    <div className="socialReviewEditor">
      <div className="socialReviewEditor__head">
        <label htmlFor={inputId}>Score {draft.venueName || "this pub"}</label>
        {rating !== null ? (
          <button type="button" className="socialReviewEditor__clear" onClick={() => onDraft({ ...draft, rating: null })}>
            No score
          </button>
        ) : null}
      </div>
      <div className="socialReviewEditor__row">
        <input
          id={inputId}
          type="range"
          min={SOCIAL_REVIEW_MIN}
          max={SOCIAL_REVIEW_MAX}
          step={SOCIAL_REVIEW_STEP}
          value={rating ?? 3}
          aria-valuetext={rating === null ? "No score yet" : `${rating} out of 5`}
          data-unscored={rating === null ? "true" : undefined}
          onChange={(event) => onDraft({ ...draft, rating: Number(event.currentTarget.value) })}
          onPointerUp={(event) => { if (rating === null) onDraft({ ...draft, rating: Number(event.currentTarget.value) }); }}
        />
        {rating !== null
          ? <ReviewStars rating={rating} size={20} />
          : <span className="socialReviewEditor__hint">Slide to score</span>}
      </div>
    </div>
  );
}

/**
 * One video in place of a photo: a reel, up to ten minutes and 100 MB. It is
 * shown to its author at once and to everybody else once a person has watched
 * it, which the hint says before anybody uploads.
 */
function VideoEditor({
  video,
  previewUrl,
  duration,
  onVideo,
  onDuration,
}: {
  video: File | null;
  previewUrl: string | null;
  duration: number | null;
  onVideo: (video: File | null) => void;
  onDuration: (seconds: number | null) => void;
}) {
  const hintId = useId();
  return (
    <>
      <label className="socialPhotoPicker">
        <span className="socialPhotoCue" aria-hidden="true">+</span>
        <span>{video ? video.name : "Add video"}</span>
        <input
          aria-label="Add video"
          aria-describedby={hintId}
          type="file"
          accept={SOCIAL_VIDEO_TYPES.join(",")}
          onChange={(event) => onVideo(event.currentTarget.files?.[0] ?? null)}
        />
      </label>
      <p id={hintId} className="socialVideoHint">
        Up to 10 minutes. You see it straight away; your lot sees it once we have watched it.
      </p>
      {previewUrl ? (
        <figure className="socialComposerVideoPreview">
          <video
            src={previewUrl}
            muted
            playsInline
            controls
            preload="metadata"
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration;
              onDuration(Number.isFinite(seconds) ? seconds : null);
            }}
          />
          {duration !== null ? <figcaption>{formatSocialVideoDuration(duration)}</figcaption> : null}
        </figure>
      ) : null}
      {video ? (
        <button type="button" className="socialRemovePhoto" onClick={() => onVideo(null)}>Remove video</button>
      ) : null}
    </>
  );
}

/** Opens the intent, then PUTs the file where it says: Storage, or our own door when keyless. */
async function uploadSocialVideo(video: File): Promise<string> {
  const { response, body } = await authedActionJson<{ upload?: { uploadId: string; uploadUrl: string }; error?: string }>(
    "/api/social/videos/uploads",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: video.type, byteSize: video.size }),
    },
    { requiresIdentity: true },
  );
  if (!response.ok || !body.upload) throw new Error(errorMessageFrom(body, "That video could not start uploading."));
  const { uploadId, uploadUrl } = body.upload;
  const sameOrigin = uploadUrl.startsWith("/");
  const put = sameOrigin
    ? await authedActionFetch(uploadUrl, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": video.type }, body: video }, { requiresIdentity: true })
    : await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": video.type }, body: video });
  if (!put.ok) throw new Error("That video did not finish uploading. Try again.");
  return uploadId;
}

/** The video checks a browser can make, then the upload itself. */
async function prepareVideo(
  video: File,
  duration: number | null,
  caption: string,
): Promise<{ uploadId: string } | { error: string }> {
  if (duration !== null && duration > SOCIAL_VIDEO_MAX_SECONDS) return { error: "Videos can be up to 10 minutes. Trim it and try again." };
  if (!caption.trim()) return { error: "Add a caption to your video." };
  try {
    return { uploadId: await uploadSocialVideo(video) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "That video did not finish uploading. Try again." };
  }
}

/**
 * Everything a new post's media must clear before the post is sent: every
 * extra photo described, and a video uploaded to Storage first.
 */
async function prepareNewPostMedia(input: {
  editing: boolean;
  photo: File | null;
  extraPhotos: ExtraPhotoDraft[];
  video: File | null;
  videoDuration: number | null;
  caption: string;
  onUploading: () => void;
}): Promise<{ videoUploadId: string | null } | { error: string }> {
  if (input.photo && input.extraPhotos.some((extra) => !extra.altText.trim())) {
    return { error: "Describe every photo before you post." };
  }
  if (!input.video || input.editing) return { videoUploadId: null };
  input.onUploading();
  const uploaded = await prepareVideo(input.video, input.videoDuration, input.caption);
  return "error" in uploaded ? uploaded : { videoUploadId: uploaded.uploadId };
}

/** Only a new post with a first photo sends photos 2 to 4. */
function newPostPhotoDrafts(editing: boolean, photo: File | null, drafts: ExtraPhotoDraft[]): ExtraPhotoDraft[] {
  return !editing && photo ? drafts : [];
}

/** Photos 2 to 4 go up after the post exists, one request each. */
async function withExtraPhotos(
  post: SocialPostDTO | undefined,
  drafts: ExtraPhotoDraft[],
): Promise<{ post: SocialPostDTO | undefined; notice: string | null }> {
  if (!post || drafts.length === 0) return { post, notice: null };
  const { uploaded, failed } = await uploadExtraPhotos(post.id, drafts);
  return {
    post: uploaded.length > 0 ? { ...post, extraPhotos: uploaded } : post,
    notice: failed === 0 ? null : `Your post is up, but ${failed === 1 ? "one photo" : `${failed} photos`} did not upload.`,
  };
}

/** What only a new post carries: the pub's score, the uploaded video and a hidden name. */
function newPostExtras(draft: Draft, videoUploadId: string | null, videoDuration: number | null): Record<string, unknown> {
  return {
    ...(draft.nameHidden === true ? { nameHidden: true } : {}),
    ...(draft.venueId && draft.kind === "standard" && typeof draft.rating === "number" ? { reviewRating: draft.rating } : {}),
    ...(videoUploadId ? { videoUploadId } : {}),
    ...(videoUploadId && videoDuration !== null ? { videoDurationSeconds: Math.round(videoDuration * 100) / 100 } : {}),
  };
}

/** Photo or video, never both: picking one puts the other's picker away. */
function MediaEditors({
  editing, photoEditor, video, videoPreviewUrl, videoDuration, hasPhoto, onVideo, onDuration, extraPhotos, onExtraPhotos,
}: {
  editing: boolean;
  photoEditor: ReactNode;
  extraPhotos: ExtraPhotoDraft[];
  onExtraPhotos: (drafts: ExtraPhotoDraft[]) => void;
  video: File | null;
  videoPreviewUrl: string | null;
  videoDuration: number | null;
  hasPhoto: boolean;
  onVideo: (video: File | null) => void;
  onDuration: (seconds: number | null) => void;
}) {
  return (
    <>
      {video ? null : photoEditor}
      {!editing && hasPhoto ? <ExtraPhotosEditor drafts={extraPhotos} onChange={onExtraPhotos} /> : null}
      {!editing && !hasPhoto ? (
        <VideoEditor video={video} previewUrl={videoPreviewUrl} duration={videoDuration} onVideo={onVideo} onDuration={onDuration} />
      ) : null}
    </>
  );
}

/**
 * Hiding the name is chosen once, on a new post. Turning it on makes the post
 * public and takes off the pub, its score and any photo tags, because each of
 * those would name the author (`lib/socialHiddenName.ts`).
 */
function HiddenNameField({ draft, onDraft }: { draft: Draft; onDraft: (draft: Draft) => void }) {
  const hintId = useId();
  return (
    <div className="socialHiddenName">
      <label>
        <input
          type="checkbox"
          checked={draft.nameHidden === true}
          aria-describedby={hintId}
          onChange={(event) => {
            const nameHidden = event.currentTarget.checked;
            onDraft(nameHidden
              ? { ...draft, nameHidden, visibility: "public", venueId: null, venueName: "", rating: null, tagHandles: "" }
              : { ...draft, nameHidden });
          }}
        />
        {HIDDEN_NAME_TOGGLE_LABEL}
      </label>
      <p id={hintId} className="socialHiddenName__hint">{HIDDEN_NAME_TOGGLE_HINT}</p>
    </div>
  );
}

/**
 * Who the post names: the hidden-name switch on a new post, then the pub and
 * its score, which a hidden-name post cannot carry.
 */
function PlaceFields({ editing, nameHidden, draft, onDraft, venueEditor }: {
  editing: boolean;
  nameHidden: boolean;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  venueEditor: ReactNode;
}) {
  return (
    <>
      {editing
        ? nameHidden ? <p className="socialHiddenName__hint">{HIDDEN_NAME_OWN_LINE}</p> : null
        : <HiddenNameField draft={draft} onDraft={onDraft} />}
      {nameHidden ? null : venueEditor}
      {!editing && !nameHidden && draft.venueId && draft.kind === "standard"
        ? <ReviewEditor draft={draft} onDraft={onDraft} />
        : null}
    </>
  );
}

function PolicyFields({ draft, hasPhoto, nameHidden, onDraft }: { draft: Draft; hasPhoto: boolean; nameHidden: boolean; onDraft: (draft: Draft) => void }) {
  return (
    <>
      <label>Hashtags<input value={draft.hashtags} onChange={(event) => onDraft({ ...draft, hashtags: event.currentTarget.value })} /></label>
      {hasPhoto && !nameHidden ? <label>Photo tags<input value={draft.tagHandles} onChange={(event) => onDraft({ ...draft, tagHandles: event.currentTarget.value })} /></label> : null}
      <label>Post type<select value={draft.kind} onChange={(event) => onDraft({ ...draft, kind: event.currentTarget.value as Draft["kind"] })}><option value="standard">Post</option><option value="feature_request">Feature request</option></select></label>
    </>
  );
}

function AudienceField({ draft, nameHidden, onDraft }: { draft: Draft; nameHidden: boolean; onDraft: (draft: Draft) => void }) {
  const hintId = useId();
  return (
    <div className="socialComposerAudience">
      <label>
        Visibility
        <select
          value={nameHidden ? "public" : draft.visibility}
          disabled={nameHidden}
          aria-describedby={hintId}
          onChange={(event) => onDraft({ ...draft, visibility: event.currentTarget.value as Draft["visibility"] })}
        >
          <option value="private">Private</option>
          <option value="friends">Friends</option>
          <option value="public">Public</option>
        </select>
      </label>
      <p id={hintId}>
        {nameHidden || draft.visibility === "public"
          ? "Anyone on Social can see this. Your exact pub stays between mutual friends."
          : draft.visibility === "friends"
            ? "Only people you follow who follow you back can see this."
            : "Only you can see this."}
      </p>
    </div>
  );
}

function PostPrompts({ editing, ready, body, onChoose }: { editing: boolean; ready: boolean; body: string; onChoose: (body: string) => void }) {
  if (editing || !ready || body) return null;
  return (
    <div className="socialComposerPrompts" aria-label="Post prompts">
      <span>Start with a thought</span>
      {["A pub worth sharing", "Who's about?"].map((prompt) => (
        <button key={prompt} type="button" onClick={() => onChoose(prompt === "Who's about?" ? "Who's about? " : `${prompt}: `)}>{prompt}</button>
      ))}
    </div>
  );
}

export default function SocialComposer({
  post,
  draftScope,
  onSaved,
  triggerLabel,
}: {
  post?: SocialPostDTO;
  draftScope: string;
  onSaved: (post?: SocialPostDTO) => void;
  triggerLabel?: string;
}) {
  const editing = Boolean(post);
  const draftKey = `pubmaxx:social-composer:v1:${draftScope}:${post?.id ?? "new"}`;
  const initialPostRef = useRef(post);
  const [basePost, setBasePost] = useState(post);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => initialDraft(post));
  // Chosen once, at posting: an edit reads it off the post and cannot move it.
  const nameHidden = editing ? post?.nameHidden === true : draft.nameHidden === true;
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [extraPhotos, setExtraPhotos] = useState<ExtraPhotoDraft[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  // The pending debounced write of the draft. Clear draft cancels it first,
  // or a write scheduled before the clear lands after it and restores the text.
  const draftSaveTimerRef = useRef<number | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [mutationVersion, setMutationVersion] = useState(post?.mutationVersion ?? 0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackIsStatus, setFeedbackIsStatus] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [concurrent, setConcurrent] = useState(false);
  const [venueResults, setVenueResults] = useState<VenueChoice[]>([]);
  const [activeVenueIndex, setActiveVenueIndex] = useState(-1);
  const [venueAnnouncement, setVenueAnnouncement] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const venueListId = useId();
  const composerId = `social-composer-title-${post?.id ?? "new"}`;

  function closeComposer() {
    setOpen(false);
  }

  function openComposer() {
    setConcurrent(false);
    setOpen(true);
  }

  function clearSelectedPhoto() {
    setPhoto(null);
    setRemovePhoto(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setDraft((current) => ({
      ...current,
      altText: basePost?.photo?.altText ?? "",
      tagHandles: "",
    }));
  }

  async function clearDraft() {
    if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = null;
    localStorage.removeItem(draftKey);
    await saveSocialDraftPhoto(draftKey, null).catch(() => undefined);
    setDraft(initialDraft(initialPostRef.current));
    setPhoto(null);
    setRemovePhoto(false);
    setFeedback(null);
    setConflict(false);
    setVenueResults([]);
    setVenueAnnouncement("Draft cleared.");
    if (fileInputRef.current) fileInputRef.current.value = "";
    bodyRef.current?.focus();
  }

  function selectVenue(venue: VenueChoice) {
    setDraft((current) => ({
      ...current,
      venueId: venue.id,
      venueName: venue.name,
    }));
    setVenueResults([]);
    setActiveVenueIndex(-1);
    setVenueAnnouncement(`${venue.name} selected.`);
  }

  useDismissOnEscape(open, closeComposer, dialogRef);
  useFocusTrap(open, dialogRef, "strict-modal", triggerRef);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      let nextDraft = initialDraft(initialPostRef.current);
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          // A draft saved before the Comments setting left the composer may
          // still carry its key. A post has no comments yet, so it is dropped.
          const restored = JSON.parse(saved) as Partial<Draft> & { commentPolicy?: unknown };
          delete restored.commentPolicy;
          nextDraft = { ...nextDraft, ...restored };
        }
      } catch {
        // Ignore invalid local draft.
      }
      const savedPhoto = await readSocialDraftPhoto(draftKey).catch(() => null);
      if (!active) return;
      setDraft(nextDraft);
      setPhoto(savedPhoto);
      setDraftReady(true);
    };
    void restore();
    return () => {
      active = false;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    const timer = window.setTimeout(() => {
      draftSaveTimerRef.current = null;
      localStorage.setItem(draftKey, JSON.stringify(draft));
    }, 300);
    draftSaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (draftSaveTimerRef.current === timer) draftSaveTimerRef.current = null;
    };
  }, [draft, draftKey, draftReady]);

  useEffect(() => {
    if (draftReady) {
      void saveSocialDraftPhoto(draftKey, photo).catch(() => undefined);
    }
  }, [draftKey, draftReady, photo]);

  useEffect(() => {
    const url = photo ? URL.createObjectURL(photo) : null;
    void Promise.resolve().then(() => setPhotoPreviewUrl(url));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo]);

  useEffect(() => {
    const url = video ? URL.createObjectURL(video) : null;
    void Promise.resolve().then(() => setVideoPreviewUrl(url));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [video]);

  function chooseVideo(next: File | null) {
    setVideoDuration(null);
    if (next && !isSocialVideoType(next.type)) {
      setFeedbackIsStatus(false);
      setFeedback("Choose an MP4, MOV or WebM video.");
      return;
    }
    if (next && next.size > SOCIAL_VIDEO_MAX_BYTES) {
      setFeedbackIsStatus(false);
      setFeedback("Videos can be up to 100 MB. Trim it and try again.");
      return;
    }
    setFeedback(null);
    setVideo(next);
  }

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    bodyRef.current?.focus();
    return () => {
      root.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!feedback || feedbackIsStatus) return;
    window.requestAnimationFrame(() => {
      feedbackRef.current?.focus();
      feedbackRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, [feedback, feedbackIsStatus]);

  useEffect(() => {
    if (!open || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`pubmaxx-social-draft-${draftScope}`);
    channel.onmessage = (event: MessageEvent<DraftChannelMessage>) => {
      if (event.data?.key !== draftKey) return;
      if (event.data.type === "hello") {
        setConcurrent(true);
        channel.postMessage({ key: draftKey, type: "present" });
      } else if (event.data.type === "present") {
        setConcurrent(true);
      }
    };
    channel.postMessage({ key: draftKey, type: "hello" });
    return () => channel.close();
  }, [draftKey, draftScope, open]);

  useEffect(() => {
    const query = draft.venueName.trim();
    if (!open || query.length < 2 || draft.venueId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/social/venues?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json() : { venues: [] }))
        .then((result: { venues?: VenueChoice[] }) => {
          const venues = result.venues ?? [];
          setVenueResults(venues);
          setActiveVenueIndex(-1);
          setVenueAnnouncement(
            `${venues.length} venue${venues.length === 1 ? "" : "s"} found.`,
          );
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.venueId, draft.venueName, open]);

  async function loadLatest() {
    if (!post) return;
    try {
      const { response, body: value } = await authedActionJson<{
        post?: SocialPostDTO;
      }>(`/api/social/posts/${post.id}`, { cache: "no-store" }, { requiresIdentity: true });
      if (response.ok && value.post) {
        initialPostRef.current = value.post;
        setBasePost(value.post);
        setDraft(initialDraft(value.post));
        setPhoto(null);
        setRemovePhoto(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setMutationVersion(value.post.mutationVersion);
        setConflict(false);
        setFeedbackIsStatus(true);
        setFeedback("Latest post loaded. Review it before saving.");
        return;
      }
      setFeedbackIsStatus(false);
      setFeedback("Latest post could not be loaded.");
    } catch (cause) {
      if (isAbortError(cause)) return;
      setFeedbackIsStatus(false);
      setFeedback("Latest post could not be loaded.");
    }
  }

  async function submit() {
    setBusy(true);
    setFeedback(null);
    setFeedbackIsStatus(false);
    setConflict(false);
    const media = await prepareNewPostMedia({
      editing, photo, extraPhotos, video, videoDuration, caption: draft.body,
      onUploading: () => { setFeedbackIsStatus(true); setFeedback("Uploading your video…"); },
    });
    setFeedbackIsStatus(false);
    setFeedback("error" in media ? media.error : null);
    if ("error" in media) {
      setBusy(false);
      return;
    }
    const videoUploadId = media.videoUploadId;
    const hashtags = draft.hashtags
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#/, "").trim())
      .filter(Boolean);
    const payload = {
      ...(editing ? { expectedMutationVersion: mutationVersion } : {}),
      kind: draft.kind,
      visibility: draft.visibility,
      body: draft.body,
      area: draft.area || null,
      venueId: draft.venueId,
      hashtags,
      // No control sets this while posts take no comments. An edit keeps what the
      // post already holds, and a new post opens as the stored default.
      commentPolicy: basePost?.commentPolicy ?? "open",
      ...(photo || (editing && basePost?.photo && !removePhoto)
        ? { photoAltText: draft.altText }
        : {}),
      ...(photo
        ? { tagHandles: draft.tagHandles.split(/[\s,]+/).filter(Boolean) }
        : {}),
      ...(editing && removePhoto && !photo ? { removePhoto: true } : {}),
      ...(editing ? {} : newPostExtras(draft, videoUploadId, videoDuration)),
    };
    const requestBody: BodyInit = photo
      ? (() => {
          const form = new FormData();
          form.set("post", JSON.stringify(payload));
          form.set("photo", photo);
          return form;
        })()
      : JSON.stringify(payload);
    try {
      const { response, body: result } = await authedActionJson<{
        code?: string;
        error?: string;
        post?: SocialPostDTO;
      }>(
        editing ? `/api/social/posts/${post!.id}` : "/api/social/posts",
        {
          method: editing ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: photo
            ? { "Idempotency-Key": draft.requestKey }
            : {
                "Content-Type": "application/json",
                "Idempotency-Key": draft.requestKey,
              },
          body: requestBody,
        },
        { requiresIdentity: true },
      );
      if (!response.ok) {
        if (editing && response.status === 409 && result.code === "EDIT_CONFLICT") {
          setConflict(true);
          throw new Error("Post changed. Your draft is still here. Load latest before retrying.");
        }
        if (!editing && response.status === 409 && result.code === "IDEMPOTENCY_CONFLICT") {
          setDraft((current) => ({
            ...current,
            requestKey: initialDraft().requestKey,
          }));
          throw new Error("That post already went through once. Your draft is still here. Try posting again.");
        }
        throw new Error(errorMessageFrom(result, "Couldn't save that post."));
      }
      localStorage.removeItem(draftKey);
      void saveSocialDraftPhoto(draftKey, null);
      const savedPost = editing ? result.post ?? basePost : undefined;
      initialPostRef.current = savedPost;
      setBasePost(savedPost);
      setDraft(initialDraft(savedPost));
      if (savedPost) setMutationVersion(savedPost.mutationVersion);
      const finished = await withExtraPhotos(result.post, newPostPhotoDrafts(editing, photo, extraPhotos));
      setPhoto(null);
      setVideo(null);
      setExtraPhotos([]);
      setRemovePhoto(false);
      setFeedbackIsStatus(Boolean(finished.notice));
      setFeedback(finished.notice);
      if (!finished.notice) closeComposer();
      onSaved(finished.post);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setFeedback(
        offlineOrMessage(cause instanceof Error
            ? cause.message
            : "Couldn't save that post.")
      );
      setFeedbackIsStatus(false);
    } finally {
      setBusy(false);
    }
  }

  const attachedPhoto = Boolean(photo || (basePost?.photo && !removePhoto));
  const previewSource = photoPreviewUrl ??
    (basePost?.photo && !removePhoto
      ? `/api/social/media/${basePost.photo.mediaId}`
      : null);
  const hasDraftChanges = draftHasChanges(
    draft,
    basePost,
    photo,
    removePhoto,
  );

  return (
    <>
      {/* The compose door is /social's one primary action (docs/design/
          LAUNCH_SCREENS.md). An edit trigger on a post is not: it repeats per
          post, and the route may carry the mark once. */}
      <button
        ref={triggerRef}
        className={editing ? "socialEditButton" : "socialButton socialComposeOpen"}
        type="button"
        data-primary-action={editing ? undefined : ""}
        disabled={!draftReady}
        onClick={openComposer}
      >
        {triggerLabel ?? (editing ? "Edit post" : "New post")}
      </button>
      {open ? createPortal(
        <div
          className="socialComposerBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeComposer();
          }}
        >
          <section
            ref={dialogRef}
            className="socialComposer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={composerId}
          >
            <header>
              <button type="button" onClick={closeComposer}>
                Cancel
              </button>
              <h2 id={composerId}>{editing ? "Edit post" : "New post"}</h2>
              <button
                type="button"
                disabled={
                  busy ||
                  (!draft.body.trim() && !attachedPhoto) ||
                  Boolean(attachedPhoto && !draft.altText.trim())
                }
                onClick={() => void submit()}
              >
                {busy ? "Saving…" : editing ? "Save" : "Post"}
              </button>
            </header>

            {feedback ? (
              <div
                ref={feedbackRef}
                className="socialComposerFeedback"
                role={feedbackIsStatus ? "status" : "alert"}
                tabIndex={feedbackIsStatus ? undefined : -1}
              >
                <p>{feedback}</p>
                {conflict ? (
                  <button type="button" onClick={() => void loadLatest()}>
                    Load latest
                  </button>
                ) : null}
              </div>
            ) : null}

            {hasDraftChanges ? (
              <button
                type="button"
                className="socialClearDraft"
                onClick={() => void clearDraft()}
              >
                Clear draft
              </button>
            ) : null}

            <AudienceField draft={draft} nameHidden={nameHidden} onDraft={setDraft} />

            <label className="socialComposerBody">
              Write post
              <textarea
                ref={bodyRef}
                maxLength={2000}
                placeholder="A pub worth the walk? A photo worth keeping?"
                value={draft.body}
                onChange={(event) =>
                  setDraft({ ...draft, body: event.currentTarget.value })
                }
              />
            </label>
            <p className="socialComposerCount"><span>{draft.body.length}</span> / 2000</p>
            <PostPrompts editing={editing} ready={draftReady} body={draft.body} onChoose={(body) => {
              setDraft((current) => ({ ...current, body }));
              bodyRef.current?.focus();
            }} />

            <MediaEditors
              editing={editing} video={video} videoPreviewUrl={videoPreviewUrl} videoDuration={videoDuration}
              hasPhoto={Boolean(photo)} onVideo={chooseVideo} onDuration={setVideoDuration}
              extraPhotos={extraPhotos} onExtraPhotos={setExtraPhotos}
              photoEditor={(
                <PhotoEditor
                  post={basePost} draft={draft} photo={photo} previewSource={previewSource}
                  removePhoto={removePhoto} fileInputRef={fileInputRef} onDraft={setDraft}
                  onPhoto={(nextPhoto) => { setPhoto(nextPhoto); setRemovePhoto(false); }}
                  onClearSelected={clearSelectedPhoto}
                  onToggleExisting={() => setRemovePhoto((value) => !value)}
                />
              )}
            />

            <label>
              Area
              <select
                value={draft.area}
                onChange={(event) =>
                  setDraft({ ...draft, area: event.currentTarget.value })
                }
              >
                <option value="">None</option>
                {nightAreasByCity().map((group) => (
                  <optgroup key={group.cityId} label={getCity(group.cityId).displayName}>
                    {group.areas.map((area) => (
                      <option key={area.slug} value={area.slug}>
                        {area.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <PlaceFields
              editing={editing} nameHidden={nameHidden} draft={draft} onDraft={setDraft}
              venueEditor={(
                <VenueEditor
                  draft={draft} results={venueResults} activeIndex={activeVenueIndex}
                  listId={venueListId} announcement={venueAnnouncement} onDraft={setDraft}
                  onActiveIndex={setActiveVenueIndex}
                  onClearResults={() => { setVenueResults([]); setActiveVenueIndex(-1); }}
                  onSelect={selectVenue}
                />
              )}
            />

            <PolicyFields draft={draft} hasPhoto={Boolean(photo)} nameHidden={nameHidden} onDraft={setDraft} />

            {concurrent ? (
              <p className="socialComposerConcurrent" role="status">
                This draft is open in another tab.
              </p>
            ) : null}
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
