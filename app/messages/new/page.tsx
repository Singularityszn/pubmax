import type { Metadata } from "next";
import Link from "next/link";
import Screen from "@/components/ui/screen";
import { Button } from "@/components/ui/button";
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
    <main id="main" className="container messagesMain messagesMainRecipient">
      <div id="message-recipient-arrival" className="messageRecipientArrival" />
      <Button asChild variant="ghost" className="messageRecipientBack">
        <Link href="/messages">Back to messages</Link>
      </Button>
      <Screen title="New message" titleId="message-recipient-title" className="messagesScreen">
        <MessageRecipientSearch />
      </Screen>
    </main>
  </div>;
}
