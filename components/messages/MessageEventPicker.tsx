"use client";

// Choosing which plan to share, without leaving the thread.
//
// PASTE-ONLY, the Wanted lane's own idiom: a plan link or a plan id, read for
// its id and nothing else. Nothing is fetched here — what the message stores is
// the id, and the card is resolved on the read path from the plan's ANONYMOUS
// preview, so the composer has nothing to show that the bubble will not show
// better.
//
// A pasted address that carries no plan id is refused in the composer rather
// than at the server, because the reader is holding the thing that would fix
// it.

import { useEffect, useId, useRef, useState } from "react";

import {
  MESSAGE_EVENT_PICK_LABEL,
  MESSAGE_EVENT_PICK_PLACEHOLDER,
  readMessageEventPlanId,
} from "@/lib/messageAttachments";

/** The id out of `/plan/<id>`, a bare id, or null when there is neither. */
function readPlanIdFromPaste(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = readMessageEventPlanId(trimmed);
  if (direct) return direct;
  const match = trimmed.match(
    /plan\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return match ? readMessageEventPlanId(match[1]) : null;
}

export default function MessageEventPicker({
  onPick,
  onCancel,
}: {
  onPick: (planId: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fieldId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const planId = readPlanIdFromPaste(typed);
  const unreadable = typed.trim().length > 0 && !planId;

  return (
    <div className="composerVenuePicker">
      <label htmlFor={fieldId} className="composerVenueNote">
        {MESSAGE_EVENT_PICK_LABEL}
      </label>
      <input
        ref={inputRef}
        id={fieldId}
        type="text"
        className="composerVenueSearch"
        value={typed}
        placeholder={MESSAGE_EVENT_PICK_PLACEHOLDER}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === "Enter" && planId) {
            event.preventDefault();
            onPick(planId);
          }
        }}
      />
      {unreadable ? (
        <p className="composerVenueNote" role="status">
          That link has no plan in it. Copy the address from the plan itself.
        </p>
      ) : null}
      <div className="composerPickerActions">
        <button
          type="button"
          className="composerVenueResult"
          disabled={!planId}
          onClick={() => planId && onPick(planId)}
        >
          Share this plan
        </button>
        <button type="button" className="composerPendingRemove" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
