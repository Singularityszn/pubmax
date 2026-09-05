import type { Metadata } from "next";

import PalChat from "@/components/pal/PalChat";

export const metadata: Metadata = {
  title: "Ask your Pub Pal",
  description:
    "Ask for pub picks and what's on. Pub and event picks show their source.",
};

// /pal/chat — a chat skin over the existing grounded concierge engine. Reachable
// by URL this cycle (nav entry is a follow-up, owned by Lane A). Reuses the
// durably rate-limited /api/ask route; no new backend surface.
export default function PalChatPage() {
  return <PalChat />;
}
