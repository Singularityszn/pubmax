"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import { getAccessToken } from "@/lib/authClient";
import { categoryLabel, MAP_LENS_DRINK_CATEGORIES } from "@/lib/drinks";
import {
  PROFILE_IMAGE_PICKER_ACCEPT,
  profileImageCropTarget,
} from "@/lib/profileImagePicker";
import { profileImageOutputBox, type ProfileImageSlot } from "@/lib/profileImageSlots";
import type { PublicProfile } from "@/lib/profiles";

// Inline "edit my profile" form for the owner of a handle. The page mounts this
// only when the viewer's own handle matches the route handle - so this stays
// dumb about who is allowed to edit; the page owns that gate. It PATCHes the
// editable fields to /api/profiles/[handle], mirrors the SERVER's caps for
// instant feedback (the server is still the trust boundary - see the route),
// and reports the saved row back up so the page can update the header
// optimistically. Image changes use POST/DELETE on the slot's own route.
//
// The fields are GROUPED the way a person thinks about themselves: how the card
// looks, who they are, and what they are like on a night out. A single flat
// column of eight inputs reads as a settings page, which this is not.
//
// Choosing a photo is TWO BEATS: pick, then position. The picker is a plain
// file input carrying lib/profileImagePicker's accept and NO capture attribute
// (see that file for why an iPhone was offered no photo library at all), and
// what it hands back goes to ProfileImageCropper rather than straight up the
// wire. The cropper returns a JPEG cut to the slot's own shape, which is what
// makes an iPhone's HEIC uploadable, and uploadImage below is unchanged: the
// upload routes still receive one JPEG under `photo` and still run the same
// scan on it.

const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 280;
const MAX_HOME_CITY = 60;
const MAX_FAVOURITE_DRINK = 40;
const MAX_INTERESTS = 140;
const MAX_WORKPLACE = 60;

// Suggestions, not a closed set: the field is free text so "Guinness" and
// "whatever is cheapest" both fit. The list is the map's own drink vocabulary,
// which drops `other` because it names no drink.
const DRINK_SUGGESTIONS = MAP_LENS_DRINK_CATEGORIES.map((category) =>
  categoryLabel(category),
);

type SaveState = "idle" | "saving" | "saved" | "error";
type ImageState = "idle" | "uploading" | "removing" | "error";

type ProfileEditorProps = {
  handle: string;
  initial: {
    displayName?: string;
    bio?: string;
    homeCity?: string;
    avatarUrl?: string;
    coverUrl?: string;
    favouriteDrink?: string;
    interests?: string;
    workplace?: string;
  };
  onSaved: (profile: PublicProfile) => void;
  onClose: () => void;
};

/** Identity of a chosen file, so a second pick arrives as a fresh crop step. */
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function initialOf(name: string, handle: string): string {
  const source = name.trim() || handle.trim();
  return (source.charAt(0) || "?").toUpperCase();
}

function parseApiError(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return fallback;
}

function profileFrom(body: unknown): PublicProfile | null {
  return body && typeof body === "object"
    ? (body as { profile?: PublicProfile | null }).profile ?? null
    : null;
}

