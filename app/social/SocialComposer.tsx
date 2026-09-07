"use client";

import { type RefObject, useEffect, useId, useRef, useState } from "react";

import "./socialComposer.css";

import SocialPostMedia from "@/components/social/SocialPostMedia";

import { nightAreasByCity } from "@/lib/nightAreas";
import { getCity } from "@/lib/cities";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionJson } from "@/lib/authedFetch";
import {
  readSocialDraftPhoto,
  saveSocialDraftPhoto,
} from "@/lib/socialComposerDrafts";
import {
  SOCIAL_VIDEO_ACCEPT,
  SOCIAL_VIDEO_MAX_BYTES,
  SOCIAL_VIDEO_REQUIREMENTS,
  inspectSocialVideo,
} from "@/lib/socialMediaPolicy";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

type VenueChoice = { id: string; name: string; borough: string };
type Draft = {
  requestKey: string;
  body: string;
  altText: string;
  area: string;
  venueId: string | null;
  venueName: string;
  visibility: SocialPostDTO["visibility"];
  commentPolicy: SocialPostDTO["commentPolicy"];
  kind: SocialPostDTO["kind"];
  hashtags: string;
  tagHandles: string;
};
type DraftChannelMessage = {
  key?: string;
  type?: "hello" | "present";
};

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    cause.name === "AbortError"
  );
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
    commentPolicy: post?.commentPolicy ?? "open",
    kind: post?.kind ?? "standard",
    hashtags: post?.hashtags.join(" ") ?? "",
    tagHandles: "",
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
    draft.commentPolicy !== (post?.commentPolicy ?? "open") ||
    draft.kind !== (post?.kind ?? "standard") ||
    draft.hashtags !== (post?.hashtags.join(" ") ?? "") ||
    draft.tagHandles !== "",
  );
}

