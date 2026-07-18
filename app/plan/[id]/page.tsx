import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActivePlanMarker from "@/components/plan/ActivePlanMarker";
import PlanCrew from "@/components/plan/PlanCrew";
import SiteNav from "@/components/nav/SiteNav";
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

const ENDING_LABEL: Record<"food" | "get_home" | "keep_going", string> = {
  food: "found food after",
  get_home: "headed home",
  keep_going: "kept it going",
};

export default async function PlanPage({ params }: Props) {
  const { id } = await params;
  const state = await planStore().get(id);
  if (!state) notFound();
  const shareText = shareCopyForPlan(state);
  // A finished night must not still read like it's about to happen. Reflect the
  // server's own completion state so re-opening the plan the morning after
  // acknowledges the night and points onward to the recap, instead of stopping.
  const completed = state.plan.status === "completed" || Boolean(state.ending);
  const endingLabel = state.ending ? ENDING_LABEL[state.ending] : null;

  return (
    <main className="planPage">
      {/* Marks this plan as "on tonight" so the shell's Night Mode card can
          follow it across screens (client-only pointer, no backend). */}
      <ActivePlanMarker id={id} startTime={state.plan.startTime} />
      {/* Standard site navigation — a shared plan link is many people's first
          screen; it must route onward, not dead-end on a wordmark. SiteNav
          carries the brand, so the masthead keeps just the plan actions. */}
      <SiteNav />
      <header className="planPage__masthead">
        <span>Your plan</span>
        <Link href="/plan">Make another plan</Link>
      </header>
      <section className="planPage__hero">
        <p className="planPage__eyebrow">{completed ? "That was the night" : "Your night is sorted"}</p>
        <h1>{state.plan.title}</h1>
        {completed ? (
          <p>
            {state.stops.length} {state.stops.length === 1 ? "pub" : "pubs"}
            {endingLabel ? `, and you ${endingLabel}` : ""}. Your private recap lives in{" "}
            <Link href="/u/you#night-memories">your Memories</Link>. Nothing is shared until you approve it.
          </p>
        ) : (
          <p>{state.stops.length} {state.stops.length === 1 ? "pub" : "pubs"}, one link, zero account walls.</p>
        )}
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
