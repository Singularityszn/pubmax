"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

import "./messageThreadActions.css";

/**
 * The one confirm a thread asks before it takes something away: unsending a
 * message, deleting a chat, leaving a group. Cancel takes focus first, so a
 * stray Enter never confirms. Escape and a tap on the backdrop cancel, except
 * while the request is in flight.
 */
export default function MessageConfirmDialog({
  title,
  line,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  line: string;
  confirmLabel: string;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const lineId = useId();
  useFocusTrap(true, cardRef);
  useDismissOnEscape(!busy, onCancel);
  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
  }, []);

  return createPortal(
    <div
      className="messageConfirmOverlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={cardRef}
        className="messageConfirmCard"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={lineId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="messageConfirmTitle">
          {title}
        </h2>
        <p id={lineId} className="messageConfirmLine">
          {line}
        </p>
        {error ? (
          <p className="messageConfirmError" role="alert">
            {error}
          </p>
        ) : null}
        <div className="messageConfirmActions">
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
