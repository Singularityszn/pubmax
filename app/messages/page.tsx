import type { Metadata } from "next";

import MessagesInboxClient from "./MessagesInboxClient";

// Server shell for /messages so the route carries real metadata (the client
// component can't export it). Direct messages are private to the signed-in
// participant, so the inbox is noindex, follow:false.
export const metadata: Metadata = {
  title: "Messages",
  description: "Direct messages with the people you go out with. Signed-in only, and kept low-key.",
  robots: { index: false, follow: false },
};

export default function MessagesInboxPage(): React.JSX.Element {
  return <MessagesInboxClient />;
}
