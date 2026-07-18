import type { Metadata } from "next";

import PalChat from "@/components/pal/PalChat";

export const metadata: Metadata = {
  title: "Ask your Pub Pal",
  description:
    "Ask in plain English and get grounded picks from what we have sourced. Every answer keeps its source; nothing is made up.",
};

// /pal/chat — a chat skin over the existing grounded concierge engine. Reachable
// by URL this cycle (nav entry is a follow-up, owned by Lane A). Reuses the
// durably rate-limited /api/concierge route; no new backend surface.
export default function PalChatPage() {
  return <PalChat />;
}
