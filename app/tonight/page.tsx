import type { Metadata } from "next";

import TonightClient from "./TonightClient";

// First-class "Tonight" screen. The client owns the PRIMARY What's-On spine
// (/api/whats-on — same as the map Tonight lane) and all interactivity; this
// server shell only carries route metadata.
export const metadata: Metadata = {
  title: "Tonight in London · PUBMAXXING",
  description:
    "What's on in London tonight — quiz, sport, deals, and live music from sourced listings. Same spine as the map. No invented nights.",
};

export default function TonightPage() {
  return <TonightClient />;
}
