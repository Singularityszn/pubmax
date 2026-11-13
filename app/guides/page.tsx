import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import { RowList, RowListItem } from "@/components/ui/row-list";
import Screen from "@/components/ui/screen";
import { metadataSiteName } from "@/lib/brandNaming";
import { curatedCrawls } from "@/lib/curatedCrawls";
import {
  GUIDES_PATH,
  GUIDES_TITLE,
  guidePubMapHref,
  guidePubStoryHref,
  londonFamousPubs,
  pickPubOfTheWeek,
  shortGuides,
  weekStartLabel,
} from "@/lib/guides";
import { loadHistoricPubs, type HistoricPub } from "@/lib/historic";
import { citationLabel, listedBadge } from "@/lib/historicFilter";

import "./guides.css";

const DESCRIPTION =
  "A London pub of the week from our cited history list, short crawl guides you can walk tonight, and the city's oldest pubs.";

export const metadata: Metadata = {
  title: GUIDES_TITLE,
  description: DESCRIPTION,
  alternates: { canonical: GUIDES_PATH },
  openGraph: {
    title: GUIDES_TITLE,
    description: DESCRIPTION,
    type: "website",
    url: GUIDES_PATH,
    siteName: metadataSiteName(),
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: GUIDES_TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

function pubMeta(pub: Pick<HistoricPub, "dateLabel" | "borough" | "listed">): string | null {
  const parts = [pub.dateLabel, pub.borough, listedBadge(pub.listed)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default async function GuidesPage() {
  const pubs = await loadHistoricPubs();
  const pick = pickPubOfTheWeek(pubs, new Date());
  const famous = londonFamousPubs(pubs);
  const guides = shortGuides(curatedCrawls);

  return (
    <div className="guidesPage">
      <SiteNav />
      <main id="main" className="guidesMain">
        <Screen
          as="section"
          kicker="Guides"
          title={GUIDES_TITLE}
          titleId="guides-title"
          answer={
            pick ? (
              <article className="guidesPick" aria-labelledby="guides-pick-name">
                <p className="guidesPickWeek">
                  Pub of the week, from {weekStartLabel(pick.weekStartsOn)}
                </p>
                <h2 id="guides-pick-name" className="guidesPickName">
                  {pick.pub.name}
                </h2>
                {pubMeta(pick.pub) ? <p className="guidesPickMeta">{pubMeta(pick.pub)}</p> : null}
                <p className="guidesPickHook">{pick.pub.hook}</p>
                <p className="guidesNote">
                  Source:{" "}
                  <a href={pick.sourceHref} target="_blank" rel="noopener noreferrer">
                    {citationLabel(pick.sourceHref)}
                  </a>
                  . Each Monday we move to the next pub on our cited history list. It&rsquo;s
                  a turn, not a ranking.
                </p>
              </article>
            ) : (
              <p className="guidesNote">
                No pub of the week just now. Our history list did not load.
              </p>
            )
          }
          primary={
            pick ? (
              <Link prefetch={false} href={guidePubMapHref(pick.pub.venueId)}>
                Open it on the map
              </Link>
            ) : (
              <Link prefetch={false} href="/map">
                Open the map
              </Link>
            )
          }
          secondary={
            pick ? (
              <Link prefetch={false} href={guidePubStoryHref(pick.pub.slug)}>
                Read its story
              </Link>
            ) : undefined
          }
        >
          {guides.length > 0 ? (
            <section className="guidesSection" aria-labelledby="guides-routes-title">
              <h2 id="guides-routes-title" className="guidesSectionTitle">
                Short guides
              </h2>
              <p className="guidesSectionDek">
                Routes we picked by hand. Each one opens on the map with its stops in order.
              </p>
              <RowList>
                {guides.map((guide) => (
                  <RowListItem
                    key={guide.id}
                    href={guide.href}
                    title={guide.name}
                    meta={`${guide.stops} stops`}
                    detail={<p className="guidesRowDetail">{guide.blurb}</p>}
                  />
                ))}
              </RowList>
              <p className="guidesMore">
                <Link prefetch={false} href="/crawls">
                  All crawl routes
                </Link>
              </p>
            </section>
          ) : null}

          {famous.length > 0 ? (
            <section className="guidesSection" aria-labelledby="guides-famous-title">
              <h2 id="guides-famous-title" className="guidesSectionTitle">
                London&rsquo;s famous pubs
              </h2>
              <p className="guidesSectionDek">
                The oldest pubs on our history list, by the date their own record gives. Tap
                one for its story and its sources.
              </p>
              <RowList>
                {famous.map((pub) => (
                  <RowListItem
                    key={pub.slug}
                    href={guidePubStoryHref(pub.slug)}
                    title={pub.name}
                    meta={pubMeta(pub) ?? undefined}
                  />
                ))}
              </RowList>
              <p className="guidesMore">
                <Link prefetch={false} href="/historic">
                  Every historic pub
                </Link>
              </p>
            </section>
          ) : null}
        </Screen>
      </main>
    </div>
  );
}
