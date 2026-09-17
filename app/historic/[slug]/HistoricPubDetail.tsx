import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { PubPalMascot } from "@/components/pal/PubPalMascot";
import ShareBar from "@/components/share/ShareBar";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import { slugifyBorough } from "@/lib/boroughs";
import type { HistoricPub } from "@/lib/historic";
import {
  citationLabel,
  heritageSourceLabel,
  listedBadge,
  venueStatusBadge,
} from "@/lib/historicFilter";
import { buildHistoricPubShareText } from "@/lib/shareArtifacts";
import styles from "./HistoricDetail.module.css";

// One notable pub's cited heritage story, with the record already loaded. The
// page (page.tsx) reads the dataset and hands the record here; this component
// knows nothing about the dataset, so the audit can render it with a fixture.
//
// Head: docs/design/LAUNCH_SCREENS.md. The kicker names the surface, the
// heading is the pub's own name, the lede is its own cited hook, the one
// primary opens the pub on the map and the quiet way onward plans a night
// from it. A pub the map cannot resolve gets the bare map and no plan door,
// because a link naming a pub the map would drop is a promise it cannot keep.

// The map's build mode with this pub as the first stop: the same share-URL
// shape the borough chapter and a landmark's "Start a crawl here" use.
function planNightHref(venueId: string): string {
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", venueId);
  return `/map?${params.toString()}`;
}

export default function HistoricPubDetail({ pub }: { pub: HistoricPub }) {
  // The date chip states what the date is OF, never a bare year: The Captain
  // Kidd's 1701 is the year the pirate it is named after was hanged, and a bare
  // 1701 reads as the year the pub opened (lib/heritageDate.mjs).
  const dateLabel = pub.dateLabel ?? pub.era;
  const grade = listedBadge(pub.listed);
  const status = venueStatusBadge(pub.venueStatus);
  const boroughSlug = pub.borough ? slugifyBorough(pub.borough) : null;
  const mapHref = pub.venueId ? `/map?sel=${pub.venueId}` : null;
  const canonical = `/historic/${pub.slug}`;
  const shareText = buildHistoricPubShareText({ name: pub.name, hook: pub.hook });

  return (
    <>
      <p className={styles.hdBack}>
        <Link href="/historic" className={styles.hdBackLink}>
          &larr; All historic pubs
        </Link>
      </p>

      <Screen
        as="section"
        className="hdScreen"
        kicker="Historic pub"
        title={pub.name}
        titleId="hdHeading"
        lede={pub.hook || undefined}
        primary={
          mapHref ? (
            <Link prefetch={false} href={mapHref}>Open on the map</Link>
          ) : (
            <Link prefetch={false} href="/map">Open the map</Link>
          )
        }
        secondary={
          pub.venueId ? (
            <Link href={planNightHref(pub.venueId)}>Plan a night here</Link>
          ) : undefined
        }
      >
        {dateLabel || grade || status || pub.borough ? (
          <div className={styles.hdMeta}>
            {dateLabel ? <span className={styles.hdEra}>{dateLabel}</span> : null}
            {grade ? <span className={styles.hdGrade}>{grade}</span> : null}
            {status ? <span className={styles.hdGrade}>{status}</span> : null}
            {pub.borough ? (
              <span className={styles.hdBorough}>
                {boroughSlug ? (
                  <Link href={`/borough/${boroughSlug}`} className={styles.hdBoroughLink}>
                    {pub.borough}
                  </Link>
                ) : (
                  pub.borough
                )}
              </span>
            ) : null}
          </div>
        ) : null}

        <section className={styles.hdStory} aria-labelledby="hdStoryHeading">
          <h2 id="hdStoryHeading" className={styles.hdStoryHeading}>
            The record
          </h2>

          {pub.facts.length === 0 ? (
            <EmptyState title="No fuller story on record.">
              Every claim here is cited, and we won&rsquo;t invent one to fill the
              gap.
            </EmptyState>
          ) : (
            <ol className={styles.hdFacts}>
              {pub.facts.map((fact, i) => (
                <li key={`${fact.source}-${i}`} className={styles.hdFact}>
                  <p className={styles.hdFactText}>{fact.fact}</p>
                  <div className={styles.hdFactProvenance}>
                    <span className={styles.hdSource}>{heritageSourceLabel(fact.source)}</span>
                    {fact.sourceRef ? (
                      <a
                        className={styles.hdCite}
                        href={fact.sourceRef}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {citationLabel(fact.sourceRef)}
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={styles.hdActions} aria-label="Explore this pub">
          {mapHref ? (
            <div className={styles.hdActionRow}>
              <Link prefetch={false} className={`${styles.hdAction} pressable`} href={mapHref}>
                <PubPalMascot size={14} circular lazy />
                Ask your Pub Pal
              </Link>
            </div>
          ) : null}

          <ShareBar url={canonical} title={pub.name} text={shareText} />
        </section>

        <footer className={styles.hdProvenance}>
          Cited from Wikipedia and Wikidata. Never invented.
        </footer>
      </Screen>
    </>
  );
}
