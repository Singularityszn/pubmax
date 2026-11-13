"use client";

// The owner's challenges on their own profile: every Red Lion, every King's
// Head, every Ship and one pub in every postcode district. The points read
// carries the progress (lib/points.server.ts), so the card and the points
// total cannot disagree. Owner only, like the points card.

import Link from "next/link";

import Kicker from "@/components/ui/kicker";
import { CHALLENGE_COPY, type ChallengeProgress } from "@/lib/challenges";
import type { PointsBreakdown } from "@/lib/points";
import { venueMapUrl } from "@/lib/venueMapUrl";

import { usePassportRead } from "./PassportData";

import "./challengesCard.css";

function nf(value: number): string {
  return value.toLocaleString("en-GB");
}

function ChallengeRow({ challenge, monthly }: { challenge: ChallengeProgress; monthly: boolean }) {
  const share = challenge.total > 0 ? challenge.done / challenge.total : 0;
  const titleId = `challenge-${challenge.id}`;
  return (
    <li className="challengeRow" aria-labelledby={titleId} data-monthly={monthly || undefined}>
      <div className="challengeHead">
        <h3 id={titleId} className="challengeTitle">
          {CHALLENGE_COPY.titles[challenge.id]}
        </h3>
        <p className="challengeCount">
          <span className="challengeFigure">{nf(challenge.done)}</span>
          {" of "}
          <span className="challengeFigure">{nf(challenge.total)}</span> {CHALLENGE_COPY.units[challenge.id]}
        </p>
      </div>
      <p className="challengeDek">{CHALLENGE_COPY.deks[challenge.id]}</p>
      <div className="challengeTrack" aria-hidden="true">
        <span className="challengeTrackFill" style={{ inlineSize: `${Math.round(share * 100)}%` }} />
      </div>
      {monthly && !challenge.finished ? <p className="challengeNote">{CHALLENGE_COPY.monthly}</p> : null}
      {challenge.finished ? (
        <p className="challengeNote">{challenge.doubled ? CHALLENGE_COPY.doubled : CHALLENGE_COPY.finished}</p>
      ) : null}
      {challenge.left.length > 0 ? (
        <details className="challengeLeft">
          <summary>
            {CHALLENGE_COPY.leftTitle} <span className="challengeFigure">{nf(challenge.left.length)}</span>
          </summary>
          <ul>
            {challenge.left.map((target) => (
              <li key={target.venueId ?? target.label}>
                {target.venueId ? (
                  <Link prefetch={false} href={venueMapUrl(target.venueId)}>
                    {target.label}
                  </Link>
                ) : (
                  target.label
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

export default function ChallengesCard({ handle }: { handle: string }) {
  const points = usePassportRead<PointsBreakdown>("points", handle);
  const listed = (points?.challenges ?? []).filter((challenge) => challenge.total > 0);
  if (!points || listed.length === 0) return null;

  const monthly = points.challengeOfTheMonth;
  const ordered = [...listed].sort((a, b) => Number(b.id === monthly) - Number(a.id === monthly));

  return (
    <section className="challengesCard" aria-labelledby="challenges-title">
      <Kicker>{CHALLENGE_COPY.kicker}</Kicker>
      <h2 id="challenges-title" className="challengesTitle">
        {CHALLENGE_COPY.title}
      </h2>
      <ul className="challengeList">
        {ordered.map((challenge) => (
          <ChallengeRow key={challenge.id} challenge={challenge} monthly={challenge.id === monthly} />
        ))}
      </ul>
      <p className="challengesFence">{CHALLENGE_COPY.fence}</p>
    </section>
  );
}
