import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import RecapShareButton from "@/components/plan/RecapShareButton";
import { isPlanId } from "@/lib/plan";
import { planCompletionResult, planStore } from "@/lib/planStore";
import { pintDropsStore } from "@/lib/pintDropsStore";
import type { LastPintDecisionKind } from "@/lib/tfl";
import {
  buildRecapShareText,
  composeRecapFromCompletion,
  type RecapPint,
  type RecapView,
} from "@/lib/recapView";

type RecapLastTrain = { dropCreatedAt?: string | null; leaveByIso?: string | null; decision?: LastPintDecisionKind | null };

import "../../plan.css";
import "./recap.css";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const state = isPlanId(id) ? await planStore().get(id) : null;
  const title = state?.plan.title ?? "Recap";
  return {
    title: `${title} · Recap · PUBMAXXING`,
    // The recap is private to the crew by default — nothing here should be
    // indexed. The only public surface is an explicitly approved Night Story.
    robots: { index: false, follow: false },
  };
}

/**
 * Resolve the ONE night-scoped pint we can honestly show on a private recap: the
 * final logged drop. It is the only pint the completion record points at, so we
 * never dredge up other nights' drops at these venues. Returns the pint plaque
 * plus any live last-train context riding on that drop (for the guardian save).
 */
async function resolveFinalPint(
  finalPintDropId: string | null,
  terminalVenueId: string | null,
  fallbackVenueId: string | null,
  venueNames: Map<string, string>,
): Promise<{ pints: RecapPint[]; lastTrain: RecapLastTrain | null }> {
  if (!finalPintDropId) return { pints: [], lastTrain: null };
  const venueId = terminalVenueId ?? fallbackVenueId;
  if (!venueId) return { pints: [], lastTrain: null };
  try {
    const drops = await pintDropsStore().listVisible(venueId);
    const drop = drops.find((item) => item.id === finalPintDropId);
    if (!drop) return { pints: [], lastTrain: null };
    const price = typeof drop.priceGbp === "number" ? drop.priceGbp : null;
    const note = typeof drop.passedDownNote === "string" && drop.passedDownNote.trim() ? drop.passedDownNote.trim() : null;
    const pint: RecapPint = {
      venueId: drop.venueId,
      venueName: venueNames.get(drop.venueId) ?? null,
      drink: typeof drop.drink === "string" && drop.drink.trim() ? drop.drink.trim() : null,
      priceGbp: price,
      priceLabel: price === null ? null : `£${price.toFixed(2)}`,
      note,
    };
    return {
      pints: [pint],
      lastTrain: { dropCreatedAt: drop.createdAt, leaveByIso: drop.leaveByIso ?? null, decision: drop.lastTrainDecision ?? null },
    };
  } catch {
    // A pint-store outage never blocks the memory — the section simply omits.
    return { pints: [], lastTrain: null };
  }
}

function endingLine(view: RecapView): string | null {
  if (!view.ending) return null;
  switch (view.ending.kind) {
    case "food":
      return `Ended on ${view.ending.label}`;
    case "keep_going":
      return `Kept going. ${view.ending.label}`;
    case "get_home":
      return view.ending.label;
    default:
      return view.ending.label;
  }
}

