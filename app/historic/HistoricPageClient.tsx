// Flagship "Historic Pubs" discovery surface. Cards stay server-rendered so
// sourced heritage text and links are present in the first document without
// serialising the full venue dataset into a client boundary. Filter controls
// own URL state in HistoricFilters.tsx.
//
// Honest by construction: every card renders only what the record carries — an
// era chip only when era is present, a grade badge only when listed, the hook
// verbatim, and a citation link derived strictly from the data's own sourceRef.
// Nothing is fabricated; the lede names the sources and the count out loud.
//
// The head is the Screen primitive (docs/design/LAUNCH_SCREENS.md): the map is
// the one primary action and a crawl is the quiet way onward.

import Link from "next/link";
import { ArrowUpRight, ExternalLink } from "lucide-react";

import { ProseDisclosure } from "@/components/Disclosure";
import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import type { HistoricPub } from "@/lib/historic";
import {
  citationHref,
  citationLabel,
  listedBadge,
  venueStatusBadge,
} from "@/lib/historicFilter";
import {
  historicCountLine,
  historicIndexHref,
  INDEX_PAGE_SIZE,
  type HistoricFilterQuery,
} from "@/lib/pageFilters";
import HistoricFilters from "./HistoricFilters";

import "./historic.css";

export default function HistoricPageClient({
  pubs,
  totalPubs,
  matchingPubs,
  boroughs,
  filters,
  page,
  totalPages,
}: {
  pubs: HistoricPub[];
  totalPubs: number;
  matchingPubs: number;
  boroughs: string[];
  filters: HistoricFilterQuery;
  page: number;
  totalPages: number;
}): React.JSX.Element {
  const filtersActive =
    filters.borough !== null || filters.listedOnly || filters.hasDate;
  const firstShown = matchingPubs === 0 ? 0 : (page - 1) * INDEX_PAGE_SIZE + 1;
  const lastShown = matchingPubs === 0 ? 0 : firstShown + pubs.length - 1;

  return (
    <main id="main" className="historicPage">
      <SiteNav active="historic" />

      <Screen
        as="section"
        className="historicScreen"
        kicker="Historic pubs"
        title={<>London&rsquo;s historic pubs</>}
        titleId="historicHeading"
        lede={
          <>
            {totalPubs} notable pubs, cited from Wikipedia and Wikidata. Never
            invented.
          </>
        }
        primary={<Link prefetch={false} href="/map">Open the map</Link>}
        secondary={<Link href="/crawls">Start a crawl</Link>}
      >
        {totalPubs === 0 ? (
          <EmptyState title="The historic index isn’t loading just now.">
            The <Link prefetch={false} href="/map">map</Link> is still up, and it still knows where
            the cheap pints are.
          </EmptyState>
        ) : (
          <>
            <HistoricFilters boroughs={boroughs} filters={filters} />

            <p className="historicCount" role="status" aria-live="polite">
              {historicCountLine({ firstShown, lastShown, matchingPubs, totalPubs })}
            </p>

            {pubs.length === 0 ? (
              <EmptyState
                title="Nothing matches those filters."
                action={
                  filtersActive ? <Link href="/historic">Clear filters</Link> : undefined
                }
              >
                We only show pubs we can cite. Nothing is invented to fill the gap.
              </EmptyState>
            ) : (
              <ul className="historicGrid">
                {pubs.map((pub) => {
                  const href = citationHref(pub);
                  // The date chip states what the date is OF, never a bare
                  // year (lib/heritageDate.mjs).
                  const dateLabel = pub.dateLabel ?? pub.era;
                  const grade = listedBadge(pub.listed);
                  const status = venueStatusBadge(pub.venueStatus);
                  return (
                    <li key={pub.slug} className="historicCard">
                      <div className="historicCardMeta">
                        {dateLabel ? (
                          <span className="historicEra">{dateLabel}</span>
                        ) : null}
                        {grade ? (
                          <span className="historicGrade">{grade}</span>
                        ) : null}
                        {status ? (
                          <span className="historicGrade">{status}</span>
                        ) : null}
                      </div>

                      <h2 className="historicCardName">{pub.name}</h2>

                      {pub.borough ? (
                        <p className="historicBorough">{pub.borough}</p>
                      ) : null}

                      <div className="historicHook">
                        <ProseDisclosure text={pub.hook} />
                      </div>

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
                          <Link prefetch={false}
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
            {totalPages > 1 ? (
              <nav className="historicPagination" aria-label="Historic pub pages">
                {page > 1 ? (
                  <Link href={historicIndexHref(filters, page - 1)}>Previous</Link>
                ) : <span />}
                <span>Page {page} of {totalPages}</span>
                {page < totalPages ? (
                  <Link href={historicIndexHref(filters, page + 1)}>Next</Link>
                ) : <span />}
              </nav>
            ) : null}
          </>
        )}
      </Screen>
    </main>
  );
}
