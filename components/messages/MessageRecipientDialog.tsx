"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { HANDLE_MAX } from "@/lib/handleNormalize";
import { useKeyboardInset } from "@/lib/keyboardInset";
import {
  GROUP_CREATE_HEADING,
  GROUP_MAX_MEMBERS,
  GROUP_TITLE_LABEL,
  GROUP_TITLE_MAX,
  GROUP_TITLE_PLACEHOLDER,
} from "@/lib/messageGroupThread";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { discardBody } from "@/lib/responseBody";

import MessageAvatar from "./MessageAvatar";
import {
  recipientRows,
  useMessageRecipientSearch,
  type MessageRecipient,
} from "./useMessageRecipientSearch";

const OPEN_FAILURE = "Couldn't start that conversation. Try again.";
const MAX_RECIPIENTS = GROUP_MAX_MEMBERS - 1;

type DialogProps = {
  handle: string;
  onOpened: (conversationId: string) => void;
  onClose: () => void;
  allowDirect: boolean;
  suggestedRecipients: MessageRecipient[];
};

function RecipientResults({ rows, selected, busy, onToggle }: {
  rows: MessageRecipient[];
  selected: MessageRecipient[];
  busy: boolean;
  onToggle: (recipient: MessageRecipient) => void;
}) {
  return (
    <div className="messagesNewGroupResults" aria-label="People">
      {rows.map((person) => {
        const chosen = selected.some((recipient) => recipient.handle === person.handle);
        return (
          <button
            key={person.handle}
            type="button"
            className="messagesNewGroupResult"
            aria-label={`${chosen ? "Remove" : "Add"} @${person.handle}`}
            aria-pressed={chosen}
            disabled={busy || (!chosen && selected.length >= MAX_RECIPIENTS)}
            onClick={() => onToggle(person)}
          >
            <MessageAvatar handle={person.handle} avatarUrl={person.avatarUrl} />
            <span className="messagesNewGroupResultText">
              <span className="messagesNewGroupResultName">
                {person.displayName || `@${person.handle}`}
              </span>
              <span className="messagesNewGroupResultHandle">@{person.handle}</span>
            </span>
            <span className="messagesNewGroupResultCheck" aria-hidden="true">
              {chosen ? "✓" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SearchStatus({ status, error, count, hasSuggestions, onRetry }: {
  status: string;
  error: string;
  count: number;
  hasSuggestions: boolean;
  onRetry: () => void;
}) {
  if (status === "error") return (
    <div className="messagesNewGroupStatus">
      <p role="alert">{error}</p>
      <button type="button" className="messagesNewGroupRetry" onClick={onRetry}>
        Retry search
      </button>
    </div>
  );
  const line = status === "loading" ? "Searching people" :
    status === "ready" && count === 0 ? "No people found. Try another handle." :
      status === "idle" && !hasSuggestions ? "Type at least two characters of a handle." : "";
  return <p className="messagesNewGroupStatus" role="status">{line}</p>;
}

export default function MessageRecipientDialog({
  handle, onOpened, onClose, allowDirect, suggestedRecipients,
}: DialogProps) {
  const [selected, setSelected] = useState<MessageRecipient[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Capture before the input's autofocus, so closing restores the compose door.
  const [focusOrigin] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ?
      document.activeElement : null);
  const focusOriginRef = useRef(focusOrigin);
  const dialogRef = useRef<HTMLElement | null>(null);
  const searchFieldRef = useRef<HTMLInputElement | null>(null);
  const createRef = useRef<AbortController | null>(null);
  const liveRef = useRef(true);
  const fieldId = useId();
  const keyboardInset = useKeyboardInset();
  const search = useMessageRecipientSearch(handle);
  useFocusTrap(true, dialogRef, "strict-modal", focusOriginRef);

  useLayoutEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      createRef.current?.abort();
    };
  }, []);

  const close = () => {
    liveRef.current = false;
    search.abort();
    createRef.current?.abort();
    onClose();
  };
  const toggle = (person: MessageRecipient) => {
    if (busy) return;
    const wasSelected = selected.some((recipient) => recipient.handle === person.handle);
    if (!wasSelected && selected.length >= MAX_RECIPIENTS) return;
    setError("");
    setSelected((current) => {
      if (wasSelected) {
        return current.filter((recipient) => recipient.handle !== person.handle);
      }
      if (current.some((recipient) => recipient.handle === person.handle)) return current;
      return current.length < MAX_RECIPIENTS ? [...current, person] : current;
    });
    if (!wasSelected) search.changeQuery("");
    searchFieldRef.current?.focus();
  };
  const group = selected.length >= 2;
  const ready = Boolean(handle) && (group || (allowDirect && selected.length === 1));

  async function create() {
    if (!ready || createRef.current || !liveRef.current) return;
    const [onlyRecipient] = selected;
    const payload = group ? {
      action: "open-group",
      handle,
      participants: selected.map((person) => person.handle),
      ...(title.trim() ? { title: title.trim() } : {}),
    } : onlyRecipient ? { action: "open", handle, other: onlyRecipient.handle } : null;
    if (!payload) return;
    const controller = new AbortController();
    createRef.current = controller;
    const current = () => liveRef.current && !controller.signal.aborted;
    setBusy(true);
    setError("");
    try {
      const response = await authedActionFetch("/api/messages", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }, { requiresIdentity: true });
      if (!current()) {
        discardBody(response);
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) {
        setError(offlineOrMessage(errorMessageFrom(body, OPEN_FAILURE)));
        return;
      }
      const id = body && typeof body === "object" ?
        (body as { conversationId?: unknown }).conversationId : null;
      if (typeof id !== "string" || !id.trim()) {
        setError(OPEN_FAILURE);
        return;
      }
      liveRef.current = false;
      search.abort();
      onOpened(id);
    } catch {
      if (current()) setError(offlineOrMessage(OPEN_FAILURE));
    } finally {
      if (createRef.current === controller) createRef.current = null;
      if (current()) setBusy(false);
    }
  }

  const rows = search.status === "idle" ?
    recipientRows(suggestedRecipients, handle).filter((person) =>
      person.handle.startsWith(search.prefix)) : search.matches;

  return (
    <div
      className="messagesNewGroupBackdrop"
      style={{ "--message-picker-keyboard-inset": `${keyboardInset}px` } as React.CSSProperties}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={dialogRef}
        className="messagesNewGroup"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-heading`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <header className="messagesNewGroupHeader">
          <h2 id={`${fieldId}-heading`} className="messagesNewGroupHeading">
            {allowDirect ? "New message" : GROUP_CREATE_HEADING}
          </h2>
          <button type="button" className="messagesNewGroupClose"
            aria-label="Close new message" onClick={close}>×</button>
        </header>
        <label className="messagesNewGroupLabel" htmlFor={`${fieldId}-search`}>
          Search people
        </label>
        <input
          ref={searchFieldRef}
          id={`${fieldId}-search`}
          className="messagesNewGroupField"
          type="text"
          value={search.query}
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={HANDLE_MAX}
          placeholder="Search by handle"
          onChange={(event) => search.changeQuery(event.target.value)}
        />
        <div className="messagesNewGroupRecipients" aria-label="Selected people">
          {selected.map((person) => (
            <span className="messagesNewGroupChip" key={person.handle}>
              @{person.handle}
              <button type="button" className="messagesNewGroupChipRemove"
                aria-label={`Remove @${person.handle}`} disabled={busy}
                onClick={() => toggle(person)}>×</button>
            </span>
          ))}
        </div>
        <p className="messagesNewGroupHint">
          {selected.length >= MAX_RECIPIENTS ? "Eleven people selected. Remove someone to add another." :
            allowDirect ? "Choose someone to chat, or several people for a group." :
              "Choose at least two people for your group."}
        </p>
        <SearchStatus status={search.status} error={search.error} count={rows.length}
          hasSuggestions={rows.length > 0} onRetry={search.retry} />
        <RecipientResults rows={rows} selected={selected} busy={busy} onToggle={toggle} />
        {group || !allowDirect ? (
          <>
            <label className="messagesNewGroupLabel" htmlFor={`${fieldId}-title`}>
              {GROUP_TITLE_LABEL}
            </label>
            <input id={`${fieldId}-title`} type="text" className="messagesNewGroupField"
              value={title} maxLength={GROUP_TITLE_MAX} placeholder={GROUP_TITLE_PLACEHOLDER}
              disabled={busy} onChange={(event) => setTitle(event.target.value)} />
          </>
        ) : null}
        {error ? <p className="messagesNewGroupError" role="alert">{error}</p> : null}
        <div className="messagesNewGroupActions">
          <button type="button" className="messagesNewGroupCreate" disabled={!ready || busy}
            onClick={() => void create()}>
            {busy ? "Starting" : group || !allowDirect ? "Create group" : "Chat"}
          </button>
          <button type="button" className="messagesNewGroupCancel" onClick={close}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