export default async function PlanRecapPage({ params }: Props) {
  const { id } = await params;
  if (!isPlanId(id)) notFound();
  const state = await planStore().get(id);
  if (!state) notFound();

  const completionLookup = await planCompletionResult(id);
  const completion = completionLookup.ok ? completionLookup.completion : null;

  // Honest "not yet" state — the plan exists but the night isn't finished, so
  // there is no memory to render. Nothing is invented to fill the page.
  if (!completion) {
    return (
      <main className="recapPage recapPage--empty">
        <SiteNav />
        <section className="recapEmpty">
          <p className="type-meta recapEmpty__eyebrow">Recap</p>
          <h1 className="type-section-title">This night isn&rsquo;t finished yet</h1>
          <p className="recapEmpty__body">
            The recap writes itself the morning after. Finish the night and the route, the pints, and the last-train
            verdict land here.
          </p>
          <Link className="recapEmpty__back" href={`/plan/${id}`}>
            Back to the plan
          </Link>
        </section>
      </main>
    );
  }

  const canonicalStops = completion.routeSnapshot.slice().sort((left, right) => left.position - right.position);
  const venueNames = new Map(canonicalStops.map((stop) => [stop.venueId, stop.venueName] as const));
  const fallbackVenueId = canonicalStops.at(-1)?.venueId ?? null;
  const { pints, lastTrain } = await resolveFinalPint(
    completion.finalPintDropId,
    completion.terminalVenueId,
    fallbackVenueId,
    venueNames,
  );

  const view = composeRecapFromCompletion({
    title: state.plan.title,
    completedAt: completion.completedAt,
    ending: completion.ending,
    endingSelection: completion.endingSelection ?? null,
    stops: canonicalStops,
    pints,
    lastTrain,
  });

  const shareText = buildRecapShareText({
    title: view.title,
    stopCount: view.stats.stopCount,
    totalGbp: view.stats.totalGbp,
  });
  const ending = endingLine(view);
  let section = 0;
  const step = () => ({ ["--recap-step" as string]: String(section++) });

  return (
    <main className="recapPage">
      <SiteNav />

      <header className="recapHero" style={step()}>
        <p className="type-meta recapHero__eyebrow">The morning after</p>
        <h1 className="recapHero__title type-section-title">{view.title}</h1>
        <div className="recapHero__stats" aria-label="Night at a glance">
          <span className="recapStat">
            <b>{view.stats.stopCount}</b> {view.stats.stopCount === 1 ? "stop" : "stops"}
          </span>
          {view.stats.pintCount > 0 ? (
            <span className="recapStat">
              <b>{view.stats.pintCount}</b> {view.stats.pintCount === 1 ? "pint logged" : "pints logged"}
            </span>
          ) : null}
          {view.stats.totalGbp !== null ? (
            <span className="recapStat recapStat--price price-plaque">£{view.stats.totalGbp.toFixed(2)}</span>
          ) : null}
        </div>
      </header>

      {view.route.length > 0 ? (
        <section className="recapSection" style={step()} aria-labelledby="recap-route-title">
          <h2 id="recap-route-title" className="type-card-title recapSection__title">
            The route you walked
          </h2>
          <ol className="recapRoute">
            {view.route.map((stop) => (
              <li key={`${stop.venueId}-${stop.position}`} className="recapRoute__stop">
                <span className="recapRoute__number" aria-hidden="true">
                  {stop.position + 1}
                </span>
                <div className="recapRoute__body">
                  <span className="recapRoute__name">{stop.venueName}</span>
                  {stop.caption ? <p className="recapRoute__caption">{stop.caption}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {view.pints.length > 0 ? (
        <section className="recapSection" style={step()} aria-labelledby="recap-pints-title">
          <h2 id="recap-pints-title" className="type-card-title recapSection__title">
            Pints logged
          </h2>
          <ul className="recapPints">
            {view.pints.map((pint, index) => (
              <li key={`${pint.venueId}-${index}`} className="recapPint">
                <div className="recapPint__body">
                  <span className="recapPint__drink">{pint.drink ?? "A pint"}</span>
                  {pint.venueName ? <span className="recapPint__venue type-meta">{pint.venueName}</span> : null}
                  {pint.note ? <p className="recapPint__note">{pint.note}</p> : null}
                </div>
                {pint.priceLabel ? <span className="recapPint__price price-plaque">{pint.priceLabel}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ending || view.guardian ? (
        <section className="recapSection recapSection--ending" style={step()} aria-label="How the night ended">
          {ending ? (
            <div className="recapEnding">
              <span className="type-meta recapEnding__label">How it ended</span>
              <p className="recapEnding__line">{ending}</p>
            </div>
          ) : null}
          {view.guardian ? (
            <div className={`recapGuardian recapGuardian--${view.guardian.tone}`}>
              <span className="type-meta recapGuardian__label">The guardian</span>
              <p className="recapGuardian__line">{view.guardian.label}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className="recapFooter" style={step()}>
        <p className="recapClosing">{view.closingLine}</p>
        <div className="recapFooter__actions">
          {/* Sharing is approval-gated: this never emits a public link. It routes
              into the existing Night Story consent flow, where the crew approves
              photos and identities before anything can be published. */}
          <RecapShareButton planId={id} shareText={shareText} />
          <Link className="recapFooter__plan" href={`/plan/${id}`}>
            Back to the plan
          </Link>
        </div>
      </footer>
    </main>
  );
}
