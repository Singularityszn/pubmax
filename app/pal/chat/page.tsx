import type { Metadata } from "next";

import PalChat from "@/components/pal/PalChat";

export const metadata: Metadata = {
  title: "Ask your Pub Pal",
  description:
    "Ask for pub picks and what's on. Pub and event picks show their source.",
};

// /pal/chat — chat skin over `/api/pub-pal/chat` (ADR 0014). Reachable by URL
// this cycle (nav entry is a follow-up, owned by Lane A).
export default function PalChatPage() {
  return <PalChat />;
}
