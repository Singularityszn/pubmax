"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/authContext";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { authedActionJson } from "@/lib/authedFetch";
import { conversationRowName, type ConversationDTO } from "@/lib/messages";
import type { PubComparisonResultVenue } from "@/lib/pubComparison";
import { comparisonPoll, comparisonShareText } from "@/lib/pubComparisonPresentation";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";

function PrivatePoll({ venues, handle }: { venues: PubComparisonResultVenue[]; handle: string }) {
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const attemptsRef = useRef(new Map<string, string>());
  const poll = comparisonPoll(venues);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function load() {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setMessage("");
    try {
      const { response, body } = await authedActionJson<{ conversations?: ConversationDTO[]; status?: string; error?: string }>(
        `/api/messages?handle=${encodeURIComponent(handle)}`, { signal: controller.signal, cache: "no-store" }, { requiresIdentity: true });
      if (controller.signal.aborted) return;
      if (!response.ok || body.status !== "ready") {
        setMessage("Could not load your conversations. Try again.");
        return;
      }
      setConversations(body.conversations ?? []);
      setLoaded(true);
    } catch {
      if (!controller.signal.aborted) setMessage("Could not load your conversations. Try again.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  async function send() {
    if (!poll || !selected || !conversations.some((row) => row.id === selected) || controllerRef.current || sent) return;
    let clientMessageId = attemptsRef.current.get(selected);
    if (!clientMessageId) {
      if (!globalThis.crypto?.randomUUID) {
        setMessage("This browser cannot prepare a safe send. Open Messages to create your poll.");
        return;
      }
      clientMessageId = globalThis.crypto.randomUUID();
      attemptsRef.current.set(selected, clientMessageId);
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setMessage("");
    trackEvent("pub_comparison_poll_requested");
    try {
      const { response } = await authedActionJson<unknown>(`/api/messages/${encodeURIComponent(selected)}`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action: "send", handle, clientMessageId, poll,
          body: venues.map((venue, index) => `${index + 1}. ${PRODUCTION_SITE_ORIGIN}/ledger/${encodeURIComponent(venue.id)}`).join("\n"),
        }),
      }, { requiresIdentity: true });
      if (controller.signal.aborted) return;
      if (!response.ok) { setMessage("Could not send the poll. Try again or open Messages."); return; }
      setSent(true);
      setMessage("Poll sent. Open the conversation to see the answers.");
      trackEvent("pub_comparison_poll_sent");
    } catch {
      if (!controller.signal.aborted) setMessage("The send was not confirmed. Check the conversation before retrying.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  if (!poll) return null;
  return <div className="pubComparisonPoll">
    <h3>Ask your friends</h3>
    <p>{poll.question}</p>
    <ul>{poll.options.map((option) => <li key={option}>{option}</li>)}</ul>
    <p>The poll includes these public pub links. It does not include your order or meeting point.</p>
    {!loaded ? <Button variant="secondary" type="button" disabled={busy} onClick={() => void load()}>Load my conversations</Button>
      : conversations.length === 0 ? <p>No conversations are available. <Link href="/messages">Open Messages</Link> to start one.</p>
        : <>
          <label htmlFor="comparison-conversation">Send to</label>
          <select id="comparison-conversation" value={selected} disabled={busy || sent} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Choose a conversation</option>
            {conversations.map((row) => <option key={row.id} value={row.id}>{conversationRowName(row, handle)}</option>)}
          </select>
          <Button variant="secondary" type="button" disabled={!selected || busy || sent} onClick={() => void send()}>{busy ? "Sending…" : "Send this poll"}</Button>
        </>}
    {message ? <p role="status">{message}</p> : null}
    {selected ? <Link href={`/messages/${encodeURIComponent(selected)}`}>Open the conversation</Link> : null}
  </div>;
}

export default function PubComparisonShare({ venues }: { venues: PubComparisonResultVenue[] }) {
  const { user, handle, accountRevision } = useAuth();
  const session = useViewerSession();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const text = comparisonShareText(venues);

  async function share(copy: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    trackEvent("pub_comparison_share_requested");
    try {
      if (!copy && navigator.share) {
        await navigator.share({ title: "Choose a pub together", text });
        setMessage("The share sheet closed. PUBMAXX cannot tell whether anyone received the link.");
      } else {
        await navigator.clipboard.writeText(text);
        setMessage("Pub links copied. You can paste them into a message.");
        trackEvent("pub_comparison_links_copied");
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) setMessage("Could not share automatically. Select and copy the text below.");
    } finally { setBusy(false); }
  }

  return <section className="pubComparisonShare" aria-labelledby="comparison-share-title">
    <h2 id="comparison-share-title">Choose with friends</h2>
    <p>Review what you share. Your order, totals and meeting point stay out of this message.</p>
    <textarea aria-label="Pub links to share" readOnly value={text} rows={8} />
    <div className="pubComparisonActions">
      <Button variant="secondary" type="button" disabled={busy} onClick={() => void share(false)}>Share pub links</Button>
      <Button variant="secondary" type="button" disabled={busy} onClick={() => void share(true)}>Copy pub links</Button>
    </div>
    {message ? <p role="status">{message}</p> : null}
    {session.signedIn && user && handle ? <PrivatePoll key={`${accountRevision}:${user.id}:${handle}`} venues={venues} handle={handle} /> : null}
    {/* Only an answered session that named nobody may invite a sign-in. */}
    {session.signedOut ? <p><Link href="/login?from=%2Ftools">Sign in</Link> to send a private poll. You can compare and share pub links without an account.</p> : null}
  </section>;
}
