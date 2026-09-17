import type { Metadata } from "next";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import MemoryReviewAnalytics from "@/components/plan/MemoryReviewAnalytics";
import PlanReadUnavailable from "@/components/plan/PlanReadUnavailable";
import RecapDetail from "@/components/plan/RecapDetail";
import { isPlanId } from "@/lib/plan";
import { buildPlanPrivacyPreview } from "@/lib/planPrivacy";
import { planStore } from "@/lib/planStore";

import recapStyles from "./Recap.module.css";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  // A read we could not RUN is not a plan that has gone: `get` collapses those
  // two into null and this page turned both into the expired-link surface, so
  // one PostgREST blip told a crew standing in their own night that it was
  // over. The plan page above branches three ways for exactly that reason
  // (#1594); the recap inside the same segment was left behind, and it
  // inherits the same not-found copy.
  const read = isPlanId(id) ? await planStore().read(id) : ({ status: "absent" } as const);
  const state = read.status === "found" ? read.state : null;
  // §4.10: recap metadata is crawler-visible with no capability, so the title is
  // the privacy-safe preview — never the user title. The recap is noindex anyway.
  const area = state ? buildPlanPrivacyPreview(state).areaName : null;
  const safeTitle = area ? `A night out in ${area}` : "Recap";
  return {
    title: `${safeTitle} · Recap · PUBMAXXING`,
    // The recap is private to the crew by default — nothing here should be
    // indexed. The only public surface is an explicitly approved Night Story.
    robots: { index: false, follow: false },
  };
}

/**
 * §4.10: the recap server shell carries no user title, no route, no venue names,
 * and no pint detail. RecapDetail loads the full recap client-side from the
 * capability-gated GET /api/plans/[id]/recap, revealing it only to a member.
 */
export default async function PlanRecapPage({ params }: Props) {
  const { id } = await params;
  if (!isPlanId(id)) notFound();
  const read = await planStore().read(id);
  // The retry address is the reader's OWN, so a recap link returns to the
  // recap rather than to the plan.
  if (read.status === "unavailable") {
    return <PlanReadUnavailable href={`/plan/${id}/recap`} title="We could not load this recap" />;
  }
  if (read.status === "absent") notFound();

  return (
    <main id="main" className={recapStyles.recapPage}>
      <MemoryReviewAnalytics />
      <SiteNav />
      <RecapDetail planId={id} />
    </main>
  );
}
