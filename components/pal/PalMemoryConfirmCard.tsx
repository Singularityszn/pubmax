"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { AskProposal } from "@/lib/ask/types";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { confirmPalMemoryProposal } from "@/lib/palMemoryConfirmClient";

export type PalMemoryCard = Extract<AskProposal, { kind: "remember_memory" }>;

/** Speech can suggest this card. Only this person's tap can write it. */
export default function PalMemoryConfirmCard({ proposal, onDismiss, onConfirmed }: {
  proposal: PalMemoryCard; onDismiss: () => void; onConfirmed?: (value: string) => void;
}) {
  const { user, session } = useAuth();
  const [ownerId] = useState(user?.id ?? null);
  const currentOwner = useRef(user?.id ?? null);
  useLayoutEffect(() => { currentOwner.current = user?.id ?? null; }, [user?.id]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  if (!ownerId || user?.id !== ownerId) return null;
  const confirm = async () => {
    if (saving || saved) return;
    setSaving(true);
    setError("");
    const result = await confirmPalMemoryProposal(proposal, captureAccountAuth(ownerId, session));
    if (!mounted.current || currentOwner.current !== ownerId) return;
    setSaving(false);
    if (!result) return;
    if (!result.ok) { setError(result.error); return; }
    setSaved(true);
    onConfirmed?.(proposal.value);
  };
  return (
    <div className="palChatProposal">
      {saved ? <p role="status">{proposal.relation === "delete" ? "Forgotten" : "Saved"}: {proposal.value}</p> : <>
        <button type="button" className="palChatProposalConfirm pressable" disabled={saving} onClick={() => { void confirm(); }}>
          {saving ? "Saving…" : proposal.label}
          {proposal.relation === "update" && proposal.supersedesValue ? <span className="palChatProposalReplaces">Replaces: {proposal.supersedesValue}</span> : null}
        </button>
        <button type="button" className="palChatProposalDismiss pressable" disabled={saving} onClick={onDismiss}>Dismiss</button>
      </>}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
