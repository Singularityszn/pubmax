// Instant held frame while a primary-tab route's RSC/client tree arrives.
// Same paper/ink tokens as the real pages — no design change, just a skeleton
// so cold tab taps paint something within the transition budget.
//
// A named region, never a <main>. On a document load React streams the real
// page, <main> and all, into a hidden segment and swaps it in up to 300 ms
// later, so a skeleton <main> made two <main> elements in one document for
// that window. The skeleton stands in for the page; the page owns the landmark.

import SiteNav from "@/components/nav/SiteNav";
import PintLoader from "@/components/ui/pint-loader";

import "./mobileNav.css";

type RouteLoadingShellProps = {
  /** Short status label for AT + quiet on-screen copy (e.g. "Tonight"). */
  label: string;
};

export default function RouteLoadingShell({ label }: RouteLoadingShellProps) {
  return (
    <section
      id="main"
      className="routeLoadingShell"
      aria-busy="true"
      aria-live="polite"
      aria-label={`Loading ${label}`}
    >
      <SiteNav />
      <div className="routeLoadingShellInner">
        <span className="routeLoadingShellBar" aria-hidden="true" />
        <span className="routeLoadingShellBar routeLoadingShellBar--short" aria-hidden="true" />
        <span className="routeLoadingShellCard" aria-hidden="true" />
        <span className="routeLoadingShellCard" aria-hidden="true" />
        <PintLoader className="routeLoadingShellLabel" label={label} labelSize="quiet" />
      </div>
    </section>
  );
}
