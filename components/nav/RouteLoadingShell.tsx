// This route shell uses RouteHeldFrame's default screen outline.
// TabHopHeldFrame uses the same component with a destination-specific shape.
//
// A named region, never a <main>. On a document load React streams the real
// page, <main> and all, into a hidden segment and swaps it in up to 300 ms
// later, so a skeleton <main> made two <main> elements in one document for
// that window. The skeleton stands in for the page; the page owns the landmark.

import PubQuizCard from "@/components/nav/PubQuizCard";
import RouteHeldFrame from "@/components/nav/RouteHeldFrame";
import SiteNav from "@/components/nav/SiteNav";
import PintLoader from "@/components/ui/pint-loader";
import type { PubQuizQuestion } from "@/lib/pubQuiz";


type RouteLoadingShellProps = {
  /** Short status label for AT + quiet on-screen copy (e.g. "Tonight"). */
  label: string;
  /** Optional question to read while the route arrives (lib/pubQuiz.server.ts). */
  quiz?: PubQuizQuestion | null;
};

export default function RouteLoadingShell({ label, quiz }: RouteLoadingShellProps) {
  return (
    <section
      id="main"
      className="routeLoadingShell"
      aria-busy="true"
      aria-live="polite"
      aria-label={`Loading ${label}`}
    >
      <SiteNav />
      <RouteHeldFrame />
      <div className="routeLoadingShellInner">
        {/* With the wild switch on the glass pours a stout: a whole page is a
            slower pint than the map's first prices (components/wild/PourLoader.tsx). */}
        <PintLoader className="routeLoadingShellLabel" label={label} labelSize="quiet" pour="stout" />
        {quiz ? <PubQuizCard quiz={quiz} /> : null}
      </div>
    </section>
  );
}
