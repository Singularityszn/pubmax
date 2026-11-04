// Flagship "Historic Pubs" discovery surface. Entries stay server-rendered so
// sourced heritage text and links are present in the first document without
// serialising the full venue dataset into a client boundary. Filter controls
// own URL state in HistoricFilters.tsx.
//
// The index reads like a register, oldest first (taste plan, 18 Oct 2026): a
// date column down the left, and beside it the pub's name, where it is, its
// grade, its cited sentence in full and where that sentence came from. It was
// three columns of identical cards, each with a truncated hook, a "Show more",
// two coral pills and coral date chips.
//
// Honest by construction: every entry renders only what the record carries: a
// date only when one is stated, and always with what it dates ("Founded",
// "Built"), a grade only when listed, the hook verbatim, and a citation link
// derived strictly from the data's own sourceRef. Nothing is fabricated; the
// lede names the sources and the count out loud.
//
// The head is the Screen primitive (docs/design/LAUNCH_SCREENS.md): the map is
// the one primary action and a crawl is the quiet way onward.

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import DesktopRail from "@/components/desktop/DesktopRail";
import DataCreditsLink from "@/components/legal/DataCreditsLink";
import PlacePhoto from "@/components/listing/PlacePhoto";
import { boroughPlacePhoto, pubPlacePhoto } from "@/components/listing/placePhotoRules";
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

import "@/components/listing/listing.css";
import "./historic.css";

/** The whole index, counted on the server, for the desktop side pane. */
export type HistoricIndexSummary = {
  total: number;
  boroughs: number;
  listed: number;
  oldest: { name: string; slug: string; dateLabel: string } | null;
  /** The pub the lead photograph shows, when we hold a photograph of one. */
  leadPub: {
    name: string;
    slug: string;
    venueId: string | null;
    dateLabel: string | null;
    listed: string | null;
  } | null;
};

// "Founded 1520" reads "founded 1520" inside a sentence.
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// The side pane beside the register at desktop widths (the DesktopRail
// pattern, components/desktop/DesktopRail.tsx). A phone never shows it: the
// register is the page there, and the pane's photograph would push the first
// entry under the fold. Two things only: a photograph and the index in four
// figures.
//
// The photograph is honest by construction (components/listing/placePhotoRules.ts):
// with a borough chosen it is that borough's own photograph, captioned with
// the place it shows; otherwise it is The Black Friar, a listed pub on this
// register, named and linked to its own entry. A borough we hold no
// photograph of gets no photograph, never a stand-in.
function HistoricPane({
  summary,
  borough,
}: {
  summary: HistoricIndexSummary;
  borough: string | null;
}) {
  const lead = summary.leadPub;
  const photo = borough ? boroughPlacePhoto(borough) : pubPlacePhoto(lead?.venueId);
  const leadFacts = lead
    ? [lead.dateLabel, listedBadge(lead.listed)].filter(Boolean).join(", ")
    : "";
  return (
    <DesktopRail className="historicPane" ariaLabel="About this index">
      {photo ? (
        <PlacePhoto
          className="historicPanePhoto"
          photo={photo}
          sizes="18rem"
          caption={
            !borough && lead ? (
              <p className="historicPaneLead">
                <Link href={`/historic/${lead.slug}`}>{lead.name}</Link>
                {leadFacts ? <span>{leadFacts}</span> : null}
              </p>
            ) : null
          }
        />
      ) : null}
      <section className="historicPaneIndex" aria-labelledby="historicPaneHeading">
        <h2 id="historicPaneHeading" className="historicPaneHeading">
          The whole index
        </h2>
        <dl className="historicPaneFigures">
          <div>
            <dt>Pubs on record</dt>
            <dd>{summary.total}</dd>
          </div>
          <div>
            <dt>Boroughs</dt>
            <dd>{summary.boroughs}</dd>
          </div>
          <div>
            <dt>Listed buildings</dt>
            <dd>{summary.listed}</dd>
          </div>
        </dl>
        {summary.oldest ? (
          <p className="historicPaneOldest">
            The oldest stated date is{" "}
            <Link href={`/historic/${summary.oldest.slug}`}>{summary.oldest.name}</Link>,{" "}
            {lowerFirst(summary.oldest.dateLabel)}.
          </p>
        ) : null}
      </section>
    </DesktopRail>
  );
}

