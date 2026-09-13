import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";

import "./[code]/round.css";

// Branded entry for /rounds (no code): previously a bare Next 404 dead-end. A
// round is always JOINED from a share link/code (/rounds/<code>), so this
// surface explains that honestly. The one primary is where you start one.

export const metadata: Metadata = {
  title: "Rounds · PUBMAXXING",
  description: "Rounds are joined from a share link. Start one from the map.",
  robots: { index: false, follow: false },
};

export default function RoundsIndex(): React.JSX.Element {
  return (
    <main id="main" className="roundShell">
      <SiteNav />

      <Screen
        as="section"
        className="roundsIndexScreen"
        kicker="Rounds"
        title="Who bought the last round."
        titleId="rounds-title"
        primary={<Link prefetch={false} href="/map">Start a round</Link>}
      >
        <EmptyState title="Join with a link">
          A round opens from the link whoever started it sent you
          (pubmaxxing.com/rounds/…). Got a code? Add it to that link.
        </EmptyState>
      </Screen>
    </main>
  );
}
