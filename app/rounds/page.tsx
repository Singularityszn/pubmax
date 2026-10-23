import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import RoundCodeJoin from "@/components/round/RoundCodeJoin";
import RoundStarter from "@/components/round/RoundStarter";
import Screen from "@/components/ui/screen";

import "./[code]/round.css";

// Branded entry for /rounds (no code): previously a bare Next 404 dead-end. A
// round is JOINED from a share link/code (/rounds/<code>), and STARTED here: the
// form is the screen's one primary, so "Start a round" is a real flow rather
// than a link to a map that never said what to do next. It needs no account,
// the starter takes a handle, so a signed-out visitor is never turned away.

export const metadata: Metadata = {
  title: "Rounds",
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
        {/* The start form IS the page: no card, no second title under the
            head. Its submit is the one primary; opening a code a mate read out
            is the quiet secondary under it (docs/design/LAUNCH_SCREENS.md). */}
        <RoundStarter primaryAction bare />
        <RoundCodeJoin />
      </Screen>
    </main>
  );
}
