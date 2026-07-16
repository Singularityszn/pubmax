import type { Metadata } from "next";

import TonightClient from "./TonightClient";

// First-class "Tonight" screen (Wave A · A2). The client component owns the
// live CityMCP `things_to_do` fetch and all interactivity; this server shell
// only carries route metadata.
export const metadata: Metadata = {
  title: "Tonight in London · PUBMAXXING",
  description:
    "What's on in London tonight — a grounded, upstream-sourced read via CityMCP London. No invented listings.",
  alternates: { canonical: "/tonight" },
};

export default function TonightPage() {
  return <TonightClient />;
}
