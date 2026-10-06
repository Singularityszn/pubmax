"use client";

// What the owner may do to a Wanted row they saved: open the link they kept,
// correct their note, and take the row off the list. A list a person can only
// add to turns every slip (a wrong pub, a stale note) into clutter they keep.
//
// The link is the owner's own provenance and opens in a new tab on their say-so.
// Nothing here fetches it: the panel's promise that PUBMAXX never reads an
// Instagram or TikTok page is about the server, and a plain anchor keeps it.

import { useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  cleanWantedNote,
  MAX_WANTED_NOTE,
  wantedLinkHost,
  wantedLinkHref,
  type WantedDTO,
} from "@/lib/wanted";

type Props = {
  wanted: WantedDTO;
  /** The note was saved: the row as the server now holds it. */
  onChanged: (wanted: WantedDTO) => void;
  /** The row was removed. */
  onRemoved: (id: string) => void;
};

export default function WantedRowManage({ wanted, onChanged, onRemoved }: Props): React.JSX.Element | null {
  const href = wantedLinkHref(wanted.sourceUrl);
  const host = wantedLinkHost(wanted.sourceUrl);
  const name = wanted.venueName || "this place";
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(wanted.note);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>): Promise<Response | null> {
    try {
      return await authedActionFetch("/api/wanted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }, { requiresIdentity: true });
    } catch {
      return null;
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    const res = await post({ action: "note", id: wanted.id, note: cleanWantedNote(note) });
    const body = res ? ((await res.json().catch(() => null)) as { wanted?: WantedDTO; error?: unknown } | null) : null;
    setBusy(null);
    if (!res || !res.ok || !body?.wanted) {
      setError(offlineOrMessage(errorMessageFrom(body ?? {}, "Could not save that note. Try again.")));
      return;
    }
    setEditing(false);
    onChanged(body.wanted);
  }

  async function remove() {
    if (!window.confirm(`Take ${name} off your Wanted list?`)) return;
    setBusy("remove");
    setError(null);
    const res = await post({ action: "delete", id: wanted.id });
    setBusy(null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      setError(offlineOrMessage(errorMessageFrom(body, "Could not remove that. Try again.")));
      return;
    }
    onRemoved(wanted.id);
  }

  return (
    <div className="wantedRow__manage">
      {editing ? (
        <div className="wantedRow__noteEdit">
          <label className="wantedRow__noteLabel" htmlFor={`wanted-note-${wanted.id}`}>
            Note for {name}
          </label>
          <input
            id={`wanted-note-${wanted.id}`}
            type="text"
            className="wantedCapture__note"
            value={note}
            maxLength={MAX_WANTED_NOTE}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy !== null}
          />
          <div className="wantedRow__buttons">
            <button
              type="button"
              className="wantedRow__button wantedRow__button--primary"
              onClick={() => void save()}
              disabled={busy !== null}
            >
              {busy === "save" ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              className="wantedRow__button"
              onClick={() => setEditing(false)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="wantedRow__buttons">
          {href ? (
            <a
              className="wantedRow__button"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open saved link{host ? ` (${host})` : ""}
            </a>
          ) : null}
          <button
            type="button"
            className="wantedRow__button"
            onClick={() => {
              setNote(wanted.note);
              setError(null);
              setEditing(true);
            }}
            disabled={busy !== null}
            aria-label={`Edit the note on ${name}`}
          >
            {wanted.note ? "Edit note" : "Add a note"}
          </button>
          <button
            type="button"
            className="wantedRow__button"
            onClick={() => void remove()}
            disabled={busy !== null}
            aria-label={`Remove ${name} from your Wanted list`}
          >
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        </div>
      )}
      {error ? (
        <p className="wantedCapture__status" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