export default function ProfileEditor({ handle, initial, onSaved, onClose }: ProfileEditorProps) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [homeCity, setHomeCity] = useState(initial.homeCity ?? "");
  const [favouriteDrink, setFavouriteDrink] = useState(initial.favouriteDrink ?? "");
  const [interests, setInterests] = useState(initial.interests ?? "");
  const [workplace, setWorkplace] = useState(initial.workplace ?? "");
  const [avatarPreview, setAvatarPreview] = useState(initial.avatarUrl ?? "");
  const [coverPreview, setCoverPreview] = useState(initial.coverUrl ?? "");
  const [imageError, setImageError] = useState<Record<ProfileImageSlot, string | null>>({
    avatar: null,
    cover: null,
  });
  const [imageState, setImageState] = useState<Record<ProfileImageSlot, ImageState>>({
    avatar: "idle",
    cover: "idle",
  });
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // The chosen-but-not-yet-positioned photo for each slot. While one is held,
  // that slot shows the crop step instead of its preview and buttons.
  const [pending, setPending] = useState<Record<ProfileImageSlot, File | null>>({
    avatar: null,
    cover: null,
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const imageBusy = (Object.values(imageState) as ImageState[]).some(
    (value) => value === "uploading" || value === "removing",
  );
  const formBusy = state === "saving" || imageBusy;

  function setPreview(slot: ProfileImageSlot, profile: PublicProfile | null, url: string) {
    if (slot === "avatar") setAvatarPreview(profile ? url : "");
    else setCoverPreview(profile ? url : "");
  }

  async function authHeaders(json = false): Promise<Record<string, string>> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (json) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  function markImage(slot: ProfileImageSlot, next: ImageState, message: string | null) {
    setImageState((prev) => ({ ...prev, [slot]: next }));
    setImageError((prev) => ({ ...prev, [slot]: message }));
  }

  function choose(slot: ProfileImageSlot, file: File | null) {
    setPending((prev) => ({ ...prev, [slot]: file }));
    if (file) markImage(slot, "idle", null);
  }

  function uploadCropped(slot: ProfileImageSlot, file: File) {
    choose(slot, null);
    void uploadImage(slot, file);
  }

  async function uploadImage(slot: ProfileImageSlot, file: File) {
    markImage(slot, "uploading", null);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/${slot}`, {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        markImage(
          slot,
          "error",
          parseApiError(body, "Could not upload that image. Try again."),
        );
        return;
      }
      const profile = profileFrom(body);
      if (profile) {
        onSaved(profile);
        const next = slot === "avatar" ? profile.avatarUrl : profile.coverUrl;
        setPreview(slot, profile, next ?? "");
      }
      markImage(slot, "idle", null);
    } catch {
      markImage(slot, "error", "Network error. Try again.");
    }
  }

  async function removeImage(slot: ProfileImageSlot) {
    markImage(slot, "removing", null);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/${slot}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        markImage(
          slot,
          "error",
          parseApiError(body, "Could not remove that image. Try again."),
        );
        return;
      }
      const profile = profileFrom(body);
      if (profile) onSaved(profile);
      setPreview(slot, null, "");
      markImage(slot, "idle", null);
    } catch {
      markImage(slot, "error", "Network error. Try again.");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formBusy) return;

    setState("saving");
    setError(null);

    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}`, {
        method: "PATCH",
        headers: await authHeaders(true),
        body: JSON.stringify({
          displayName,
          bio,
          homeCity,
          favouriteDrink,
          interests,
          workplace,
        }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setState("error");
        setError(parseApiError(body, "Couldn't save. Try again."));
        return;
      }

      const profile = profileFrom(body);
      if (profile) onSaved(profile);
      setState("saved");
    } catch {
      setState("error");
      setError("Network error. Try again.");
    }
  }

  function imageStatus(slot: ProfileImageSlot): string | null {
    return imageError[slot];
  }

  return (
    <form className="profileEditor" onSubmit={handleSubmit} aria-label="Edit your profile">
      <fieldset className="profileEditorGroup profileEditorGroupLook" disabled={formBusy}>
        <legend>Your look</legend>

        <div className="profileEditorField profileEditorCoverField">
          <span className="profileEditorAvatarLabel" id="pe-cover-label">
            Cover photo
          </span>
          {pending.cover ? null : (
            <div className="profileEditorCoverStage">
              {coverPreview ? (
                <Image
                  className="profileEditorCoverPreview"
                  src={coverPreview}
                  alt=""
                  width={profileImageOutputBox("cover").width}
                  height={profileImageOutputBox("cover").height}
                  unoptimized
                />
              ) : (
                <div className="profileEditorCoverPreview profileEditorCoverFallback" aria-hidden="true" />
              )}
            </div>
          )}
          <input
            ref={coverInputRef}
            id="pe-cover-file"
            type="file"
            accept={PROFILE_IMAGE_PICKER_ACCEPT}
            className="profileEditorAvatarFile"
            aria-labelledby="pe-cover-label"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              choose("cover", file);
            }}
          />
          {pending.cover ? (
            <ProfileImageCropper
              key={fileKey(pending.cover)}
              target={profileImageCropTarget("cover")}
              file={pending.cover}
              busy={imageState.cover === "uploading"}
              onCancel={() => choose("cover", null)}
              onCropped={(file) => uploadCropped("cover", file)}
            />
          ) : (
            <div className="profileEditorAvatarActions profileEditorCoverActions">
              <button
                type="button"
                className="profileEditorAvatarUpload"
                onClick={() => coverInputRef.current?.click()}
              >
                {imageState.cover === "uploading" ? "Uploading…" : "Choose cover"}
              </button>
              {coverPreview ? (
                <button
                  type="button"
                  className="profileEditorAvatarRemove"
                  onClick={() => void removeImage("cover")}
                >
                  {imageState.cover === "removing" ? "Removing…" : "Remove cover"}
                </button>
              ) : null}
            </div>
          )}
          {imageStatus("cover") ? (
            <span className="profileEditorHint profileEditorStatusErr" role="status">
              {imageStatus("cover")}
            </span>
          ) : null}
        </div>

        <div className="profileEditorField profileEditorAvatarField">
          <span className="profileEditorAvatarLabel" id="pe-avatar-label">
            Profile photo
          </span>
          <input
            ref={avatarInputRef}
            id="pe-avatar-file"
            type="file"
            accept={PROFILE_IMAGE_PICKER_ACCEPT}
            className="profileEditorAvatarFile"
            aria-labelledby="pe-avatar-label"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              choose("avatar", file);
            }}
          />
          {pending.avatar ? (
            <ProfileImageCropper
              key={fileKey(pending.avatar)}
              target={profileImageCropTarget("avatar")}
              file={pending.avatar}
              busy={imageState.avatar === "uploading"}
              onCancel={() => choose("avatar", null)}
              onCropped={(file) => uploadCropped("avatar", file)}
            />
          ) : (
            <div className="profileEditorAvatarRow">
              {avatarPreview ? (
                <Image
                  className="profileEditorAvatarPreview"
                  src={avatarPreview}
                  alt=""
                  width={72}
                  height={72}
                  unoptimized
                />
              ) : (
                <div className="profileEditorAvatarPreview profileEditorAvatarFallback" aria-hidden="true">
                  {initialOf(displayName, handle)}
                </div>
              )}
              <div className="profileEditorAvatarActions">
                <button
                  type="button"
                  className="profileEditorAvatarUpload"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {imageState.avatar === "uploading" ? "Uploading…" : "Choose photo"}
                </button>
                {avatarPreview ? (
                  <button
                    type="button"
                    className="profileEditorAvatarRemove"
                    onClick={() => void removeImage("avatar")}
                  >
                    {imageState.avatar === "removing" ? "Removing…" : "Remove photo"}
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {imageStatus("avatar") ? (
            <span className="profileEditorHint profileEditorStatusErr" role="status">
              {imageStatus("avatar")}
            </span>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="profileEditorGroup" disabled={formBusy}>
        <legend>You</legend>

        <div className="profileEditorField">
          <label htmlFor="pe-displayName">Display name</label>
          <input
            id="pe-displayName"
            type="text"
            value={displayName}
            maxLength={MAX_DISPLAY_NAME}
            autoComplete="off"
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {displayName.length}/{MAX_DISPLAY_NAME}
          </span>
        </div>

        <div className="profileEditorField">
          <label htmlFor="pe-bio">Bio</label>
          <textarea
            id="pe-bio"
            rows={3}
            value={bio}
            maxLength={MAX_BIO}
            onChange={(e) => setBio(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {bio.length}/{MAX_BIO}
          </span>
        </div>

        <div className="profileEditorField">
          <label htmlFor="pe-homeCity">Home city</label>
          <input
            id="pe-homeCity"
            type="text"
            value={homeCity}
            maxLength={MAX_HOME_CITY}
            autoComplete="off"
            onChange={(e) => setHomeCity(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {homeCity.length}/{MAX_HOME_CITY}
          </span>
        </div>
      </fieldset>

      <fieldset className="profileEditorGroup" disabled={formBusy}>
        <legend>Your night</legend>

        <div className="profileEditorField">
          <label htmlFor="pe-favouriteDrink">Favourite drink</label>
          <input
            id="pe-favouriteDrink"
            type="text"
            list="pe-drink-suggestions"
            value={favouriteDrink}
            maxLength={MAX_FAVOURITE_DRINK}
            autoComplete="off"
            onChange={(e) => setFavouriteDrink(e.target.value)}
          />
          <datalist id="pe-drink-suggestions">
            {DRINK_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <span className="profileEditorCount" aria-hidden="true">
            {favouriteDrink.length}/{MAX_FAVOURITE_DRINK}
          </span>
        </div>

        <div className="profileEditorField">
          <label htmlFor="pe-interests">What you&apos;re into</label>
          <textarea
            id="pe-interests"
            rows={2}
            value={interests}
            maxLength={MAX_INTERESTS}
            onChange={(e) => setInterests(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {interests.length}/{MAX_INTERESTS}
          </span>
        </div>

        <div className="profileEditorField">
          <label htmlFor="pe-workplace">Where you work</label>
          <input
            id="pe-workplace"
            type="text"
            value={workplace}
            maxLength={MAX_WORKPLACE}
            autoComplete="organization"
            onChange={(e) => setWorkplace(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {workplace.length}/{MAX_WORKPLACE}
          </span>
        </div>
      </fieldset>

      <div className="profileEditorActions">
        <button type="submit" className="profileEditorSave" disabled={formBusy}>
          {state === "saving" ? "Saving…" : "Save profile"}
        </button>
        <button
          type="button"
          className="profileEditorCancel"
          onClick={onClose}
          disabled={formBusy}
        >
          Cancel
        </button>
        {state === "saved" ? (
          <span className="profileEditorStatus profileEditorStatusOk" role="status">
            Saved.
          </span>
        ) : null}
        {state === "error" && error ? (
          <span className="profileEditorStatus profileEditorStatusErr" role="status">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