function draftHasRequiredContent(
  draft: Draft,
  post: SocialPostDTO | undefined,
  photo: File | null,
  removePhoto: boolean,
): boolean {
  const attachedPhoto = Boolean(photo || (post?.photo && !removePhoto));
  return Boolean(draft.body.trim() || attachedPhoto) &&
    (!attachedPhoto || Boolean(draft.altText.trim()));
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
  const video = photo
    ? photo.type === SOCIAL_VIDEO_ACCEPT
    : post?.photo?.kind === "video";
  const mediaName = video ? "video" : "photo";
  const requirementsId = useId();
  return (
    <div className="socialComposerMedia">
      <label className="socialPhotoPicker">
        <span className="socialPhotoCue" aria-hidden="true">
          +
        </span>
        <span>
          {photo
            ? photo.name
            : post?.photo && !removePhoto
              ? `Replace ${mediaName}`
              : "Add photo or video"}
        </span>
        <input
          ref={fileInputRef}
          aria-label="Add photo or video"
          aria-describedby={requirementsId}
          type="file"
          accept={`image/jpeg,image/png,image/webp,${SOCIAL_VIDEO_ACCEPT}`}
          onChange={(event) => onPhoto(event.currentTarget.files?.[0] ?? photo)}
        />
      </label>
      <p id={requirementsId} className="socialComposerMediaLimits">
        Photos up to 4 MB. MP4 videos up to 15 seconds and 4 MB.
      </p>
      {previewSource ? (
        <figure className="socialComposerPhotoPreview">
          {video ? (
            <video
              src={previewSource}
              controls
              playsInline
              preload="metadata"
              aria-label={draft.altText || "Selected video preview"}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL or private signed delivery route.
            <img
              src={previewSource}
              alt={draft.altText || "Selected photo preview"}
            />
          )}
        </figure>
      ) : post?.photo && !removePhoto ? (
        post.moderationState === "approved" ? (
          <figure className="socialComposerPhotoPreview">
            <SocialPostMedia media={{ ...post.photo, altText: draft.altText }} />
          </figure>
        ) : <p role="status">{video ? "Video" : "Photo"} held for review. Preview is not available.</p>
      ) : null}
      {photo ? (
        <button
          type="button"
          className="socialRemovePhoto"
          onClick={onClearSelected}
        >
          Remove selected {mediaName}
        </button>
      ) : post?.photo ? (
        <button
          type="button"
          className="socialRemovePhoto"
          onClick={onToggleExisting}
        >
          {removePhoto ? `Keep ${mediaName}` : `Remove ${mediaName}`}
        </button>
      ) : null}
      {attachedPhoto ? (
        <label>
          {video ? "Video description" : "Photo description"}
          <input
            required
            maxLength={300}
            value={draft.altText}
            onChange={(event) =>
              onDraft({ ...draft, altText: event.currentTarget.value })
            }
          />
        </label>
      ) : null}
    </div>
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
        <div className="socialSelectedVenue" aria-label="Selected Venue">
          <span>{draft.venueName}</span>
          <button
            type="button"
            onClick={() => onDraft({ ...draft, venueId: null, venueName: "" })}
          >
            Remove venue
          </button>
        </div>
      ) : (
        <label>
          Venue - Friends only
          <input
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
            }
            value={draft.venueName}
            onChange={(event) => {
              const venueName = event.currentTarget.value;
              if (venueName.trim().length < 2) onClearResults();
              onDraft({ ...draft, venueName, venueId: null });
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault();
                onActiveIndex((current) =>
                  Math.min(current + 1, results.length - 1),
                );
              } else if (event.key === "ArrowUp" && results.length > 0) {
                event.preventDefault();
                onActiveIndex((current) =>
                  current <= 0 ? results.length - 1 : current - 1,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (activeIndex >= 0 && results[activeIndex]) onSelect(results[activeIndex]);
              } else if (event.key === "Escape" && results.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                onClearResults();
              }
            }}
          />
        </label>
      )}
      <p className="srOnly" role="status" aria-live="polite">
        {announcement}
      </p>
      {results.length > 0 && !draft.venueId ? (
        <ul
          id={listId}
          className="socialVenueResults"
          role="listbox"
          aria-label="Venue results"
        >
          {results.map((venue, index) => (
            <li key={venue.id} role="presentation">
              <button
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(venue)}
              >
                {venue.name}, {venue.borough}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function PolicyFields({
  draft,
  hasPhoto,
  onDraft,
}: {
  draft: Draft;
  hasPhoto: boolean;
  onDraft: (draft: Draft) => void;
}) {
  return (
    <>
      <label>
        Hashtags
        <input
          value={draft.hashtags}
          onChange={(event) =>
            onDraft({ ...draft, hashtags: event.currentTarget.value })
          }
        />
      </label>
      {hasPhoto ? (
        <label>
          Photo tags
          <input
            value={draft.tagHandles}
            onChange={(event) =>
              onDraft({ ...draft, tagHandles: event.currentTarget.value })
            }
          />
        </label>
      ) : null}
      <label>
        Comments
        <select
          value={draft.commentPolicy}
          onChange={(event) =>
            onDraft({
              ...draft,
              commentPolicy: event.currentTarget
                .value as Draft["commentPolicy"],
            })
          }
        >
          <option value="open">Open</option>
          <option value="friends">Friends</option>
          <option value="locked">Locked</option>
        </select>
      </label>
      <label>
        Post type
        <select
          value={draft.kind}
          onChange={(event) =>
            onDraft({
              ...draft,
              kind: event.currentTarget.value as Draft["kind"],
            })
          }
        >
          <option value="standard">Post</option>
          <option value="feature_request">Feature request</option>
        </select>
      </label>
    </>
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
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [mutationVersion, setMutationVersion] = useState<number | null>(
    post?.mutationVersion ?? 0,
  );
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const intakeVersion = useRef(0);
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
  const composerId = useId();
  const formId = useId();

  function closeComposer() {
    if (busy) return;
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openComposer() {
    setConcurrent(false);
    setOpen(true);
  }

  function clearSelectedPhoto() {
    intakeVersion.current += 1;
    setMediaBusy(false);
    setPhoto(null);
    setRemovePhoto(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setDraft((current) => ({
      ...current,
      altText: basePost?.photo?.altText ?? "",
      tagHandles: "",
    }));
  }

  async function selectMedia(file: File | null) {
    if (!file) return;
    const version = ++intakeVersion.current;
    if (!conflict) setFeedback(null);
    setMediaBusy(true);
    try {
      if (!file.size || file.size > SOCIAL_VIDEO_MAX_BYTES) {
        throw new Error("Choose a photo or video up to 4 MB.");
      }
      if (file.type === SOCIAL_VIDEO_ACCEPT) {
        inspectSocialVideo(new Uint8Array(await file.arrayBuffer()));
      } else if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      ) {
        throw new Error("Choose a JPEG, PNG, WebP photo, or MP4 video.");
      }
      if (version !== intakeVersion.current) return;
      setPhoto(file);
      setRemovePhoto(false);
      setDraft((current) => ({ ...current, tagHandles: "" }));
    } catch (cause) {
      if (version !== intakeVersion.current) return;
      setFeedback(
        cause instanceof Error ? cause.message : SOCIAL_VIDEO_REQUIREMENTS,
      );
      setFeedbackIsStatus(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      if (version === intakeVersion.current) setMediaBusy(false);
    }
  }

  async function clearDraft() {
    intakeVersion.current += 1;
    setMediaBusy(false);
    try { localStorage.removeItem(draftKey); } catch { /* Keep the in-page clear available. */ }
    await saveSocialDraftPhoto(draftKey, null).catch(() => undefined);
    setDraft(initialDraft(initialPostRef.current));
    setMutationVersion(initialPostRef.current?.mutationVersion ?? 0);
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

  useDismissOnEscape(open, closeComposer);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      let nextDraft = initialDraft(initialPostRef.current);
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          const savedDraft = JSON.parse(saved) as Partial<Draft> & {
            removePhoto?: boolean;
            baseMutationVersion?: number;
          };
          nextDraft = { ...nextDraft, ...savedDraft };
          if (active) {
            setRemovePhoto(savedDraft.removePhoto === true);
            if (initialPostRef.current) {
              const savedVersion = Number.isInteger(savedDraft.baseMutationVersion)
                ? savedDraft.baseMutationVersion! : null;
              setMutationVersion(savedVersion);
              if (savedVersion !== initialPostRef.current.mutationVersion) {
                setConflict(true);
                setFeedbackIsStatus(false);
                setFeedback("This draft uses an older post. Load latest before saving. Your draft is still here.");
              }
            }
          }
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
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ...draft, removePhoto, baseMutationVersion: mutationVersion }));
    } catch {
      const timer = window.setTimeout(() => {
        setFeedback(
          "Your draft could not be saved on this device. Keep this page open.",
        );
        setFeedbackIsStatus(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [draft, draftKey, draftReady, removePhoto, mutationVersion]);

  useEffect(() => {
    if (draftReady) {
      void saveSocialDraftPhoto(draftKey, photo).catch(() => {
        if (!photo) return;
        setFeedback(
          "Your attachment could not be saved on this device. Keep this page open.",
        );
        setFeedbackIsStatus(true);
      });
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
    if (open) bodyRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!feedback || feedbackIsStatus) return;
    window.requestAnimationFrame(() => {
      feedbackRef.current?.focus();
      feedbackRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, [feedback, feedbackIsStatus]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((control) => {
        if (
          control.closest("[hidden], [inert]") ||
          control.matches(":disabled")
        )
          return false;
        let ancestor = control.parentElement;
        while (ancestor && ancestor !== dialog) {
          if (
            ancestor instanceof HTMLDetailsElement &&
            !ancestor.open &&
            !ancestor.querySelector("summary")?.contains(control)
          )
            return false;
          ancestor = ancestor.parentElement;
        }
        return control.tabIndex >= 0;
      });
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
            `${venues.length} Venue${venues.length === 1 ? "" : "s"} found.`,
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
      }>(
        `/api/social/posts/${post.id}`,
        { cache: "no-store" },
        { requiresIdentity: true },
      );
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
    if (!canSubmit) return;
    setBusy(true);
    setFeedback(null);
    setFeedbackIsStatus(false);
    setConflict(false);
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
      commentPolicy: draft.commentPolicy,
      ...(photo || (editing && basePost?.photo && !removePhoto)
        ? { photoAltText: draft.altText }
        : {}),
      ...(photo && photo.type !== SOCIAL_VIDEO_ACCEPT
        ? { tagHandles: draft.tagHandles.split(/[\s,]+/).filter(Boolean) }
        : {}),
      ...(editing && removePhoto && !photo ? { removePhoto: true } : {}),
    };
    const requestBody: BodyInit = photo
      ? (() => {
          const form = new FormData();
          form.set("post", JSON.stringify(payload));
          form.set(
            photo.type === SOCIAL_VIDEO_ACCEPT ? "video" : "photo",
            photo,
          );
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
        if (
          editing &&
          response.status === 409 &&
          result.code === "EDIT_CONFLICT"
        ) {
          setConflict(true);
          throw new Error(
            "Post changed. Your draft is still here. Load latest before retrying.",
          );
        }
        if (
          !editing &&
          response.status === 409 &&
          result.code === "IDEMPOTENCY_CONFLICT"
        ) {
          setDraft((current) => ({
            ...current,
            requestKey: initialDraft().requestKey,
          }));
          throw new Error(
            "Post request key was already used. Your draft is still here. Try posting again.",
          );
        }
        throw new Error(errorMessageFrom(result, "Post was not saved."));
      }
      try { localStorage.removeItem(draftKey); } catch { /* The post was saved. */ }
      void saveSocialDraftPhoto(draftKey, null).catch(() => undefined);
      const savedPost = editing ? (result.post ?? basePost) : undefined;
      initialPostRef.current = savedPost;
      setBasePost(savedPost);
      setDraft(initialDraft(savedPost));
      if (savedPost) setMutationVersion(savedPost.mutationVersion);
      setPhoto(null);
      setRemovePhoto(false);
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
      onSaved(result.post);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setFeedback(
        offlineOrMessage(
          cause instanceof Error ? cause.message : "Post was not saved.",
        ),
      );
      setFeedbackIsStatus(false);
    } finally {
      setBusy(false);
    }
  }

  const previewSource = photo ? photoPreviewUrl : null;
  const hasDraftChanges = draftHasChanges(draft, basePost, photo, removePhoto);

  const canSubmit =
    !conflict &&
    !busy &&
    !mediaBusy &&
    draftHasRequiredContent(draft, basePost, photo, removePhoto);

  return (
    <>
      {/* The compose door is /social's one primary action (docs/design/
          LAUNCH_SCREENS.md). An edit trigger on a post is not: it repeats per
          post, and the route may carry the mark once. */}
      <button
        ref={triggerRef}
        className={
          editing ? "socialEditButton" : "socialButton socialComposeOpen"
        }
        type="button"
        data-primary-action={editing ? undefined : ""}
        disabled={!draftReady}
        aria-hidden={open || undefined}
        tabIndex={open ? -1 : undefined}
        onClick={openComposer}
      >
        {triggerLabel ?? (editing ? "Edit post" : "New post")}
      </button>
      {open ? (
        <div
          className="socialComposerBackdrop socialComposerCreateBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeComposer();
          }}
        >
          <section
            ref={dialogRef}
            className="socialComposer socialComposerCreate"
            role="dialog"
            aria-modal="true"
            aria-labelledby={composerId}
          >
            <header>
              <button type="button" disabled={busy} onClick={closeComposer}>
                Cancel
              </button>
              <h2 id={composerId}>{editing ? "Edit post" : "New post"}</h2>
              <button
                type="submit"
                form={formId}
                className="socialComposerSubmit"
                disabled={!canSubmit}
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

            <form
              id={formId}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <fieldset className="socialComposerFields" disabled={busy}>
                <PhotoEditor
                  post={basePost}
                  draft={draft}
                  photo={photo}
                  previewSource={previewSource}
                  removePhoto={removePhoto}
                  fileInputRef={fileInputRef}
                  onDraft={setDraft}
                  onPhoto={(nextPhoto) => void selectMedia(nextPhoto)}
                  onClearSelected={clearSelectedPhoto}
                  onToggleExisting={() => setRemovePhoto((value) => !value)}
                />

                {mediaBusy ? <p role="status">Checking video…</p> : null}

                <label className="socialComposerBody">
                  Write post
                  <textarea
                    ref={bodyRef}
                    maxLength={2000}
                    placeholder="What made the night?"
                    rows={3}
                    value={draft.body}
                    onChange={(event) =>
                      setDraft({ ...draft, body: event.currentTarget.value })
                    }
                  />
                </label>

                <fieldset className="socialComposerAudience">
                  <legend>Audience</legend>
                  <div>
                    {(
                      [
                        ["friends", "Friends"],
                        ["private", "Only me"],
                        ["public", "Everyone"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name={`${composerId}-audience`}
                          value={value}
                          checked={draft.visibility === value}
                          onChange={() =>
                            setDraft({ ...draft, visibility: value })
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <details className="socialComposerDetails">
                  <summary>
                    {draft.venueId
                      ? draft.venueName
                      : draft.area
                        ? `Area: ${draft.area}`
                        : "Add location"}
                  </summary>
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
                        <optgroup
                          key={group.cityId}
                          label={getCity(group.cityId).displayName}
                        >
                          {group.areas.map((area) => (
                            <option key={area.slug} value={area.slug}>
                              {area.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>

                  <VenueEditor
                    draft={draft}
                    results={venueResults}
                    activeIndex={activeVenueIndex}
                    listId={venueListId}
                    announcement={venueAnnouncement}
                    onDraft={setDraft}
                    onActiveIndex={setActiveVenueIndex}
                    onClearResults={() => {
                      setVenueResults([]);
                      setActiveVenueIndex(-1);
                    }}
                    onSelect={selectVenue}
                  />
                </details>

                <details className="socialComposerDetails">
                  <summary>Advanced settings</summary>
                  <PolicyFields
                    draft={draft}
                    hasPhoto={Boolean(
                      photo && photo.type !== SOCIAL_VIDEO_ACCEPT,
                    )}
                    onDraft={setDraft}
                  />
                </details>

                {hasDraftChanges ? (
                  <button
                    type="button"
                    className="socialClearDraft"
                    onClick={() => void clearDraft()}
                  >
                    Clear draft
                  </button>
                ) : null}
              </fieldset>
            </form>

            {concurrent ? (
              <p className="socialComposerConcurrent" role="status">
                This draft is open in another tab.
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
