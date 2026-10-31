import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import { displayDrinkName, plainDashes } from "@/components/listing/displayCase";
import { RowList, RowListItem } from "@/components/ui/row-list";
import Screen from "@/components/ui/screen";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { formatGbp } from "@/lib/formatGbp";
import { listedPriceReceipt } from "@/lib/listedPriceReceipt";
import {
  buildNamedRoute,
  namedRouteCrawl,
  namedRouteDescription,
  namedRoutePath,
  namedRouteTitle,
  NAMED_ROUTES,
  straightLineMinutesLabel,
  type NamedRouteSlug,
  type NamedRouteStop,
} from "@/lib/namedRoutes";
import { loadGroupedVenues } from "@/lib/venueDataset";

import "@/components/listing/listing.css";

// A named route page (SEO audit #2126, findings 15, 16 and 26): one curated
// crawl, its stops in order, each stop's cheapest listed pint with its
// publisher and read day, and the straight-line walk between stops. The
// namespace is /routes; /crawls/[slug] belongs to user Crawl Stories.
//
// THIS DOCUMENT IS PRERENDERED (captain's decision, 30 Oct 2026, recorded in
// proxy.ts beside CDN_CACHED_DOCUMENT_ROUTES): it drops the per-request CSP
// nonce so the Vercel CDN can hold it. It renders only bundled data and reads
// no cookie, no header and no search param. `__tests__/cdnCachedDocuments.test.ts`
// holds both rules.
export const dynamic = "force-static";
// The dataset changes only on a deploy, so an hour is the same quiet ceiling
// the other SEO route shapes take.
export const revalidate = 3600;
// Only the four named routes render at all.
export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  return NAMED_ROUTES.map(({ slug }) => ({ slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

function isNamedRouteSlug(slug: string): slug is NamedRouteSlug {
  return NAMED_ROUTES.some((route) => route.slug === slug);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const crawl = isNamedRouteSlug(slug) ? namedRouteCrawl(slug) : null;
  if (!crawl || !isNamedRouteSlug(slug)) {
    return { title: "Pub crawl route", robots: { index: false, follow: false } };
  }
  // The layout's template adds the brand to the document title. The share
  // card is not templated, so it carries the brand itself.
  const title = namedRouteTitle(crawl);
  const cardTitle = appPageTitle(title);
  const description = namedRouteDescription(crawl, plainDashes(crawl.blurb));
  const canonical = namedRoutePath(slug);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title: cardTitle,
      description,
      type: "article",
      url: canonical,
      siteName: metadataSiteName(),
      images: ["/og.png"],
    },
    twitter: { card: "summary", title: cardTitle, description },
  };
}

function stopMeta(stop: NamedRouteStop) {
  const place = `${[stop.address, stop.area].filter(Boolean).join(", ")}.`;
  const pint = stop.pint
    ? `${displayDrinkName(stop.pint.drinkName)}. ${listedPriceReceipt({
        priceSource: stop.pint.source ?? undefined,
        priceObservedAt: stop.pint.readDay ?? undefined,
      })}`
    : "No listed price.";
  const leg = stop.legKm !== null ? `${straightLineMinutesLabel(stop.legKm)} from the stop before.` : null;
  return [place, pint, leg].filter(Boolean).join(" ");
}

export default async function NamedRoutePage({ params }: PageProps) {
  const { slug } = await params;
  if (!isNamedRouteSlug(slug)) notFound();
  const venues = await loadGroupedVenues();
  // A dataset we could not read is never held: the page throws, so ISR keeps
  // the last good copy (or holds nothing) and the next request reads again.
  // A cached page of empty stops would stand for the whole window.
  if (venues.length === 0) throw new Error("venue dataset unavailable");
  const route = buildNamedRoute(slug, venues);
  if (!route) notFound();
  const { crawl, stops, totalKm } = route;
  const stopCount = crawl.venueIds.length;

  return (
    <main id="main" className="routePage listingShell">
      <SiteNav active="crawls" />
      <Screen
        kicker="Pub crawl route"
        title={crawl.name}
        lede={plainDashes(crawl.blurb)}
        primary={
          <Link prefetch={false} href={route.mapHref} aria-label={`Plan the ${crawl.name} crawl on the map`}>
            Plan this crawl
          </Link>
        }
        secondary={<Link href="/crawls">All crawl routes</Link>}
      >
        <p className="listingSectionDek">
          {stopCount} stops, first to last.{" "}
          {totalKm !== null
            ? `The whole route is ${straightLineMinutesLabel(totalKm)}.`
            : "We cannot place every stop, so we show no route total."}{" "}
          Free to follow, and nobody leads it.
        </p>
        <RowList label={`${crawl.name} stops`} className="listingRead">
          {stops.map((stop) => (
            <RowListItem
              key={stop.venueId}
              lead={stop.position}
              href={`/ledger/${encodeURIComponent(stop.venueId)}` as Route}
              title={stop.name}
              meta={stopMeta(stop)}
              trailing={stop.pint ? formatGbp(stop.pint.priceGbp) : undefined}
            />
          ))}
        </RowList>
      </Screen>
    </main>
  );
}
