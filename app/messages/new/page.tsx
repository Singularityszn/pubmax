import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/nav/SiteNav";
import MessageRecipientSearch from "../MessageRecipientSearch";
import "../messages.css";

export const metadata: Metadata = {
  title: "New message",
  robots: { index: false, follow: false },
};

export default function NewMessagePage() {
  return <div className="lp messagesPage">
    <SiteNav />
    <main id="main" className="container messagesMain">
      <Link href="/messages">Back to messages</Link>
      <h1>New message</h1>
      <MessageRecipientSearch />
    </main>
  </div>;
}
