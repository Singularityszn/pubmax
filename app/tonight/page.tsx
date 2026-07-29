import type { Metadata } from "next";

import { partyFace } from "@/app/fonts/partyFace";
import { readTrustedHandoffFlags } from "@/lib/trustedHandoffFlags.server";
import TonightClient from "./TonightClient";

// First-class "Tonight" screen. The client owns the PRIMARY What's-On spine
// (/api/whats-on — same as the map Tonight lane) and all interactivity; this
// server shell only carries route metadata.
export const metadata: Metadata = {
  title: "Tonight in London · PUBMAXXING",
  description:
    "What's on in London tonight. Quiz, sport, deals, and live music from sourced listings. Open a listed venue on the map.",
  alternates: { canonical: "/tonight" },
};

export default function TonightPage() {
  // Server reads the trusted-handoff flags once; the client receives an immutable
  // DTO and never interprets env itself (contract 4.1). All-off keeps today's
  // Tonight behaviour byte-for-byte.
  const flags = readTrustedHandoffFlags();
  // Scope the party accent to this route: the wrapper only sets --font-party
  // (display:contents adds no layout box; the custom property still inherits).
  return (
    <div className={partyFace.variable} style={{ display: "contents" }}>
      <TonightClient flags={flags} />
    </div>
  );
}