// The date column: the stated value as the figure and what it dates as the
// word under it. "Founded 1520" becomes 1520 over Founded. When the label does
// not end in its value, the whole label stays together in the meta line
// instead, so a year never stands bare (lib/heritageDate.mjs).
function dateParts(pub: HistoricPub): { figure: string; kind: string } | null {
  const label = pub.dateLabel ?? null;
  const value = pub.dateValue ?? null;
  if (!label || !value || !label.endsWith(value)) return null;
  const kind = label.slice(0, label.length - value.length).trim();
  if (!kind) return null;
  return { figure: value.replace(/ century$/, " c."), kind };
}

export default function HistoricPageClient({
  pubs,
  totalPubs,
  matchingPubs,
  boroughs,
  filters,
  page,
  totalPages,
  summary,
}: {
  pubs: HistoricPub[];
  totalPubs: number;
  matchingPubs: number;
  boroughs: string[];
  filters: HistoricFilterQuery;
  page: number;
  totalPages: number;
  summary: HistoricIndexSummary;
}): React.JSX.Element {
  const filtersActive =
    filters.borough !== null || filters.listedOnly || filters.hasDate;
  const firstShown = matchingPubs === 0 ? 0 : (page - 1) * INDEX_PAGE_SIZE + 1;
  const lastShown = matchingPubs === 0 ? 0 : firstShown + pubs.length - 1;

  return (
    <main id="main" className="historicPage listingShell">
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
            invented. <DataCreditsLink className="historicCreditsLink" />
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
          <div className="historicLayout">
            <div className="historicColumn">
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
                <ol className="historicList">
                  {pubs.map((pub) => {
                    const href = citationHref(pub);
                    const date = dateParts(pub);
                    // A date the column cannot split keeps its whole label.
                    const looseDate = date ? null : (pub.dateLabel ?? pub.era);
                    const grade = listedBadge(pub.listed);
                    const status = venueStatusBadge(pub.venueStatus);
                    const meta = [pub.borough, looseDate, grade, status].filter(Boolean).join(", ");
                    // Only a photograph OF this pub, matched by venue id.
                    const photo = pubPlacePhoto(pub.venueId);
                    return (
                      <li key={pub.slug} className="historicEntry">
                        <p className="historicDate">
                          {date ? (
                            <>
                              <span className="historicDateKind">{date.kind}</span>{" "}
                              <span className="historicDateFigure">{date.figure}</span>
                            </>
                          ) : null}
                        </p>
                        <div className="historicEntryBody">
                          <h2 className="historicEntryName">
                            <Link href={`/historic/${pub.slug}`}>{pub.name}</Link>
                          </h2>
                          {meta ? <p className="historicEntryMeta">{meta}</p> : null}
                          <p className="historicHook">{pub.hook}</p>
                          {photo ? (
                            <PlacePhoto
                              className="historicEntryPhoto"
                              photo={photo}
                              sizes="(min-width: 561px) 16rem, calc(100vw - 4rem)"
                            />
                          ) : null}
                          <p className="historicProvenance">
                            {href ? (
                              <a
                                className="historicCite"
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {citationLabel(href)}
                                <ExternalLink size={14} aria-hidden="true" />
                              </a>
                            ) : null}
                            {pub.venueId ? (
                              <Link prefetch={false}
                                className="historicMapLink"
                                href={`/map?sel=${pub.venueId}`}
                                aria-label={`See ${pub.name} on the map`}
                              >
                                On the map
                              </Link>
                            ) : null}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
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
              <p className="historicTimeMachine">
                <Link href="/time-machine">Pint price time machine</Link>: what a pint cost at London
                pubs in past years, from dated reviews.
              </p>
            </div>
            <HistoricPane summary={summary} borough={filters.borough} />
          </div>
        )}
      </Screen>
    </main>
  );
}
