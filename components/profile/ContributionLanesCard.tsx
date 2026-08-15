"use client";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import { useEffect, useState } from "react";
import Link from "next/link";

import "./yourContributionsCard.css";

// The wider record on the You page: prices, visit reports, and
// recommendations, side by side, for a fresh owner who has only ever seen
// pint drops (YourContributionsCard). Reads GET /api/profiles/[handle]/lane-stats
// - a narrow projection of public_contributor_leaderboard(), never the raw
// tables - so this card can never show a back-dated count. "Visit Reports"
// matches the term the public contributor record already uses
// (components/contributors/ContributorRecord.tsx); this card never says
// "reviews".

type Props = {
  /** The owner's handle (already known - this only renders on your own profile). */
  handle: string;
};

export type ContributionLaneStats = {
  status: "ready" | "degraded";
  handle: string;
  prices?: number;
  reviews?: number;
  recommendations?: number;
  total?: number;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; stats: ContributionLaneStats };

export type ContributionLanesCardState = State;

type ContentProps = {
  state: ContributionLanesCardState;
};

export function ContributionLanesCardContent({ state }: ContentProps) {
  if (state.kind === "loading") {
    return (
      <section
        id="contribution-impact"
        className="contribCard"
        aria-labelledby="contrib-lanes-title"
        aria-busy="true"
      >
        <h2 className="contribKicker" id="contrib-lanes-title">Your contributor record</h2>
        <p className="contribMuted">Counting the rest of your record…</p>
      </section>
    );
  }

  if (state.kind === "error" || state.stats.status === "degraded") {
    return (
      <section
        id="contribution-impact"
        className="contribCard"
        aria-labelledby="contrib-lanes-title"
      >
        <h2 className="contribKicker" id="contrib-lanes-title">Your contributor record</h2>
        <p className="contribMuted">Couldn&apos;t load the rest of your record right now.</p>
      </section>
    );
  }

  const { stats } = state;
  const prices = stats.prices ?? 0;
  const reviews = stats.reviews ?? 0;
  const recommendations = stats.recommendations ?? 0;
  const hasContributed = prices > 0 || reviews > 0 || recommendations > 0;

  return (
    <section
      id="contribution-impact"
      className="contribCard"
      aria-labelledby="contrib-lanes-title"
    >
      <h2 className="contribKicker" id="contrib-lanes-title">Your contributor record</h2>

      {!hasContributed ? (
        <p className="contribEmpty">
          No prices, visit reports, or recommendations yet. Write up a pub or
          point mates to a good one and it lands here too.
        </p>
      ) : (
        <div className="contribTotals">
          <div className="contribStat">
            <span className="contribStatValue">{prices}</span>
            <span className="contribStatLabel">
              {prices === 1 ? "price" : "prices"}
            </span>
          </div>
          <div className="contribStat">
            <span className="contribStatValue">{reviews}</span>
            <span className="contribStatLabel">
              {reviews === 1 ? "visit report" : "visit reports"}
            </span>
          </div>
          <div className="contribStat">
            <span className="contribStatValue">{recommendations}</span>
            <span className="contribStatLabel">
              {recommendations === 1 ? "recommendation" : "recommendations"}
            </span>
          </div>
        </div>
      )}

      <Link className="contribRecordLink" href="/contributors">
        See the contributor record
      </Link>
    </section>
  );
}

export default function ContributionLanesCard({ handle }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#contribution-impact") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document.getElementById("contribution-impact")?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.kind]);

  useEffect(() => {
    if (!handle) return;
    const controller = new AbortController();
    (async () => {
      const outcome = await loadSurfaceJson<{ stats?: ContributionLaneStats }>(
        `/api/profiles/${encodeURIComponent(handle)}/lane-stats`,
        {
          signal: controller.signal,
          validate: (body) => Boolean(body?.stats),
        },
        (body) => {
          if (!body.stats) return;
          setState({ kind: "ready", stats: body.stats });
        },
      );
      if (outcome === "failed" && !controller.signal.aborted) {
        setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, [handle]);

  return <ContributionLanesCardContent state={state} />;
}
