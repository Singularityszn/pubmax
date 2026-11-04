import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import PlacePhoto from "@/components/listing/PlacePhoto";
import { areaRoutePlacePhoto, type PlacePhoto as PlacePhotoData } from "@/components/listing/placePhotoRules";
import ActivePlanMarker from "@/components/plan/ActivePlanMarker";
import NightCrawlMode from "@/components/plan/NightCrawlMode";
import PlanInviteOpened from "@/components/plan/PlanInviteOpened";
import PlanCard from "@/components/plan/PlanCard";
import PlanCrew from "@/components/plan/PlanCrew";
import PlanInviteNextStep from "@/components/plan/PlanInviteNextStep";
import PlanReadUnavailable from "@/components/plan/PlanReadUnavailable";
import CompletedPlanUsualLot from "@/components/plan/CompletedPlanUsualLot";
import LastCrewInvite from "@/components/plan/LastCrewInvite";
import SiteNav from "@/components/nav/SiteNav";
import PlanSummary from "@/components/plan/PlanSummary";
import Screen from "@/components/ui/screen";
import PlanVibe from "@/components/plan/PlanVibe";
import type { PlanState } from "@/lib/plan";
import { buildPlanPrivacyPreview, type PlanPrivacyPreviewDTO } from "@/lib/planPrivacy";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planStore } from "@/lib/planStore";
import { buildPlanInviteShareText } from "@/lib/shareArtifacts";
import { loadGroupedVenues } from "@/lib/venueDataset";
import { shareVibeSlug, VIBE_SLUGS } from "@/lib/vibeChips";
import type { VibeTally } from "@/lib/vibeTally";

import "../plan.css";
import "./planDetail.css";

/** A safe, non-leaking headline for anonymous surfaces — never the user title. */
function safePlanTitle(preview: PlanPrivacyPreviewDTO): string {
  return preview.areaName ? `Your night out in ${preview.areaName}` : "Your night out";
}

/** Preview-safe invite text: area + stop count + time, never the title or venues. */
function previewShareText(preview: PlanPrivacyPreviewDTO): string {
  return buildPlanInviteShareText({
    title: preview.areaName ? `a night out in ${preview.areaName}` : "a night out",
    stopCount: preview.stopCount,
    startClock: preview.startLabel === "Time to be confirmed" ? null : preview.startLabel,
  });
}

/**
 * §4.10: client components receive no route. NightCrawlMode still takes a
 * PlanState shape, so explicitly project the public fields instead of
 * spreading PlanDTO; future optional route fields must stay private. Its own
 * capability-gated mount fetch still upgrades a member.
 */
