import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import RoundStarter from "@/components/round/RoundStarter";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";

import "./[code]/round.css";

// Branded entry for /rounds (no code): previously a bare Next 404 dead-end. A
// round is JOINED from a share link/code (/rounds/<code>), and STARTED here: the
// form is the screen's one primary, so "Start a round" is a real flow rather
// than a link to a map that never said what to do next. It needs no account,
// the starter takes a handle, so a signed-out visitor is never turned away.

export const metadata: Metadata = {
  title: "Rounds · PUBMAXXING",
  description: "Start a round and share the code, or join one from a share link.",
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
      >
        <RoundStarter primaryAction />
        <EmptyState title="Join with a link">
          A round opens from the link whoever started it sent you
          (pubmaxxing.com/rounds/…). Got a code? Add it to that link.
        </EmptyState>
      </Screen>
    </main>
  );
}
