"use client";

// Choosing whose handle to hand on, without leaving the thread.
//
// It takes a HANDLE and nothing else, through the one handle alphabet, because
// what the message stores is a handle and the card is resolved on the read
// path. Nothing is looked up here: whether that handle is somebody is the
// SERVER's question at send time, and answering it in the composer would make
// the picker an existence oracle for any handle anybody types.

import { useEffect, useId, useRef, useState } from "react";

import {
  MESSAGE_CONTACT_SEARCH_LABEL,
  MESSAGE_CONTACT_SEARCH_PLACEHOLDER,
} from "@/lib/messageAttachments";
import { normalizeHandle } from "@/lib/handleNormalize";

export default function MessageContactPicker({
  onPick,
  onCancel,
}: {
  onPick: (handle: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fieldId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handle = normalizeHandle(typed);

  return (
    <div className="composerVenuePicker">
      <label htmlFor={fieldId} className="composerVenueNote">
        {MESSAGE_CONTACT_SEARCH_LABEL}
      </label>
      <input
        ref={inputRef}
        id={fieldId}
        type="text"
        className="composerVenueSearch"
        value={typed}
        placeholder={MESSAGE_CONTACT_SEARCH_PLACEHOLDER}
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
          if (event.key === "Enter" && handle) {
            event.preventDefault();
            onPick(handle);
          }
        }}
      />
      <div className="composerPickerActions">
        <button
          type="button"
          className="composerVenueResult"
          disabled={!handle}
          onClick={() => handle && onPick(handle)}
        >
          {handle ? `Share @${handle}` : "Share a handle"}
        </button>
        <button type="button" className="composerPendingRemove" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