function redactedInitialState(state: PlanState, safeTitle: string): PlanState {
  return {
    plan: {
      id: state.plan.id,
      title: safeTitle,
      startTime: state.plan.startTime,
      createdAt: state.plan.createdAt,
    },
    stops: [],
    crew: [],
    context: null,
    actions: [],
    ending: null,
  };
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Crew vibe tally, fail-soft: the pre-migration 503 window (or any store
// error) reads as "no votes yet" and the page renders exactly as before.
async function readVibeTally(id: string): Promise<VibeTally | null> {
  try {
    const result = await planCollaborationStore().vibeTally(id);
    return result.ok ? result.tally : null;
  } catch {
    return null;
  }
}

// AN INVITE IS ONE CREW'S NIGHT, SO IT IS NOT A SEARCH RESULT.
//
// The page's own answer is capability-gated: a stranger who opens it gets the
// privacy-safe preview and nothing else (buildPlanPrivacyPreview). Indexing it
// would still publish the plan's address beside its area and its start time,
// which is the one thing about a private night a stranger could act on. Follow
// stays true, because a shared plan link routes onward to the map and the pubs
// and must never be a dead end. `og:` is untouched: an unfurler ignores robots,
// and the WhatsApp card IS the invite.
const PLAN_INVITE_ROBOTS = {
  index: false,
  follow: true,
  googleBot: { index: false, follow: true },
} as const;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const read = await planStore().read(id);
  // A read we could not run is not a plan that has gone. It is never indexed
  // either way, so the unfurl says the neutral thing and the page below says
  // the honest one.
  if (read.status === "unavailable") return { title: "Plan", robots: PLAN_INVITE_ROBOTS };
  if (read.status === "absent") return { title: "Plan not found", robots: PLAN_INVITE_ROBOTS };
  const state = read.state;
  // Vibe stamp on the unfurl (share loop, issue #438): a valid ?vibe= on the
  // shared link pins the stamp the sharer saw; otherwise the crew's live top
  // vibe stamps the card; otherwise the base card. Slugs are the locked
  // public contract in lib/vibeChips — anything else is dropped, not echoed.
  const tally = await readVibeTally(id);
  // §4.10: metadata + Open Graph are crawler-visible with no capability, so the
  // title and description are the privacy-safe preview — never the user title or
  // the venue route.
  const preview = buildPlanPrivacyPreview(state, tally);
  const safeTitle = safePlanTitle(preview);
  const description = previewShareText(preview);
  const vibe = shareVibeSlug(query.vibe, tally?.top ?? null);
  const card = `/api/plan-card?id=${encodeURIComponent(id)}${vibe ? `&vibe=${encodeURIComponent(vibe)}` : ""}`;
  return {
    title: safeTitle,
    description,
    robots: PLAN_INVITE_ROBOTS,
    openGraph: {
      title: safeTitle,
      description,
      type: "website",
      url: `/plan/${id}`,
      // The alt names what the card draws: the preview-safe title and the
      // stop count, never a venue (§4.10).
      images: [{ url: card, width: 1200, height: 630, alt: `${safeTitle}, ${preview.stopCount} ${preview.stopCount === 1 ? "stop" : "stops"}` }],
    },
    twitter: { card: "summary_large_image", title: safeTitle, description, images: [card] },
  };
}

// THE PLAN'S LEAD PHOTOGRAPH, OR NONE (components/listing/placePhotoRules.ts).
//
// The page publishes the plan's AREA to anyone with the link and keeps its
// stops to the crew (§4.10). So the only photograph it may lead with is the
// one of the area it already names, and only when every stop is a short walk
// from where that photograph was taken: a picture of Borough Market over a
// night that is really in Bermondsey would be a picture of somewhere else. It
// names no stop. A stop we cannot place could be anywhere, so it means none,
// and so does a dataset that cannot be read.
async function planLeadPhoto(state: PlanState): Promise<PlacePhotoData | null> {
  const area = state.context?.nightArea;
  if (!area || state.stops.length === 0) return null;
  const venues = await loadGroupedVenues();
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const points = state.stops.flatMap((stop) => {
    const venue = byId.get(stop.venueId);
    return venue ? [{ lat: venue.latitude, lng: venue.longitude }] : [];
  });
  if (points.length !== state.stops.length) return null;
  return areaRoutePlacePhoto(area, points);
}

const ENDING_LABEL: Record<"food" | "get_home" | "keep_going", string> = {
  food: "found food after",
  get_home: "headed home",
  keep_going: "kept it going",
};

export default async function PlanPage({ params }: Props) {
  const { id } = await params;
  const read = await planStore().read(id);
  // THE PLAN HAS NOT CLOSED; WE COULD NOT LOOK. `get` answered null for an
  // unknown plan and for a store error alike, and this page turned both into
  // the not-found surface, so one Supabase blip told a host their own night
  // was over (PlanAstra, section 2.4). The two answers are now two surfaces,
  // and this one offers the way back rather than a way onward.
  if (read.status === "unavailable") return <PlanReadUnavailable href={`/plan/${id}`} />;
  if (read.status === "absent") notFound();
  const state = read.state;
  // Crew vibe (share loop): the picker's server-rendered starting tally, and
  // the top slug that stamps the invite URL. Both fail soft to "no votes".
  const [vibeTally, leadPhoto] = await Promise.all([readVibeTally(id), planLeadPhoto(state)]);
  const topVibeSlug = vibeTally?.top ? VIBE_SLUGS[vibeTally.top] : null;
  // §4.10: the page's server HTML/RSC carries ONLY this preview — no venue
  // route, no crew list, no user title. Members upgrade to the full route
  // client-side via the capability-gated /api/plans/[id] inside each component.
  const preview = buildPlanPrivacyPreview(state, vibeTally);
  const safeTitle = safePlanTitle(preview);
  const shareText = previewShareText(preview);
  // A finished night must not still read like it's about to happen. Reflect the
  // server's own completion state so re-opening the plan the morning after
  // acknowledges the night and points onward to the recap, instead of stopping.
  const completed = state.plan.status === "completed" || Boolean(state.ending);
  const endingLabel = state.ending ? ENDING_LABEL[state.ending] : null;

  return (
    <main id="main" className="planPage">
      {/* Marks this plan as "on tonight" so the shell's Night Mode card can
          follow it across screens (client-only pointer, no backend). */}
      <ActivePlanMarker id={id} startTime={state.plan.startTime} />
      <PlanInviteOpened planId={id} />
      {/* Standard site navigation — a shared plan link is many people's first
          screen; it must route onward, not dead-end on a wordmark. SiteNav
          carries the brand, so the masthead keeps just the plan actions. */}
      <SiteNav />
      {/* The launch head (docs/design/LAUNCH_SCREENS.md): kicker, the plan's
          own safe name, one lede and ONE primary. Sending the invite is the
          primary while the night is ahead; the morning after, the recap is. */}
      <Screen
        as="section"
        className="planDetailScreen"
        kicker={completed ? "That was the night" : "Your plan"}
        title={safeTitle}
        titleId="plan-title"
        lede={
          completed ? (
            <>
              {preview.stopCount} {preview.stopCount === 1 ? "pub" : "pubs"}
              {endingLabel ? `, and you ${endingLabel}` : ""}. Your private recap
              is in your Memories. We share nothing until you approve it.
            </>
          ) : (
            <>
              {preview.stopCount} {preview.stopCount === 1 ? "pub" : "pubs"} and one
              link. Nobody needs an account to join.
            </>
          )
        }
        primary={
          completed ? (
            <Link href="/u/you#night-memories">Open your Memories</Link>
          ) : (
            <a href="#share">Send to the crew</a>
          )
        }
        secondary={<Link prefetch={false} href="/plan">Make another plan</Link>}
      />
      {/* The plan as one card (PlanAstra 7.4): a member's cover, name, time,
          crew and three actions, before the route. Client-only, because only
          the capability-gated member read may name the stops and the crew;
          while it stands the head above steps aside (app/plan/plan.css). */}
      <PlanCard planId={id} completed={completed} />
      {/* Night-crawl mode (U7): while this plan's night is on, it becomes the
          default full-screen surface on mobile and offers an inline entry
          otherwise. Client-only gating, no new route. */}
      {!completed ? <NightCrawlMode planId={id} initialState={redactedInitialState(state, safeTitle)} /> : null}
      {completed ? <CompletedPlanUsualLot /> : null}
      <div className="planPage__grid">
        <PlanSummary planId={id} initialPreview={preview} vibeTally={vibeTally} />
        <aside className="planPage__side">
          {leadPhoto ? (
            <PlacePhoto
              className="planLeadPhoto"
              photo={leadPhoto}
              sizes="(min-width: 900px) 24rem, calc(100vw - 2.5rem)"
              caption={<p className="planLeadPhotoCaption">Every stop is a short walk from here.</p>}
            />
          ) : null}
          {!completed ? (
            <section className="planShare" aria-labelledby="plan-share-title">
              <h2 id="plan-share-title">Get the crew in</h2>
              <p>WhatsApp the night link, or copy the invite. Mates tap &quot;I&apos;m in&quot; and add a name.</p>
              <PlanInviteNextStep
                planId={id}
                title={safeTitle}
                text={shareText}
                initialVibeSlug={topVibeSlug}
              />
              <LastCrewInvite planId={id} planTitle={safeTitle} />
            </section>
          ) : null}
          <PlanCrew planId={id} hostName={preview.hostDisplayName} />
          <PlanVibe planId={id} initialTally={vibeTally} />
        </aside>
      </div>
    </main>
  );
}
