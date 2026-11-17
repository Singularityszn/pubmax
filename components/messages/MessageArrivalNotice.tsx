"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { authedActionFetch } from "@/lib/authedFetch";
import type { ConversationDTO } from "@/lib/messages";
import "./messageArrivalNotice.css";

export default function MessageArrivalNotice({ conversation, onDismiss, inbox = false, currentPath = "" }: { conversation: ConversationDTO; onDismiss: () => void; inbox?: boolean; currentPath?: string }): React.JSX.Element | null {
  const noticeRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) setHost(document.body); });
    return () => { active = false; };
  }, []);
  const [interacting, setInteracting] = useState(false);
  useEffect(() => {
    if (!host) return;
    const controller = new AbortController();
    void authedActionFetch(`/api/message-notifications?conversationId=${encodeURIComponent(conversation.id)}`, { signal: controller.signal }, { requiresIdentity: true })
      .then(async (response) => {
        if (!response.ok) return;
        const settings = await response.json() as { quiet?: boolean };
        if (!controller.signal.aborted && settings.quiet === false) setAllowed(true);
      }).catch(() => undefined);
    return () => controller.abort();
  }, [host, conversation.id]);
  useEffect(() => {
    if (!allowed || interacting) return;
    const timeout = setTimeout(onDismiss, 6_000);
    return () => clearTimeout(timeout);
  }, [allowed, interacting, onDismiss]);
  useLayoutEffect(() => {
    if (!host || !allowed || inbox) return;
    const notice = noticeRef.current;
    const header = document.querySelector<HTMLElement>(".threadHeader");
    if (!notice || !header) return;
    const measure = () => {
      const bounds = header.getBoundingClientRect();
      notice.style.setProperty("--message-thread-notice-top", `${bounds.height > 0 ? Math.max(0, bounds.bottom + 12) : 0}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [host, allowed, inbox, currentPath]);
  const destination = conversation.kind === "group"
    ? conversation.title || "your group"
    : conversation.otherDisplayName || `@${conversation.otherHandle}`;
  if (!host) return null;
  return createPortal(<div ref={noticeRef} className={allowed ? `messageArrival${inbox ? " messageArrival--inbox" : ""}` : undefined} role="status" onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocus={() => setInteracting(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    {allowed ? <>
    <Link href={`/messages/${conversation.id}`} onClick={onDismiss}>New message <span>{destination}</span></Link>
    <button type="button" aria-label="Dismiss message notification" onClick={onDismiss}><X size={18} aria-hidden="true" /></button>
    </> : null}
  </div>, host);
}
