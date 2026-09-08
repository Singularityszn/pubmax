"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import ProfileMessageButton from "@/components/messages/ProfileMessageButton";
import { normalizeHandle } from "@/lib/profiles";
import { discardBody } from "@/lib/responseBody";

type Match = { handle: string; displayName?: string };

export default function MessageRecipientSearch() {
  const { accountRevision } = useAuth();
  return <RecipientSearch key={accountRevision} />;
}

function RecipientSearch() {
  const { handle, identityResolved } = useAuth();
  const session = useViewerSession();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [status, setStatus] = useState("idle");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  if (session.unresolved) return <p role="status">Checking your account…</p>;
  if (session.signedOut) return <Button asChild><Link href="/login?mode=signin&from=%2Fmessages%2Fnew">Sign in to message</Link></Button>;
  if (!identityResolved) return <p role="status">Checking your account…</p>;
  if (!handle) return <Button asChild><Link href="/u/you">Claim a handle to message</Link></Button>;

  return (
    <section className="messageRecipientSection" aria-label="Find someone to message">
      <form onSubmit={async (event) => {
        event.preventDefault();
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        const q = normalizeHandle(query);
        setMatches([]);
        if (q.length < 2) { setStatus("short"); return; }
        setStatus("loading");
        try {
          const response = await fetch(`/api/profiles/search?q=${encodeURIComponent(q)}`, {
            cache: "no-store", signal: controller.signal,
          });
          if (!response.ok) {
            discardBody(response);
            throw new Error("search failed");
          }
          const body = await response.json() as { matches?: Match[] };
          if (controller.signal.aborted) return;
          setMatches((Array.isArray(body.matches) ? body.matches : []).filter(match => match.handle !== handle));
          setStatus("ready");
        } catch {
          if (!controller.signal.aborted) setStatus("error");
        }
      }}>
        <label htmlFor="message-recipient">Search handles</label>
        <div className="messageRecipientSearch">
          <input id="message-recipient" type="search" autoComplete="off" value={query}
            onChange={event => { request.current?.abort(); setQuery(event.target.value); setMatches([]); setStatus("idle"); }} />
          <Button type="submit">Search</Button>
        </div>
      </form>
      <p className="messageRecipientStatus" role="status">
        {status === "loading" ? "Searching…" : status === "error" ? "Could not search. Try again."
          : status === "short" ? "Enter at least two characters."
          : status === "ready" && matches.length === 0 ? "No matching handles." : ""}
      </p>
      <ul className="conversationList">
        {matches.map(match => <li className="messageRecipientRow" key={match.handle}>
          <Link className="messageRecipientIdentity" href={`/u/${encodeURIComponent(match.handle)}`}>{match.displayName ? <>{match.displayName}<span> @{match.handle}</span></> : `@${match.handle}`}</Link>
          <ProfileMessageButton targetHandle={match.handle} viewerHandle={handle} />
        </li>)}
      </ul>
    </section>
  );
}
