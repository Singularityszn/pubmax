import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import PlanCrew from "@/components/plan/PlanCrew";
import PlanSummary from "@/components/plan/PlanSummary";
import { shareCopyForPlan } from "@/components/plan/planPresentation";
import ShareBar from "@/components/share/ShareBar";
import { planStore } from "@/lib/planStore";

import "../plan.css";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const state = await planStore().get(id);
  if (!state) return { title: "Plan not found · PUBMAXXING" };
  const description = shareCopyForPlan(state);
  return {
    title: `${state.plan.title} · PUBMAXXING`,
    description,
    openGraph: {
      title: state.plan.title,
      description,
      type: "website",
      url: `/plan/${id}`,
      images: [{ url: `/api/plan-card?id=${encodeURIComponent(id)}`, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: state.plan.title, description, images: [`/api/plan-card?id=${encodeURIComponent(id)}`] },
  };
}

export default async function PlanPage({ params }: Props) {
  const { id } = await params;
  const state = await planStore().get(id);
  if (!state) notFound();
  const shareText = shareCopyForPlan(state);

  return (
    <main className="planPage">
      <header className="planPage__masthead">
        <Link href="/" className="planPage__brand">PUBMAXXING</Link>
        <Link href="/plan">Make another plan</Link>
      </header>
      <section className="planPage__hero">
        <p className="planPage__eyebrow">Your night is sorted</p>
        <h1>{state.plan.title}</h1>
        <p>{state.stops.length} {state.stops.length === 1 ? "pub" : "pubs"}, one link, zero account walls.</p>
      </section>
      <div className="planPage__grid">
        <PlanSummary planId={id} state={state} />
        <aside className="planPage__side">
          <PlanCrew planId={id} initialCrew={state.crew} />
          <section className="planShare" aria-labelledby="plan-share-title">
            <p className="planPage__eyebrow">Send the invite</p>
            <h2 id="plan-share-title">Get everyone on the same page</h2>
            <p>The link opens straight onto the route. Mates tap “I’m in” with a name.</p>
            <ShareBar url={`/plan/${id}`} title={state.plan.title} text={shareText} />
          </section>
        </aside>
      </div>
    </main>
  );
}
