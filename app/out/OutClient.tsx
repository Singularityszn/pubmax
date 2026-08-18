"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { OutCard } from "@/components/out/OutCard";
import ListingsSkeleton from "@/components/out/ListingsSkeleton";
import { useOutListings } from "@/components/out/useOutListings";
import { trackEvent } from "@/lib/analytics";
import { outCardSource } from "@/lib/out/attribution";
import {
  OUT_DAY_WINDOWS,
  OUT_LIVE_EVENTS_SECTION_TITLE,
  OUT_OPEN_PLANS_PLACEHOLDER_LINE,
  OUT_OPEN_PLANS_WAY_LABEL,
  type OutDayWindow,
} from "@/lib/outListings";
import { outStatusLines } from "@/lib/out/outStatus";
import { handleSegmentLinkKeyDown } from "@/lib/segmentLinkKeys";
import type { WhatsOnRow } from "@/lib/whatsOn";

import "./out.css";

const DAY_LABEL: Record<OutDayWindow, string> = {
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  weekend: "Weekend",
};

export default function OutClient({ day }: { day: OutDayWindow }) {
  const { body, failed, pending } = useOutListings(day);

  useEffect(() => {
    trackEvent("out_screen_view");
  }, []);

  const onOpen = useCallback((row: WhatsOnRow) => {
    trackEvent("out_card_opened", { source: outCardSource(row.source.label) });
  }, []);

  return (
    <main id="main" className="outPage" data-testid="out-screen">
      <SiteNav active="out" />

      <header className="outHead">
        <h1 className="outTitle">Out</h1>
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

      <section className="outListings" aria-labelledby="out-listings-heading">
        <h2 id="out-listings-heading" className="outSectionTitle">
          {OUT_LIVE_EVENTS_SECTION_TITLE}
        </h2>
        {pending ? <ListingsSkeleton /> : null}
        {outStatusLines({ body, failed }).map((line) => (
          <p className="outStatus" key={line}>
            {line}
          </p>
        ))}
        <ul className="outList">
          {(body?.events ?? []).map((row) => (
            <OutCard key={row.id} row={row} onOpen={() => onOpen(row)} />
          ))}
        </ul>
      </section>

      <section className="outPlans" aria-labelledby="out-plans-heading">
        <h2 id="out-plans-heading" className="outSectionTitle outPlansSectionTitle">
          Open plans
        </h2>
        <p className="outPlansPlaceholder">
          {OUT_OPEN_PLANS_PLACEHOLDER_LINE}{" "}
          <Link href="/plan" className="outPlansPlaceholderLink">
            {OUT_OPEN_PLANS_WAY_LABEL}
          </Link>
        </p>
      </section>
    </main>
  );
}
