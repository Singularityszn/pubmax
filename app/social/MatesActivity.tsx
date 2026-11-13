"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";

import PriceBadge from "@/components/PriceBadge";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { RowList, RowListItem } from "@/components/ui/row-list";
import { authedActionFetch } from "@/lib/authedFetch";
import { formatGbp } from "@/lib/formatGbp";
import { MATES_BOARD_COPY } from "@/lib/matesBoard";
import { CHALLENGE_COPY } from "@/lib/challenges";
import {
  matesActivityBillLine,
  parseMatesActivity,
  type MatesActivityPint,
  type MatesActivityItem,
} from "@/lib/matesActivity";
import { matesPriceDay, matesPriceDrink } from "@/lib/matesPrices";
import { discardBody } from "@/lib/responseBody";

import "./matesActivity.css";

const FIRST_ROWS = 5;

type State =
  | { status: "loading" }
  | { status: "ready"; items: MatesActivityItem[] }
  | { status: "error" };

function PintRow({ item, now }: { item: MatesActivityPint; now: Date }) {
  const bill = matesActivityBillLine(item);
  return (
    <RowListItem
      href={item.venueMapUrl as Route}
      title={item.venueName}
      meta={
        <>
          @{item.handle} logged {matesPriceDrink(item)}{" "}
          <time dateTime={item.loggedAt}>{matesPriceDay(item.loggedAt, now)}</time>
        </>
      }
      detail={bill ? <p className="matesActivityBill">{bill}</p> : undefined}
      trailing={item.priceGbp !== null ? <PriceBadge variant="neutral">{formatGbp(item.priceGbp)}</PriceBadge> : undefined}
    />
  );
}

/**
 * The pints the reader's mates logged, on the Following lane. Mounted only for
 * a verified Social reader, and remounted with the page on an account switch.
 */
export default function MatesActivity() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    authedActionFetch("/api/social/mates-activity", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }, { requiresIdentity: true })
      .then(async (response) => {
        if (!response.ok) {
          discardBody(response);
          throw new Error("Mates' pints unavailable");
        }
        const items = parseMatesActivity(await response.json());
        if (!items) throw new Error("Mates' pints malformed");
        if (!controller.signal.aborted) setState({ status: "ready", items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [attempt]);

  const now = new Date();
  return (
    <section
      className="matesActivity"
      aria-labelledby="mates-activity-title"
      aria-busy={state.status === "loading"}
    >
      <header>
        <h2 id="mates-activity-title">Your mates&apos; pints and challenges</h2>
        <p className="matesActivityLine">
          Pints logged and challenges finished, newest first. Each price is as your mate logged it.
        </p>
        <Link prefetch={false} href="/social/leaderboard" className="matesActivityBoard">
          {MATES_BOARD_COPY.door}
        </Link>
      </header>
      {state.status === "loading" ? (
        <p className="matesActivityLine" role="status">Reading your mates&apos; pints.</p>
      ) : state.status === "error" ? (
        <EmptyState
          title="We could not read your mates' pints."
          action={
            <Button type="button" variant="ghost" onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}>
              Try again
            </Button>
          }
        />
      ) : state.items.length === 0 ? (
        <p className="matesActivityLine" role="status">
          No pints or finished challenges from your mates yet.
        </p>
      ) : (
        <>
          <RowList label="Pints and challenges from your mates">
            {(showAll ? state.items : state.items.slice(0, FIRST_ROWS)).map((item) => (
              item.kind === "challenge_finished" ? (
                <RowListItem key={item.id} href={`/u/${encodeURIComponent(item.handle)}` as Route}
                  title={CHALLENGE_COPY.titles[item.challengeId]}
                  meta={<>@{item.handle} finished a challenge <time dateTime={item.loggedAt}>{matesPriceDay(item.loggedAt, now)}</time></>}
                />
              ) : <PintRow key={item.id} item={item} now={now} />
            ))}
          </RowList>
          {!showAll && state.items.length > FIRST_ROWS ? (
            <Button type="button" variant="ghost" className="matesActivityMore" onClick={() => setShowAll(true)}>
              Show more from your mates
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
