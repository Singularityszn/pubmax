"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PriceBadge from "@/components/PriceBadge";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import Kicker from "@/components/ui/kicker";
import { RowList, RowListItem } from "@/components/ui/row-list";
import { formatGbp } from "@/lib/formatGbp";
import {
  LOG_IN_PUBLIC_FEED_HREF,
  LOG_IN_PUBLIC_HREF,
  logInPublicDayLabel,
  logInPublicTime,
  pickLogInPublicDrops,
  type LogInPublicDrop,
} from "@/lib/logInPublicDrops";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./logInPublicDay.css";

const MAX_ROWS = 20;

type State =
  | { status: "loading" }
  | { status: "ready"; drops: LogInPublicDrop[] }
  | { status: "error" };

function DropRow({ drop }: { drop: LogInPublicDrop }) {
  const serving = drop.drink ? `${drop.drink}, ${drop.measure.toLowerCase()}` : drop.measure;
  return (
    <RowListItem
      href={drop.venueMapUrl}
      title={drop.venueName}
      meta={
        <>
          {serving}, logged at <time dateTime={drop.createdAt}>{logInPublicTime(drop.createdAt)}</time>
        </>
      }
      trailing={<PriceBadge variant="current">{formatGbp(drop.priceGbp)}</PriceBadge>}
    />
  );
}

/**
 * The durable public read is capped before city and visibility filtering.
 * Empty results cannot establish that nobody logged a price.
 */
export default function LogInPublicDay({ day, className }: { day: string; className?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const dayLabel = logInPublicDayLabel(day);

  useEffect(() => {
    const controller = new AbortController();
    void loadSurfaceJson<unknown>(
      LOG_IN_PUBLIC_FEED_HREF,
      {
        signal: controller.signal,
        init: { cache: "no-store", credentials: "omit" },
        validate: (body) => pickLogInPublicDrops(body, day) !== null,
      },
      (body) => {
        const drops = pickLogInPublicDrops(body, day);
        if (drops === null) return false;
        setState({ status: "ready", drops });
      },
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) {
        setState({ status: "error" });
      }
    });
    return () => controller.abort();
  }, [day, attempt]);

  return (
    <section
      className={["logInPublic", className].filter(Boolean).join(" ")}
      aria-labelledby="log-in-public-title"
      aria-busy={state.status === "loading"}
    >
      <header className="logInPublicHead">
        <Kicker>Logged in public</Kicker>
        <h2 id="log-in-public-title">
          Pint prices logged today, <time dateTime={day}>{dayLabel}</time>
        </h2>
        <p className="logInPublicLine">
          What drinkers paid in London today, newest first. Each price is as the drinker logged it.
        </p>
      </header>

      {state.status === "loading" ? (
        <p className="logInPublicStatus" role="status">Reading today&apos;s prices.</p>
      ) : state.status === "error" ? (
        <EmptyState
          className="logInPublicEmpty"
          title="We could not read today's prices."
          action={
            <Button type="button" variant="ghost" onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}>
              Try again
            </Button>
          }
        />
      ) : state.drops.length === 0 ? (
        <EmptyState className="logInPublicEmpty" title="No prices from today in these public results.">
          Log what you paid to add a Pint Drop.
        </EmptyState>
      ) : (
        <>
          <RowList className="logInPublicList" label={`Pint prices logged on ${dayLabel}`}>
            {(showAll ? state.drops : state.drops.slice(0, MAX_ROWS)).map((drop) => <DropRow key={drop.id} drop={drop} />)}
          </RowList>
          {!showAll && state.drops.length > MAX_ROWS ? (
            <Button type="button" variant="ghost" className="logInPublicMore" onClick={() => setShowAll(true)}>
              Show more prices from today
            </Button>
          ) : null}
        </>
      )}

      <div className="logInPublicAction">
        <Button asChild variant="secondary">
          <Link prefetch={false} href={LOG_IN_PUBLIC_HREF}>Log a pint</Link>
        </Button>
      </div>
    </section>
  );
}
