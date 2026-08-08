"use client";

// Compact desktop-rail summary for /tonight. The main column owns the full
// listing spine; this panel only counts kinds and names a few headlines, then
// hands off to #tonight-list. Never a second card list.

import Link from "next/link";
import { CalendarClock } from "lucide-react";

import type { WhatsOnKind, WhatsOnRow } from "@/lib/whatsOn";
import { WHATS_ON_KIND_META, type WhatsOnKindFacet } from "@/lib/whatsOnBadges";

export type TonightOnTonightSummaryProps = {
  facets: WhatsOnKindFacet[];
  /** Display rows in list order; only the first few titles are named. */
  rows: WhatsOnRow[];
  totalCount: number;
};

const TOP_TITLE_LIMIT = 3;

function facetLine(facet: WhatsOnKindFacet): string {
  const noun = WHATS_ON_KIND_META[facet.kind].label.toLowerCase();
  if (facet.count === 1) return `1 ${noun}`;
  return `${facet.count} ${noun}`;
}

export default function TonightOnTonightSummary({
  facets,
  rows,
  totalCount,
}: TonightOnTonightSummaryProps) {
  if (totalCount === 0 || facets.length === 0) return null;

  const topTitles = rows.slice(0, TOP_TITLE_LIMIT);
  const facetKinds = new Set<WhatsOnKind>(facets.map((facet) => facet.kind));
  const headlineKinds = facets
    .filter((facet) => facet.kind === "music" || facet.kind === "deal")
    .map((facet) => facetLine(facet));
  const otherKinds = facets
    .filter((facet) => facet.kind !== "music" && facet.kind !== "deal")
    .map((facet) => facetLine(facet));
  const kindLines = [...headlineKinds, ...otherKinds];

  return (
    <section
      className="tonightOnTonightSummary"
      aria-labelledby="tonight-rail-summary-title"
      data-testid="tonight-rail-summary"
    >
      <div className="tonightOnTonightSummaryHead">
        <h2 id="tonight-rail-summary-title">
          <CalendarClock size={18} aria-hidden="true" />
          On tonight
        </h2>
        <span className="tonightOnTonightSummaryCount">
          {totalCount} listing{totalCount === 1 ? "" : "s"}
        </span>
      </div>
      {kindLines.length > 0 ? (
        <p className="tonightOnTonightSummaryKinds">{kindLines.join(" · ")}</p>
      ) : null}
      {topTitles.length > 0 ? (
        <ul className="tonightOnTonightSummaryTitles" aria-label="Headline listings">
          {rows.slice(0, TOP_TITLE_LIMIT).map((row) => (
            <li key={row.id}>{row.title}</li>
          ))}
        </ul>
      ) : null}
      {facetKinds.has("music") || facetKinds.has("deal") ? (
        <p className="tonightOnTonightSummaryNote">
          Full cards, dates and sources sit in the main list.
        </p>
      ) : null}
      <Link className="tonightOnTonightSummaryLink pressable" href="#tonight-list">
        See tonight&apos;s listings
      </Link>
    </section>
  );
}
