"use client";

// The owner's points and level on their own profile. The server counts the
// records (lib/points.server.ts) and lets the owner alone read them; this card
// prints what came back and nothing else. It stays hidden until an answer
// arrives. A failed refresh keeps the previous answer for the same account.

import Kicker from "@/components/ui/kicker";
import { POINTS_COPY, type PointsBreakdown } from "@/lib/points";

import { usePassportRead } from "./PassportData";

import "./pointsCard.css";

const DISTRICTS_SHOWN = 8;

function nf(value: number): string {
  return value.toLocaleString("en-GB");
}

/** How far through this level the total is, from 0 to 1. */
function progressShare(points: PointsBreakdown): number {
  if (points.nextLevelAt === null) return 1;
  const span = points.nextLevelAt - points.levelFloor;
  return span > 0 ? Math.min(1, Math.max(0, (points.total - points.levelFloor) / span)) : 0;
}

export default function PointsCard({ handle }: { handle: string }) {
  const points = usePassportRead<PointsBreakdown>("points", handle);
  if (!points) return null;

  const share = progressShare(points);
  const districts = points.districts.slice(0, DISTRICTS_SHOWN);
  const moreDistricts = points.districts.length - districts.length;

  return (
    <section className="pointsCard" aria-labelledby="points-level">
      <Kicker>{POINTS_COPY.kicker}</Kicker>
      <h2 id="points-level" className="pointsLevel">
        {`Level ${points.level}`}
      </h2>
      <p className="pointsTotal">
        <span className="pointsFigure">{nf(points.total)}</span> {points.total === 1 ? "point" : "points"}
      </p>
      {points.nextLevelAt !== null ? (
        <>
          <div className="pointsTrack" aria-hidden="true">
            <span className="pointsTrackFill" style={{ inlineSize: `${Math.round(share * 100)}%` }} />
          </div>
          <p className="pointsNext">
            <span className="pointsFigure">{nf(points.nextLevelAt - points.total)}</span>
            {` more to Level ${points.level + 1}.`}
          </p>
        </>
      ) : (
        <p className="pointsNext">The top level. Nothing left to climb.</p>
      )}

      <ul className="pointsLines">
        {points.lines.map((line) => (
          <li key={line.key} className="pointsLine">
            <span className="pointsLineLabel">{POINTS_COPY.lines[line.key]}</span>
            <span className="pointsLineCount">
              <span className="pointsFigure">{nf(line.count)}</span>
              {` × ${line.each}`}
            </span>
            <span className="pointsLinePoints pointsFigure">{nf(line.points)}</span>
          </li>
        ))}
      </ul>

      {districts.length ? (
        <p className="pointsDistricts">
          {"Finished: "}
          <span className="pointsFigure">{districts.join(", ")}</span>
          {moreDistricts > 0 ? ` and ${moreDistricts} more` : null}
        </p>
      ) : null}

      {points.status === "degraded" ? (
        <p className="pointsNote" role="status">
          {POINTS_COPY.degraded}
        </p>
      ) : null}

      <details className="pointsHow">
        <summary>{POINTS_COPY.howTitle}</summary>
        <ul>
          {POINTS_COPY.how.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p>{POINTS_COPY.fence}</p>
      </details>
    </section>
  );
}
