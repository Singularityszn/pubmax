"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { type ContributionSummary } from "@/lib/pintContributions";
import { nightsKeptLabel, readNightsKept } from "@/lib/nightsKept";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import styles from "./yourContributionsCard.module.css";

// The "your impact" card on the You page (feat/price-drops-v2). Fetches the
// contributor's own stats from GET /api/pint-drops/stats and renders the honest
// reward: pints mapped, and where on the map they landed.
//
// IT COUNTS WHAT YOU MAPPED, NEVER HOW MANY DAYS RUNNING. Captain 6 Sep 2026:
// the card printed "1-day mapping streak" over a brand-new account, and a
// streak is exactly the mechanic this product refuses everywhere else - a
// referral is a mark of honour and nothing branches on it, Step Out is one
// owed weekly push and never a streak, and the Year in Pints wrap is a year
// read back rather than a score. A count of pubs is a fact about the map. A
// run of days is a reason to go out tonight so as not to lose it, which is a
// thing a pub app may not ask of anybody.
//
// The card is deliberately self-contained (its own fetch by handle) so it can
// drop into the owner-only block of app/u/[handle]/page.tsx without threading
// stats through the whole page. Duty of care: every string here is about
// MAPPING prices, never about drinking — the reward is visible impact, not a
// points economy.

type Props = {
  /** The owner's handle (already known — this only renders on your own profile). */
  handle: string;
  /**
   * Show the account nudge (the identity-push: after your first drop, offer an
   * account so the drops survive a lost device). Passed by the page when the
   * viewer is on an unclaimed device identity.
   */
  claimNudge?: boolean;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; stats: ContributionSummary };

const MAX_BOROUGH_CHIPS = 6;

function ContributorRecordLink() {
  return (
    <Link className={styles.contribRecordLink} href="/contributors">
      See the contributor record
    </Link>
  );
}

export default function YourContributionsCard({ handle, claimNudge = false }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [nightsLabel, setNightsLabel] = useState("");

  useEffect(() => {
    try {
      const label = nightsKeptLabel(readNightsKept(window.localStorage));
      queueMicrotask(() => setNightsLabel(label));
    } catch {
      queueMicrotask(() => setNightsLabel(""));
    }
  }, []);

  useEffect(() => {
    if (!handle) return;
    const controller = new AbortController();
    (async () => {
      const outcome = await loadSurfaceJson<{ stats?: ContributionSummary }>(
        `/api/pint-drops/stats?handle=${encodeURIComponent(handle)}`,
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

  if (state.kind === "loading") {
    return (
      <section className={styles.contribCard} aria-labelledby="contrib-title" aria-busy="true">
        <p className={styles.contribKicker} id="contrib-title">Your contributions</p>
        <p className={styles.contribMuted}>Counting your pints…</p>
        <ContributorRecordLink />
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className={styles.contribCard} aria-labelledby="contrib-title">
        <p className={styles.contribKicker} id="contrib-title">Your contributions</p>
        <p className={styles.contribMuted}>Couldn&apos;t load your stats right now.</p>
        <ContributorRecordLink />
      </section>
    );
  }

  const { stats } = state;
  const { streak, byBorough, pintsMapped } = stats;
  const topBoroughs = byBorough.slice(0, MAX_BOROUGH_CHIPS);
  const hasContributed = pintsMapped > 0 || streak.activeDays > 0;

  return (
    <section className={styles.contribCard} aria-labelledby="contrib-title">
      <p className={styles.contribKicker} id="contrib-title">Your contributions</p>

      {nightsLabel ? <p className={styles.contribNightsKept}>{nightsLabel}</p> : null}

      {!hasContributed ? (
        <p className={styles.contribEmpty}>
          Log a price at a pub and your first drop lands here. That&apos;s a real
          data point on the London map, not a point in a game.
        </p>
      ) : (
        <>
          <div className={styles.contribTotals}>
            <div className={styles.contribStat}>
              <span className={styles.contribStatValue}>{pintsMapped}</span>
              <span className={styles.contribStatLabel}>
                {pintsMapped === 1 ? "pint mapped" : "pints mapped"}
              </span>
            </div>
            <div className={styles.contribStat}>
              <span className={styles.contribStatValue}>{byBorough.length}</span>
              <span className={styles.contribStatLabel}>
                {byBorough.length === 1 ? "borough" : "boroughs"}
              </span>
            </div>
          </div>

          {topBoroughs.length ? (
            <div className={styles.contribBoroughs}>
              {topBoroughs.map((tally) => (
                <span className={styles.contribBoroughChip} key={tally.borough}>
                  {tally.borough} <b>{tally.count}</b>
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}

      {claimNudge ? (
        <a className={styles.contribNudge} href="#account-settings">
          Keep your drops. Claim your @handle
        </a>
      ) : null}
      <ContributorRecordLink />
    </section>
  );
}
