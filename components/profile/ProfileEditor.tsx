"use client";

import { useState } from "react";

import type { ProfileRecord } from "@/lib/profileStore";

// Inline "edit my profile" form for the owner of a handle. The page mounts this
// only when the viewer's own handle matches the route handle — so this stays
// dumb about who is allowed to edit; the page owns that gate. It PATCHes the
// editable fields to /api/profiles/[handle], mirrors the SERVER's caps for
// instant feedback (the server is still the trust boundary — see the route),
// and reports the saved row back up so the page can update the header
// optimistically. React 19: every setState here runs in an event handler.
//
// DEMO-TRUST NOTE: identity is the self-asserted handle (localStorage
// `pubmax_handle`), not a verified account. Anyone who has claimed a handle can
// edit its profile — acceptable for the demo; real ownership arrives with
// Supabase Auth (auth.uid() -> profiles.user_id), when this form will require a
// signed-in session.

// Caps mirror the server (app/api/profiles/[handle]/route.ts). Kept here purely
// for UX (live counters, an early avatar hint) — never as the source of truth.
const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 280;
const MAX_HOME_CITY = 60;
const MAX_AVATAR_URL = 400;

type SaveState = "idle" | "saving" | "saved" | "error";

type ProfileEditorProps = {
  handle: string;
  // The currently-displayed values, so the form opens pre-filled with whatever
  // the visitor sees (durable row overlaid on the synthesized identity).
  initial: {
    displayName?: string;
    bio?: string;
    homeCity?: string;
    avatarUrl?: string;
  };
  onSaved: (profile: ProfileRecord) => void;
  onClose: () => void;
};

// Client-side avatar hint — must be an http(s) URL within the cap, or blank.
// Blank is allowed (it clears the avatar). Not a security boundary; the server
// re-validates and is authoritative.
function avatarHint(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_AVATAR_URL) return "That URL is too long.";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Use an http(s) image URL.";
    }
  } catch {
    return "That doesn't look like a URL.";
  }
  return null;
}

export default function ProfileEditor({ handle, initial, onSaved, onClose }: ProfileEditorProps) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [homeCity, setHomeCity] = useState(initial.homeCity ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const localAvatarHint = avatarHint(avatarUrl);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving") return;

    // Cheap client-side gate so an obviously-bad avatar never round-trips.
    if (localAvatarHint) {
      setState("error");
      setError(localAvatarHint);
      return;
    }

    setState("saving");
    setError(null);

    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Send all four fields (an empty string clears a field server-side).
        body: JSON.stringify({ displayName, bio, homeCity, avatarUrl }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          body &&
          typeof body === "object" &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "Couldn't save. Try again.";
        setState("error");
        setError(message);
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

      <div className="profileEditorField">
        <label htmlFor="pe-avatarUrl">Avatar image URL</label>
        <input
          id="pe-avatarUrl"
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={avatarUrl}
          maxLength={MAX_AVATAR_URL}
          autoComplete="off"
          aria-invalid={localAvatarHint ? true : undefined}
          aria-describedby={localAvatarHint ? "pe-avatarHint" : undefined}
          onChange={(e) => setAvatarUrl(e.target.value)}
        />
        {localAvatarHint ? (
          <span className="profileEditorHint" id="pe-avatarHint">
            {localAvatarHint}
          </span>
        ) : null}
      </div>

      <div className="profileEditorActions">
        <button type="submit" className="profileEditorSave" disabled={state === "saving"}>
          {state === "saving" ? "Saving…" : "Save profile"}
        </button>
        <button
          type="button"
          className="profileEditorCancel"
          onClick={onClose}
          disabled={state === "saving"}
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
