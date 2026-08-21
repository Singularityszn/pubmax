"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { OutCardBody } from "@/components/out/OutCard";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import { OutOpenPlanCard } from "@/components/out/OutOpenPlanCard";
import ListingsSkeleton from "@/components/out/ListingsSkeleton";
import { useOutListings } from "@/components/out/useOutListings";
import { trackEvent } from "@/lib/analytics";
import { outCardSource } from "@/lib/out/attribution";
import {
  groupOutListings,
  outOpenPlansSectionVisible,
  sendableOpenPlans,
} from "@/lib/outDesktopGrouping";
import {
  OUT_DAY_WINDOWS,
  OUT_OPEN_PLANS_WAY_LABEL,
  outListingsSectionTitle,
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

  const listingGroups = groupOutListings(body?.events ?? []);
  const sendablePlans = sendableOpenPlans(body?.openPlans ?? []);
  const showOpenPlans = outOpenPlansSectionVisible(body?.openPlans ?? []);

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
              <Link prefetch={false}
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
          {outListingsSectionTitle(day)}
        </h2>
        {pending ? <ListingsSkeleton /> : null}
        {outStatusLines({ body, failed }).map((line) => (
          <p className="outStatus" key={line}>
            {line}
          </p>
        ))}
        <div className="outListingSurface">
          {listingGroups.map((group) => (
            <section
              key={group.key}
              className="outGroup"
              aria-labelledby={`out-group-${group.key}`}
            >
              <h3 id={`out-group-${group.key}`} className="outGroupTitle">
                {group.label}
              </h3>
              <ul className="outGroupList">
                {group.rows.map((row) => (
                  <li key={row.id} className="outListingRow">
                    <div className="outListingGig">
                      <OutCardBody row={row} onOpen={() => onOpen(row)} titleLevel={4} />
                    </div>
                    <OutListingPubPair row={row} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      {showOpenPlans ? (
        <section className="outPlans" aria-labelledby="out-plans-heading">
          <h2 id="out-plans-heading" className="outSectionTitle outPlansSectionTitle">
            Open plans
          </h2>
          <ul className="outOpenPlanList">
            {sendablePlans.map((plan) => (
              <OutOpenPlanCard key={plan.crewId} plan={plan} />
            ))}
          </ul>
          <p className="outPlansFoot">
            <Link prefetch={false} href="/plan" className="outPlansFootLink">
              {OUT_OPEN_PLANS_WAY_LABEL}
            </Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
