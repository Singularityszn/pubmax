"use client";

import Link from "next/link";
import { useEffect } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { trackEvent } from "@/lib/analytics";
import {
  OUT_DAY_WINDOWS,
  OUT_OPEN_PLANS_PLACEHOLDER_LINE,
  OUT_OPEN_PLANS_WAY_LABEL,
  outCardObservedAt,
  outListingsEmptyLine,
  type OutDayWindow,
  type OutListingsReadStatus,
} from "@/lib/outListings";
import { handleSegmentLinkKeyDown } from "@/lib/segmentLinkKeys";
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
        {/* Three destinations, so three LINKS with aria-current - never a
            radiogroup, which would replace the link role and promise a Space
            key an anchor does not answer. lib/segmentLinkKeys.ts adds Space so
            both keys really work. */}
        <nav className="outDayChips" aria-label="When">
          {OUT_DAY_WINDOWS.map((windowKey) => {
            const selected = windowKey === day;
            const href = windowKey === "tonight" ? "/out" : `/out?day=${windowKey}`;
            return (
              <Link
                key={windowKey}
                href={href}
                className="outDayChip"
                aria-current={selected ? "page" : undefined}
                onKeyDown={handleSegmentLinkKeyDown}
                onClick={() => trackEvent("out_filter_select", { kind: windowKey })}
              >
                {DAY_LABEL[windowKey]}
              </Link>
            );
          })}
        </nav>
      </header>

      <section className="outPlans" aria-labelledby="out-plans-heading">
        <h2 id="out-plans-heading" className="outSectionTitle">
          Open plans
        </h2>
        {/* NOTHING here reads the viewer's plans yet, so this section may not
            say they have none: an absence claimed by a read that never ran is
            the same defect as calling a city priceless under a failed lookup.
            It says where open plans WILL appear, and offers the way to make
            one. L3 wires the real read, tri-state like every other. */}
        <p className="outEmpty">
          {OUT_OPEN_PLANS_PLACEHOLDER_LINE}{" "}
          <Link href="/plan" className="outEmptyLink">
            {OUT_OPEN_PLANS_WAY_LABEL}
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
    </main>
  );
}
