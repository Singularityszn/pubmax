import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";

import MessagesInboxClient from "./MessagesInboxClient";

import "./messages.css";

// Server shell for /messages so the route carries real metadata (the client
// component can't export it). Direct messages are private to the signed-in
// participant, so the inbox is noindex, follow:false.
export const metadata: Metadata = {
  title: "Messages",
  description: "Direct messages with the people you go out with. Signed-in only, and kept low-key.",
  robots: { index: false, follow: false },
};

export default function MessagesInboxPage(): React.JSX.Element {
  return (
    <div className="lp messagesPage">
      <SiteNav />
      <main className="container messagesMain messagesMainInbox">
        <div className="messagesSplit">
          <aside className="messagesInboxPane" aria-label="Inbox">
            <MessagesInboxClient />
          </aside>
          <section className="messagesThreadPane messagesThreadEmpty" aria-label="Conversation">
            <div>
              <p className="messagesThreadEyebrow">Your conversations</p>
              <h2>Pick a message</h2>
              <p>Choose someone from your inbox to read the thread and reply.</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
