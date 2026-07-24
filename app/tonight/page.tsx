import type { Metadata } from "next";

import { partyFace } from "@/app/fonts/partyFace";
import TonightClient from "./TonightClient";

// First-class "Tonight" screen. The client owns the PRIMARY What's-On spine
// (/api/whats-on — same as the map Tonight lane) and all interactivity; this
// server shell only carries route metadata.
export const metadata: Metadata = {
  title: "Tonight in London · PUBMAXXING",
  description:
    "What's on in London tonight. Quiz, sport, deals, and live music from sourced listings. Same spine as the map.",
  alternates: { canonical: "/tonight" },
};

export default function TonightPage() {
  // Scope the party accent to this route: the wrapper only sets --font-party
  // (display:contents adds no layout box; the custom property still inherits).
  return (
    <div className={partyFace.variable} style={{ display: "contents" }}>
      <TonightClient />
    </div>
  );
}
