"use client";

// Flagship "Historic Pubs" discovery surface (client half). Owns all filter +
// sort state; the pure logic lives in lib/historicFilter so it stays testable.
//
// Honest by construction: every card renders only what the record carries — an
// era chip only when era is present, a grade badge only when listed, the hook
// verbatim, and a citation link derived strictly from the data's own sourceRef.
// Nothing is fabricated; the subtitle names the sources and the count out loud.

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, ExternalLink } from "lucide-react";

import SiteNav from "@/components/nav/SiteNav";
import type { HistoricPub } from "@/lib/historic";
import {
  availableBoroughs,
  citationHref,
  citationLabel,
  DEFAULT_HISTORIC_FILTERS,
  filterAndSortHistoric,
  listedBadge,
  type HistoricSort,
} from "@/lib/historicFilter";

import "./historic.css";

const SORT_OPTIONS: { value: HistoricSort; label: string }[] = [
  { value: "oldest", label: "Oldest first" },
  { value: "az", label: "A–Z" },
  { value: "borough", label: "By borough" },
];

export default function HistoricPageClient({
  pubs,
}: {
  pubs: HistoricPub[];
}): React.JSX.Element {
  const [borough, setBorough] = useState<string | null>(
    DEFAULT_HISTORIC_FILTERS.borough,
  );
  const [listedOnly, setListedOnly] = useState(
    DEFAULT_HISTORIC_FILTERS.listedOnly,
  );
  const [hasDate, setHasDate] = useState(DEFAULT_HISTORIC_FILTERS.hasDate);
  const [sort, setSort] = useState<HistoricSort>(DEFAULT_HISTORIC_FILTERS.sort);

  const boroughs = useMemo(() => availableBoroughs(pubs), [pubs]);
  const visible = useMemo(
    () => filterAndSortHistoric(pubs, { borough, listedOnly, hasDate, sort }),
    [pubs, borough, listedOnly, hasDate, sort],
  );

  const filtersActive = borough !== null || listedOnly || hasDate;
  const resetFilters = () => {
    setBorough(null);
    setListedOnly(false);
    setHasDate(false);
  };

  return (
    <main className="historicPage">
      <SiteNav active="historic" />

      <header className="historicHead">
        <p className="historicEyebrow">Historic pubs</p>
        <h1 className="historicTitle">London&rsquo;s Historic Pubs</h1>
        <p className="historicLede">
          {pubs.length} notable pubs, cited from Wikipedia and Wikidata. Never
          invented.
        </p>
      </header>

      {pubs.length === 0 ? (
        <p className="historicStatus" role="status">
          The historic index isn&rsquo;t loading just now. The{" "}
          <Link href="/map">map</Link> is still up, and it still knows where the
          cheap pints are.
        </p>
      ) : (
        <>
          <section
            className="historicFilters"
            aria-label="Filter and sort historic pubs"
          >
            <div className="historicField">
              <label className="historicFieldLabel" htmlFor="historic-borough">
                Borough
              </label>
              <div className="historicSelectWrap">
                <select
                  id="historic-borough"
                  className="historicSelect"
                  value={borough ?? ""}
                  onChange={(e) =>
                    setBorough(e.target.value === "" ? null : e.target.value)
                  }
                >
                  <option value="">All boroughs</option>
                  {boroughs.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="historicField">
              <label className="historicFieldLabel" htmlFor="historic-sort">
                Sort
              </label>
              <div className="historicSelectWrap">
                <select
                  id="historic-sort"
                  className="historicSelect"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as HistoricSort)}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className="historicToggles"
              role="group"
              aria-label="Narrow the list"
            >
              <button
                type="button"
                className="historicToggle"
                data-active={listedOnly}
                aria-pressed={listedOnly}
                onClick={() => setListedOnly((v) => !v)}
              >
                Listed only
              </button>
              <button
                type="button"
                className="historicToggle"
                data-active={hasDate}
                aria-pressed={hasDate}
                onClick={() => setHasDate((v) => !v)}
              >
                Has a date
              </button>
            </div>
          </section>

          <p className="historicCount" role="status" aria-live="polite">
            {visible.length === pubs.length
              ? `Showing all ${pubs.length} pubs`
              : `${visible.length} of ${pubs.length} pubs`}
          </p>

          {visible.length === 0 ? (
            <div className="historicEmpty" role="status">
              <p className="historicEmptyTitle">Nothing matches those filters.</p>
              <p className="historicEmptyBody">
                We only show pubs we can cite. Nothing is invented to fill the
                gap.{" "}
                {filtersActive ? (
                  <button
                    type="button"
                    className="historicInlineReset"
                    onClick={resetFilters}
                  >
                    Clear filters
                  </button>
                ) : null}
              </p>
            </div>
          ) : (
            <ul className="historicGrid">
              {visible.map((pub) => {
                const href = citationHref(pub);
                const grade = listedBadge(pub.listed);
                return (
                  <li key={pub.slug} className="historicCard">
                    <div className="historicCardMeta">
                      {pub.era ? (
                        <span className="historicEra">{pub.era}</span>
                      ) : null}
                      {grade ? (
                        <span className="historicGrade">{grade}</span>
                      ) : null}
                    </div>

                    <h2 className="historicCardName">{pub.name}</h2>

                    {pub.borough ? (
                      <p className="historicBorough">{pub.borough}</p>
                    ) : null}

                    <p className="historicHook">{pub.hook}</p>

                    <div className="historicProvenance">
                      <span className="historicFactCount">
                        {pub.facts.length} on record
                      </span>
                      {href ? (
                        <a
                          className="historicCite"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {citationLabel(href)}
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>

                    <div className="historicActions">
                      <Link
                        className="historicMapLink pressable"
                        href={`/historic/${pub.slug}`}
                      >
                        Read the story
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                      {pub.venueId ? (
                        <Link
                          className="historicMapLink pressable"
                          href={`/map?sel=${pub.venueId}`}
                        >
                          See on map
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
