"use client";

import Link from "next/link";
import { useEffect } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { trackEvent } from "@/lib/analytics";
import {
  OUT_DAY_WINDOWS,
  outCardObservedAt,
  outListingsEmptyLine,
  type OutDayWindow,
  type OutListingsReadStatus,
} from "@/lib/outListings";
import { handleRovingRadioKeyDown } from "@/lib/rovingRadioGroup";
import { checkedLabel, WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";
import { EMPTY_KIND_OBSERVED_AT, type WhatsOnKindObservedAt, type WhatsOnRow } from "@/lib/whatsOn";

import "./out.css";

const DAY_LABEL: Record<OutDayWindow, string> = {
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  weekend: "Weekend",
};

export default function OutClient({
  day,
  rows,
  kindObservedAt = EMPTY_KIND_OBSERVED_AT,
  readStatus = "ready",
}: {
  day: OutDayWindow;
  /** Already filtered to this window on the server, against one clock. */
  rows: WhatsOnRow[];
  kindObservedAt?: WhatsOnKindObservedAt;
  readStatus?: OutListingsReadStatus;
}) {
  const listings = rows;

  useEffect(() => {
    trackEvent("out_screen_view");
  }, []);

  return (
    <main id="main" className="outPage" data-testid="out-screen">
      <SiteNav active="out" />

      <header className="outHead">
        <h1 className="outTitle">Out</h1>
        <div
          className="outDayChips"
          role="radiogroup"
          aria-label="When"
          onKeyDown={handleRovingRadioKeyDown}
        >
          {OUT_DAY_WINDOWS.map((windowKey) => {
            const selected = windowKey === day;
            const href = windowKey === "tonight" ? "/out" : `/out?day=${windowKey}`;
            return (
              <Link
                key={windowKey}
                href={href}
                role="radio"
                className="outDayChip"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => trackEvent("out_filter_select", { kind: windowKey })}
              >
                {DAY_LABEL[windowKey]}
              </Link>
            );
          })}
        </div>
      </header>

      <section className="outPlans" aria-labelledby="out-plans-heading">
        <h2 id="out-plans-heading" className="outSectionTitle">
          Open plans
        </h2>
        <p className="outEmpty">
          No open plans yet -{" "}
          <Link href="/plan" className="outEmptyLink">
            start one
          </Link>
        </p>
      </section>

      <section className="outListings" aria-labelledby="out-listings-heading">
        <h2 id="out-listings-heading" className="outSectionTitle">
          {DAY_LABEL[day]}
        </h2>
        {listings.length === 0 ? (
          <div className="outEmptyBlock">
            <p className="outEmpty">{outListingsEmptyLine(readStatus, day)}</p>
            <div className="outEmptyWays">
              <Link href="/plan" className="outEmptyWay">
                Start an open plan
              </Link>
              <Link href="/map" className="outEmptyWay">
                See the map
              </Link>
            </div>
          </div>
        ) : (
          <ul className="outCardList">
            {listings.map((row) => (
              <li key={row.id} className="outCard">
                <p className="outCardKind">{WHATS_ON_KIND_META[row.kind].label}</p>
                <h3 className="outCardTitle">{row.title}</h3>
                <p className="outCardPlace">{row.placeName}</p>
                {/* A card is ONE row, so it prints that row's own day. The
                    per-kind map is a lane stamp and is only the fallback. */}
                <p className="outCardMeta">
                  {row.source.label}
                  <span aria-hidden="true"> · </span>
                  {checkedLabel(outCardObservedAt(row, kindObservedAt))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="outCredit" data-out-credit="" />
    </main>
  );
}
