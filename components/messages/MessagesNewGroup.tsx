"use client";

// Starting a group thread, from the inbox.
//
// WHY HERE AND NOT ON A PROFILE. A DM starts from a person: you open their
// profile and tap Message. A group is not "with" one person, so there is no
// profile to start it from, and the inbox is the only surface that is about
// every thread rather than one of them.
//
// A GROUP IS OPENED WHOLE (docs/adr/0015-group-message-threads.md): the members
// are named up front, the caps come from `lib/messageGroupThread.ts` rather
// than being typed here, and every named handle has to be somebody — which is
// the SERVER's question, so this form asks it and prints the answer rather than
// looking anybody up as you type.

import Link from "next/link";
import { useCallback, useId, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  GROUP_CREATE_FAILED_LINE,
  GROUP_CREATE_HEADING,
  GROUP_CREATE_LABEL,
  GROUP_MEMBERS_HINT,
  GROUP_MEMBERS_LABEL,
  GROUP_MEMBERS_PLACEHOLDER,
  GROUP_OPENED_LINE,
  GROUP_TITLE_LABEL,
  GROUP_TITLE_MAX,
  GROUP_TITLE_PLACEHOLDER,
  GROUP_TOO_SMALL_LINE,
  normalizeGroupMembers,
} from "@/lib/messageGroupThread";
import { discardBody } from "@/lib/responseBody";

/** Handles as a person types them: commas, spaces, @s, any of it. */
function readTypedHandles(typed: string): string[] {
  return typed
    .split(/[\s,]+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

export default function MessagesNewGroup({
  handle,
  onOpened,
}: {
  handle: string;
  onOpened: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState("");
  const [title, setTitle] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  const participants = readTypedHandles(typed);
  // The SAME rule the server applies, asked here so the button can say whether
  // the list is a group yet. It decides nothing: the server re-derives it.
  const ready = normalizeGroupMembers(handle, participants) !== null;

  const create = useCallback(async () => {
    if (busy) return;
    if (!ready) {
      setError(GROUP_TOO_SMALL_LINE);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await authedActionFetch(
        "/api/messages",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "open-group",
            handle,
            participants,
            ...(title.trim() ? { title } : {}),
          }),
        },
        { requiresIdentity: true },
      );
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        setError(offlineOrMessage(errorMessageFrom(body, GROUP_CREATE_FAILED_LINE)));
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        conversationId?: unknown;
      } | null;
      const conversationId =
        typeof body?.conversationId === "string" ? body.conversationId : "";
      if (!conversationId) {
        discardBody(res);
        setError(GROUP_CREATE_FAILED_LINE);
        return;
      }
      setOpen(false);
      setTitle("");
      setTyped("");
      // NO REDIRECT. The group lands at the top of the inbox the reader is
      // already looking at, and one line names the door into it — so somebody
      // who meant to start two groups is not taken away after the first.
      setOpened(conversationId);
      onOpened();
    } catch {
      setError(offlineOrMessage(GROUP_CREATE_FAILED_LINE));
    } finally {
      setBusy(false);
    }
  }, [busy, handle, onOpened, participants, ready, title]);

  if (!open) {
    return (
      <div className="messagesNewGroupRow">
        <button
          type="button"
          className="messagesNewGroupOpen"
          onClick={() => {
            setOpened("");
            setOpen(true);
          }}
          aria-expanded={false}
        >
          {GROUP_CREATE_LABEL}
        </button>
        {opened ? (
          <Link
            className="messagesNewGroupOpened"
            href={`/messages/${encodeURIComponent(opened)}`}
          >
            {GROUP_OPENED_LINE}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <section className="messagesNewGroup" aria-label={GROUP_CREATE_HEADING}>
      <h2 className="messagesNewGroupHeading">{GROUP_CREATE_HEADING}</h2>

      <label className="messagesNewGroupLabel" htmlFor={`${fieldId}-title`}>
        {GROUP_TITLE_LABEL}
      </label>
      <input
        id={`${fieldId}-title`}
        type="text"
        className="messagesNewGroupField"
        value={title}
        maxLength={GROUP_TITLE_MAX}
        placeholder={GROUP_TITLE_PLACEHOLDER}
        onChange={(event) => setTitle(event.target.value)}
      />

      <label className="messagesNewGroupLabel" htmlFor={`${fieldId}-members`}>
        {GROUP_MEMBERS_LABEL}
      </label>
      <input
        id={`${fieldId}-members`}
        type="text"
        className="messagesNewGroupField"
        value={typed}
        placeholder={GROUP_MEMBERS_PLACEHOLDER}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={`${fieldId}-hint`}
        onChange={(event) => {
          setTyped(event.target.value);
          setError("");
        }}
      />
      <p id={`${fieldId}-hint`} className="messagesNewGroupHint">
        {GROUP_MEMBERS_HINT}
      </p>

      {error ? (
        <p className="messagesNewGroupError" role="alert">
          {error}
        </p>
      ) : null}

      <div className="messagesNewGroupActions">
        <button
          type="button"
          className="messagesNewGroupCreate"
          disabled={busy}
          aria-disabled={!ready}
          onClick={() => void create()}
        >
          {busy ? "Starting" : GROUP_CREATE_LABEL}
        </button>
        <button
          type="button"
          className="messagesNewGroupCancel"
          onClick={() => {
            setOpen(false);
            setError("");
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
