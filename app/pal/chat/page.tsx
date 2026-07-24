import type { Metadata } from "next";

import PalChat from "@/components/pal/PalChat";
import { readTrustedHandoffFlags } from "@/lib/trustedHandoffFlags.server";

export const metadata: Metadata = {
  title: "Ask your Pub Pal",
  description:
    "Ask in plain English and get grounded picks from what we have sourced. Every answer keeps its source; nothing is made up.",
};

// /pal/chat — a chat skin over the existing grounded concierge engine. Reachable
// by URL this cycle (nav entry is a follow-up, owned by Lane A). Reuses the
// durably rate-limited /api/concierge route; no new backend surface.
export default function PalChatPage() {
  // palHandoff off = existing Pal, byte-identical; on = gazetteer-grounded
  // locality copy + explicit acceptance handoff to Map (Trusted Handoff L16).
  const flags = readTrustedHandoffFlags();
  return <PalChat palHandoff={flags.palHandoff} />;
}
