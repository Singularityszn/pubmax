import type { Metadata } from "next";

import PlanComposer from "@/components/plan/PlanComposer";
import SiteNav from "@/components/nav/SiteNav";

import "./plan.css";

export const metadata: Metadata = {
  title: "Sort the outing · PUBMAXXING",
  description: "Put the pubs in order, pick a time, and send one link to the crew.",
};

export default function NewPlanPage() {
  return (
    <main id="main" className="planPage planPage--composer">
      {/* Standard site navigation: /plan is a shared-link surface and must
          never be a dead end. The route's head (kicker, h1, the one primary
          action) is the describe-first Screen inside PlanComposer, so nothing
          is printed twice here. */}
      <SiteNav />
      <PlanComposer />
    </main>
  );
}
