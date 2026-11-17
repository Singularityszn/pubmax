"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import type { ConversationDTO } from "@/lib/messages";
import "./messageArrivalNotice.css";

export default function MessageArrivalNotice({ conversation, onDismiss }: { conversation: ConversationDTO; onDismiss: () => void }): React.JSX.Element | null {
  const [allowed, setAllowed] = useState(false);
  const [interacting, setInteracting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void authedActionFetch(`/api/message-notifications?conversationId=${encodeURIComponent(conversation.id)}`, { signal: controller.signal }, { requiresIdentity: true })
      .then(async (response) => {
        if (!response.ok) return;
        const settings = await response.json() as { quiet?: boolean };
        if (!controller.signal.aborted && settings.quiet === false) setAllowed(true);
      }).catch(() => undefined);
    return () => controller.abort();
  }, [conversation.id]);
  useEffect(() => {
    if (!allowed || interacting) return;
    const timeout = setTimeout(onDismiss, 6_000);
    return () => clearTimeout(timeout);
  }, [allowed, interacting, onDismiss]);
  return <div className={allowed ? "messageArrival" : undefined} role="status" onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocus={() => setInteracting(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    {allowed ? <>
    <Link href={`/messages/${conversation.id}`} onClick={onDismiss}>New message <span>Open your conversation</span></Link>
    <button type="button" aria-label="Dismiss message notification" onClick={onDismiss}><X size={18} aria-hidden="true" /></button>
    </> : null}
  </div>;
}
