import type { Metadata } from "next";
import Link from "next/link";

import PlanComposer from "@/components/plan/PlanComposer";

import "./plan.css";

export const metadata: Metadata = {
  title: "Sort my night · PUBMAXXING",
  description: "Put the pubs in order, pick a time, and send one link to the crew.",
};

export default function NewPlanPage() {
  return (
    <main className="planPage planPage--composer">
      <header className="planPage__masthead">
        <Link href="/" className="planPage__brand">PUBMAXXING</Link>
        <span>London · Tonight</span>
      </header>
      <section className="planPage__intro">
        <p className="planPage__eyebrow">One link. No group-chat archaeology.</p>
        <h1>Put the night in order.</h1>
        <p>Choose the pubs, set the first-pint time, then send a Plan everyone can open and join without an account.</p>
      </section>
      <PlanComposer />
    </main>
  );
}
