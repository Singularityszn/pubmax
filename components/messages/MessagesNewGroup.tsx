"use client";

import { useCallback, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { normalizeHandle } from "@/lib/handleNormalize";
import { GROUP_CREATE_LABEL } from "@/lib/messageGroupThread";

import MessageRecipientDialog from "./MessageRecipientDialog";
import type { MessageRecipient } from "./useMessageRecipientSearch";

type PickerProps = {
  handle: string;
  onOpened: (conversationId: string) => void;
  open?: boolean;
  onClose?: () => void;
  allowDirect?: boolean;
  suggestedRecipients?: MessageRecipient[];
};

export default function MessagesNewGroup({
  handle,
  onOpened,
  open,
  onClose,
  allowDirect = false,
  suggestedRecipients = [],
}: PickerProps): React.JSX.Element | null {
  const { accountRevision } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const active = open ?? internalOpen;
  const viewer = normalizeHandle(handle);
  const close = useCallback(() => {
    setInternalOpen(false);
    onClose?.();
  }, [onClose]);
  const opened = (id: string) => {
    close();
    onOpened(id);
  };
  if (!active) {
    return open !== undefined ? null : (
      <div className="messagesNewGroupRow">
        <button
          type="button"
          className="messagesNewGroupOpen"
          aria-expanded={false}
          onClick={() => setInternalOpen(true)}
        >
          {allowDirect ? "New message" : GROUP_CREATE_LABEL}
        </button>
      </div>
    );
  }
  // Each account and opening gets its own ephemeral recipients and requests.
  return (
    <MessageRecipientDialog
      key={`${accountRevision}:${viewer}`}
      handle={viewer}
      onOpened={opened}
      onClose={close}
      allowDirect={allowDirect}
      suggestedRecipients={suggestedRecipients}
    />
  );
}
