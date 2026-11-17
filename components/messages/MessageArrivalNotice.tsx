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
    const notice = noticeRef.current;
    if (!notice) return;
    const reset = () => { for (const property of ["top", "inset-inline-start", "inset-inline-end", "margin-inline"]) notice.style.removeProperty(property); };
    reset();
    if (!host || !allowed || inbox) return;
    const header = document.querySelector<HTMLElement>(".threadHeader");
    if (!header) return;
    const pane = header.closest<HTMLElement>(".messagesThreadPane");
    const measure = () => {
      const bounds = header.getBoundingClientRect();
      if (bounds.height <= 0) { reset(); return; }
      const frame = (pane ?? header).getBoundingClientRect();
      const width = notice.getBoundingClientRect().width;
      const left = Math.max(16, Math.min(innerWidth - width - 16, frame.x + frame.width / 2 - width / 2));
      const values = { top: `${Math.max(0, bounds.bottom + 12)}px`, "inset-inline-start": `${left}px`, "inset-inline-end": "auto", "margin-inline": "0px" };
      for (const [property, value] of Object.entries(values)) if (notice.style.getPropertyValue(property) !== value) notice.style.setProperty(property, value);
    };
    let frame: number | null = null;
    const onScroll = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; measure(); }); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (pane) observer.observe(pane);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", onScroll, true); if (frame !== null) cancelAnimationFrame(frame); reset(); };
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
