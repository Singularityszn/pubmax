"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { getAccessToken } from "@/lib/authClient";
import type { ProfileRecord } from "@/lib/profileStore";

// Inline "edit my profile" form for the owner of a handle. The page mounts this
// only when the viewer's own handle matches the route handle — so this stays
// dumb about who is allowed to edit; the page owns that gate. It PATCHes the
// editable fields to /api/profiles/[handle], mirrors the SERVER's caps for
// instant feedback (the server is still the trust boundary — see the route),
// and reports the saved row back up so the page can update the header
// optimistically. Avatar changes use POST/DELETE /api/profiles/[handle]/avatar.

const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 280;
const MAX_HOME_CITY = 60;

type SaveState = "idle" | "saving" | "saved" | "error";
type AvatarState = "idle" | "uploading" | "removing" | "error";

type ProfileEditorProps = {
  handle: string;
  initial: {
    displayName?: string;
    bio?: string;
    homeCity?: string;
    avatarUrl?: string;
  };
  onSaved: (profile: ProfileRecord) => void;
  onClose: () => void;
};

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

export default function ProfileEditor({ handle, initial, onSaved, onClose }: ProfileEditorProps) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [homeCity, setHomeCity] = useState(initial.homeCity ?? "");
  const [avatarPreview, setAvatarPreview] = useState(initial.avatarUrl ?? "");
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const avatarBusy = avatarState === "uploading" || avatarState === "removing";
  const formBusy = state === "saving" || avatarBusy;

  async function authHeaders(json = false): Promise<Record<string, string>> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (json) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  async function uploadAvatar(file: File) {
    setAvatarState("uploading");
    setAvatarError(null);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/avatar`, {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setAvatarState("error");
        setAvatarError(parseApiError(body, "Could not upload that photo. Try again."));
        return;
      }
      const profile =
        body && typeof body === "object"
          ? (body as { profile?: ProfileRecord | null }).profile
          : null;
      if (profile) {
        onSaved(profile);
        setAvatarPreview(profile.avatarUrl ?? "");
      }
      setAvatarState("idle");
    } catch {
      setAvatarState("error");
      setAvatarError("Network error. Try again.");
    }
  }

  async function removeAvatar() {
    setAvatarState("removing");
    setAvatarError(null);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/avatar`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setAvatarState("error");
        setAvatarError(parseApiError(body, "Could not remove that photo. Try again."));
        return;
      }
      const profile =
        body && typeof body === "object"
          ? (body as { profile?: ProfileRecord | null }).profile
          : null;
      if (profile) {
        onSaved(profile);
        setAvatarPreview("");
      } else {
        setAvatarPreview("");
      }
      setAvatarState("idle");
    } catch {
      setAvatarState("error");
      setAvatarError("Network error. Try again.");
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
        body: JSON.stringify({ displayName, bio, homeCity }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setState("error");
        setError(parseApiError(body, "Couldn't save. Try again."));
        return;
      }

      const profile =
        body && typeof body === "object" ? (body as { profile?: ProfileRecord | null }).profile : null;
      if (profile) onSaved(profile);
      setState("saved");
    } catch {
      setState("error");
      setError("Network error. Try again.");
    }
  }

  return (
    <form className="profileEditor" onSubmit={handleSubmit} aria-label="Edit your profile">
      <div className="profileEditorField profileEditorAvatarField">
        <span className="profileEditorAvatarLabel" id="pe-avatar-label">
          Profile photo
        </span>
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
            <input
              ref={fileInputRef}
              id="pe-avatar-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="profileEditorAvatarFile"
              disabled={formBusy}
              aria-labelledby="pe-avatar-label"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadAvatar(file);
              }}
            />
            <button
              type="button"
              className="profileEditorAvatarUpload"
              disabled={formBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {avatarState === "uploading" ? "Uploading…" : "Choose photo"}
            </button>
            {avatarPreview ? (
              <button
                type="button"
                className="profileEditorAvatarRemove"
                disabled={formBusy}
                onClick={() => void removeAvatar()}
              >
                {avatarState === "removing" ? "Removing…" : "Remove photo"}
              </button>
            ) : null}
          </div>
        </div>
        {avatarError ? (
          <span className="profileEditorHint profileEditorStatusErr" role="status">
            {avatarError}
          </span>
        ) : null}
      </div>

      <div className="profileEditorField">
        <label htmlFor="pe-displayName">Display name</label>
        <input
          id="pe-displayName"
          type="text"
          value={displayName}
          maxLength={MAX_DISPLAY_NAME}
          autoComplete="off"
          disabled={formBusy}
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
          disabled={formBusy}
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
          disabled={formBusy}
          onChange={(e) => setHomeCity(e.target.value)}
        />
        <span className="profileEditorCount" aria-hidden="true">
          {homeCity.length}/{MAX_HOME_CITY}
        </span>
      </div>

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
