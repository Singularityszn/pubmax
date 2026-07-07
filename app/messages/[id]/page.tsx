"use client";

import { use } from "react";

import MessageThread from "@/components/messages/MessageThread";
import SiteNav from "@/components/nav/SiteNav";

import "../messages.css";

// A single conversation's thread (PRD E4). Thin route shell: unwrap the route id
// and hand it to the client MessageThread, which owns the fetch + realtime/polling
// + composer. The thread reads the viewer's self-asserted handle and refetches
// through the participant-gated API, so a non-participant hitting this URL sees a
// friendly "not found" (never another pair's messages) — see the courtesy note in
// lib/messages.ts + migration 0019.

export default function MessageThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const { id } = use(params);
  return (
    <div className="lp messagesPage">
      <SiteNav />
      <main className="container messagesMain">
        <MessageThread conversationId={id} />
      </main>
    </div>
  );
}
