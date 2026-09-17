import type { Metadata } from "next";
import Link from "next/link";

import EmptyState from "@/components/ui/empty-state";
import SiteNav from "@/components/nav/SiteNav";

import planStyles from "../Plan.module.css";

// Branded not-found for /plan/[id] — rendered when the page calls notFound() on
// a plan that's unknown OR expired. This is a SHARED-LINK surface (someone was
// sent this link), so a bare white Next 404 reads as broken. Same honest
// empty-state pattern as the crawls/rounds surfaces: a short line, a grounded
// explainer, and one route on — start your own night.

export const metadata: Metadata = {
  title: "Plan · PUBMAXXING",
  robots: { index: false, follow: false },
};

export default function PlanNotFound(): React.JSX.Element {
  return (
    <main id="main" className={`${planStyles.planPage} planPage--composer pageHidesCreateFab`}>
      {/* Standard site navigation — a shared plan link is many people's first
          screen; it must route onward, not dead-end on a wordmark. SiteNav
          carries the brand, so the masthead keeps just the context line. */}
      <SiteNav />
      <header className={planStyles.planPage__masthead}>
        <span>Plan</span>
        <span>London · Tonight</span>
      </header>

      <EmptyState
        title="This plan has closed"
        action={<Link prefetch={false} href="/plan">Start your own plan</Link>}
      >
        The link&rsquo;s expired, or the plan was never here. Ask whoever sent it
        for a fresh link, or put your own night in order and send one back.
      </EmptyState>
    </main>
  );
}
