"use client";

// §4.10: the recap page server-renders only a privacy-safe shell. This client
// component fetches the capability-gated GET /api/plans/[id]/recap and reveals
// the full recap — route venue names, pints, the user title — ONLY when the
// server returns a member projection. A non-member (or the flag off) gets the
// preview envelope and sees the private-recap notice, never the route.

import { useEffect, useState } from "react";
import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import PubmaxxNightSeal from "@/components/brand/PubmaxxNightSeal";
import RecapShareButton from "@/components/plan/RecapShareButton";
import type { RecapView } from "@/lib/recapView";
import recapStyles from "@/app/plan/[id]/recap/Recap.module.css";

type MemberRecap =
  | { visibility: "member"; completed: false; stopCount: number }
  | { visibility: "member"; completed: true; stopCount: number; view: RecapView; shareText: string };

type RecapResponse = { visibility: "preview" } | MemberRecap;

type LoadState = { kind: "loading" } | { kind: "preview" } | { kind: "member"; recap: MemberRecap };

function endingLine(view: RecapView): string | null {
  if (!view.ending) return null;
  switch (view.ending.kind) {
    case "food":
      return `Ended on ${view.ending.label}`;
    case "keep_going":
      return `Kept going. ${view.ending.label}`;
    default:
      return view.ending.label;
  }
}

export default function RecapDetail({ planId }: { planId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    fetch(`/api/plans/${planId}/recap`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<RecapResponse>) : null))
      .then((body) => {
        if (!active) return;
        if (body && body.visibility === "member") setState({ kind: "member", recap: body });
        else setState({ kind: "preview" });
      })
      .catch(() => {
        if (active) setState({ kind: "preview" });
      });
    return () => {
      active = false;
    };
  }, [planId]);

  if (state.kind === "loading") {
    return <section className={recapStyles.recapSection} aria-busy="true" aria-label="Loading recap" />;
  }

  if (state.kind === "preview") {
    return (
      <section className={`${recapStyles.recapSection} recapSection--locked`} aria-label="Private recap">
        <p className={recapStyles.recapEmpty__body}>
          This recap is private to the crew. Join the plan to see the route you walked, the pints logged, and how the
          night ended.
        </p>
        <Link className={recapStyles.recapEmpty__back} href={`/plan/${planId}`}>
          Back to the plan
        </Link>
      </section>
    );
  }

  const { recap } = state;
  if (!recap.completed) {
    return (
      <section className={recapStyles.recapEmpty} aria-label="Recap not finished">
        <h2 className="type-section-title">This night isn&rsquo;t finished yet</h2>
        <p className={recapStyles.recapEmpty__body}>
          The recap writes itself the morning after. Finish the night and the route, the pints, and the last-train
          verdict land here.
        </p>
        <Link className={recapStyles.recapEmpty__back} href={`/plan/${planId}`}>
          Back to the plan
        </Link>
      </section>
    );
  }

  const { view, shareText } = recap;
  const ending = endingLine(view);
  let section = 0;
  const step = () => ({ ["--recap-step" as string]: String(section++) });

  return (
    <>
      <header className={recapStyles.recapHero} style={step()}>
        <PubmaxxNightSeal className={recapStyles.recapHero__seal} size={64} title="Night sealed" />
        <p className={`type-meta ${recapStyles.recapHero__eyebrow}`}>The morning after</p>
        <h1 className={`${recapStyles.recapHero__title} type-section-title`}>{view.title}</h1>
        <div className={recapStyles.recapHero__stats} aria-label="Night at a glance">
          <span className={recapStyles.recapStat}>
            <b>{view.stats.stopCount}</b> {view.stats.stopCount === 1 ? "stop" : "stops"}
          </span>
          {view.stats.pintCount > 0 ? (
            <span className={recapStyles.recapStat}>
              <b>{view.stats.pintCount}</b> {view.stats.pintCount === 1 ? "pint logged" : "pints logged"}
            </span>
          ) : null}
          {view.stats.totalGbp !== null ? (
            <PriceBadge variant="current" className={recapStyles["recapStat--price"]}>
              £{view.stats.totalGbp.toFixed(2)}
            </PriceBadge>
          ) : null}
        </div>
      </header>

      {view.route.length > 0 ? (
        <section className={recapStyles.recapSection} style={step()} aria-labelledby="recap-route-title">
          <h2 id="recap-route-title" className={`type-card-title ${recapStyles.recapSection__title}`}>
            The route you walked
          </h2>
          <ol className={recapStyles.recapRoute}>
            {view.route.map((stop) => (
              <li key={`${stop.venueId}-${stop.position}`} className={recapStyles.recapRoute__stop}>
                <span className={recapStyles.recapRoute__number} aria-hidden="true">
                  {stop.position + 1}
                </span>
                <div className={recapStyles.recapRoute__body}>
                  <span className={recapStyles.recapRoute__name}>{stop.venueName}</span>
                  {stop.caption ? <p className={recapStyles.recapRoute__caption}>{stop.caption}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {view.pints.length > 0 ? (
        <section className={recapStyles.recapSection} style={step()} aria-labelledby="recap-pints-title">
          <h2 id="recap-pints-title" className={`type-card-title ${recapStyles.recapSection__title}`}>
            Pints logged
          </h2>
          <ul className={recapStyles.recapPints}>
            {view.pints.map((pint, index) => (
              <li key={`${pint.venueId}-${index}`} className={recapStyles.recapPint}>
                <div className={recapStyles.recapPint__body}>
                  <span className={recapStyles.recapPint__drink}>{pint.drink ?? "A pint"}</span>
                  {pint.venueName ? <span className={`${recapStyles.recapPint__venue} type-meta`}>{pint.venueName}</span> : null}
                  {pint.note ? <p className={recapStyles.recapPint__note}>{pint.note}</p> : null}
                </div>
                {pint.priceLabel ? (
                  <PriceBadge variant="current" className={recapStyles.recapPint__price}>
                    {pint.priceLabel}
                  </PriceBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ending || view.guardian ? (
        <section className={`${recapStyles.recapSection} ${recapStyles["recapSection--ending"]}`} style={step()} aria-label="How the night ended">
          {ending ? (
            <div className={recapStyles.recapEnding}>
              <span className={`type-meta ${recapStyles.recapEnding__label}`}>How it ended</span>
              <p className={recapStyles.recapEnding__line}>{ending}</p>
            </div>
          ) : null}
          {view.guardian ? (
            <div className={`${recapStyles.recapGuardian} ${recapStyles[`recapGuardian--${view.guardian.tone}`]}`}>
              <span className={`type-meta ${recapStyles.recapGuardian__label}`}>The guardian</span>
              <p className={recapStyles.recapGuardian__line}>{view.guardian.label}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className={recapStyles.recapFooter} style={step()}>
        <p className={recapStyles.recapClosing}>{view.closingLine}</p>
        <div className={recapStyles.recapFooter__actions}>
          <RecapShareButton planId={planId} shareText={shareText} />
          <Link className={recapStyles.recapFooter__plan} href={`/plan/${planId}`}>
            Back to the plan
          </Link>
        </div>
      </footer>
    </>
  );
}
