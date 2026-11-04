import type { Metadata } from "next";
import Link from "next/link";
import DataCreditsLink from "@/components/legal/DataCreditsLink";

import { BRAND_NAME } from "@/lib/brandNaming";
import { getListedBuilding, type ListedBuilding } from "@/lib/heritageListings";
import { buildVenueClaims } from "@/lib/ledger";
import { CITIES } from "@/lib/cities";
import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";
import { ledgerTitleName } from "@/lib/ledgerTitle";
import { venueAreaLabel } from "@/lib/venueDisplay";
import { type Venue } from "@/lib/venues";
import JsonLd from "@/components/seo/JsonLd";
import OperatorRailPanel from "@/components/operators/OperatorRailPanel";
import {
  LedgerLiveProvider,
  LedgerLogSections,
  LedgerReadAloud,
  LedgerPriceRecord,
} from "@/components/ledger/LedgerLive";
import ShareWithFamilyButton from "@/components/ledger/ShareWithFamilyButton";
import VenuePhotoWall from "@/components/venue/VenuePhotoWall";
import { LEDGER_READ_UNAVAILABLE } from "./ledgerReadUnavailable";
import VisitReportPanel from "@/components/visits/VisitReportPanel";
import { mergePriceUpdates, parsePriceUpdates } from "@/lib/priceUpdates";
import { venueUpdateKey } from "@/lib/pubMap";
import { BUNDLE_DEFAULT_CATEGORY, bundlePricesForCategory } from "@/lib/ukPriceBundle";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import rawPriceUpdates from "@/public/data/price_updates/latest.json";
import { isPubVenueKind } from "@/lib/venueKindFilters";

import "./ledger.css";

// The Ledger (issue #25, PRD_FOR_FABLE.md § "The Spill"): a large-text,
// high-contrast, voice-friendly rendering of a venue's story for the
// Boomer/Gen-X reading surface. The venue is lookupVenueDetail, the same
// module app/api/venue/[id] calls, plus the same Pint Drop store the API
// route reads (lib/pintDropsStore), reused, not rebuilt.
//
// THIS DOCUMENT IS PRERENDERED (task vercel-f2-seo-cdn, option a; proxy.ts
// CDN_CACHED_DOCUMENT_ROUTES). It carries only what the bundled dataset knows
// about the pub: its name, address, listed-building record, structured data and
// curated story line. It reads no cookie, no header and no search param, and
// NOTHING a drinker wrote is in it, because one copy is handed to every
// visitor. The logbook, the drop-derived story lines and the Family Table are
// read per request by GET /api/ledger/[id] and drawn after load
// (components/ledger/LedgerLive.tsx), so moderation, withdrawal and erasure
// reach the page the moment the store stops returning a drop.
// `__tests__/cdnCachedDocuments.test.ts` holds both rules.
export const dynamic = "force-static";
// The bundled dataset changes only on a deploy, so an hour is the same quiet
// ceiling `/map` takes.
export const revalidate = 3600;

type PageProps = {
  params: Promise<{ id: string }>;
};

// missing is the not-found card, and it may be held: the dataset only changes
// on a deploy. A read we could not RUN is never held: the page throws, so ISR
// keeps the last good copy (or holds nothing) and the next request reads
// again, and app/ledger/[id]/error.tsx draws the read-unavailable card.

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const read = await lookupVenueDetail(id);

  // A read we could not run claims nothing in the unfurl: the same bare title
  // an absent pub gets, because the answer is unknown, not "no".
  if (read.status !== "found") {
    return {
      title: "The Ledger",
      robots: { index: false, follow: false },
    };
  }
  const { venue } = read;

  // The layout's template adds the brand to the document title. The share
  // card is not templated, so it keeps the branded form.
  const title = `The Ledger: ${ledgerTitleName(venue, await getVenueIndex())}`;
  const cardTitle = `${title}. ${BRAND_NAME}`;
  const description = `The story of ${venue.name} in ${venueAreaLabel(venue)}. Heritage notes and the pub's logbook of visits, in large print.`;
  // Canonicalise onto the surviving canonical venue id (D1) so a merged/alias
  // URL points at the one indexable venue permalink.
  const canonical = `/ledger/${encodeURIComponent(venue.id)}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title: cardTitle, description, type: "article", url: canonical },
    twitter: { card: "summary", title: cardTitle, description },
  };
}

const SITE_URL = "https://pubmaxxing.com";

// The region is the city the venue id names. A London id carries no city
// prefix, so the region stays London. A national base id names no city, so
// the region is omitted rather than labelled London.
function ledgerAddressRegion(venueId: string): string | undefined {
  const cityId = cityIdFromVenueId(venueId);
  if (cityId) return CITIES[cityId].displayName;
  if (isNationalBaseVenueId(venueId)) return undefined;
  return "London";
}

// Only pub and bar records receive BarOrPub structured data. An absent kind
// retains the legacy pub interpretation. The schema includes the name,
// coordinates, postal address, and canonical URL. No invented cuisine,
// price range, or rating. lat/lng and the street address are omitted when
// absent. The region is the city the id names. When the pub is on the official
// register (Historic England NHLE) we add a factual `description` + a
// heritage `additionalProperty` carrying the grade + list-entry citation, so
// AI/search engines see the listed-building status straight from the JSON-LD.
function venueJsonLd(venue: Venue, listed: ListedBuilding | null) {
  const addressRegion = ledgerAddressRegion(venue.id);
  const hasGeo =
    typeof venue.latitude === "number" && typeof venue.longitude === "number";
  return {
    "@context": "https://schema.org",
    "@type": "BarOrPub",
    name: venue.name,
    url: `${SITE_URL}/ledger/${encodeURIComponent(venue.id)}`,
    ...(listed
      ? {
          description: listed.fact,
          additionalProperty: {
            "@type": "PropertyValue",
            name: "Listed building",
            value: `Grade ${listed.grade}`,
            url: listed.url,
          },
        }
      : {}),
    ...(venue.address || venue.locality || venue.primaryBorough
      ? {
          address: {
            "@type": "PostalAddress",
            ...(venue.address ? { streetAddress: venue.address } : {}),
            ...(venue.locality || venue.primaryBorough
              ? { addressLocality: venueAreaLabel(venue) }
              : {}),
            ...(addressRegion ? { addressRegion } : {}),
            addressCountry: "GB",
          },
        }
      : {}),
    ...(hasGeo
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: venue.latitude,
            longitude: venue.longitude,
          },
        }
      : {}),
  };
}

function NotInTheLedger() {
  return (
    <main id="main" className="ledgerPage ledgerPage--empty">
      <div className="ledgerEmptyCard">
        <Link className="ledgerHomeLink" href="/">
          PUBMAXX
        </Link>
        <p className="ledgerEyebrow">The Ledger</p>
        <h1 className="ledgerEmptyTitle">This pub isn&rsquo;t in the ledger</h1>
        <p className="ledgerEmptyBody">
          It may have moved, or the link is wrong. Every mapped pub still has a home.
        </p>
        <Link prefetch={false} className="ledgerPrimaryLink" href="/map">
          Back to the map
        </Link>
      </div>
    </main>
  );
}

export default async function LedgerPage({ params }: PageProps) {
  const { id } = await params;
  // Three answers, and the order is the rule: a read we could not run is
  // answered BEFORE the not-found card, or the card swallows it.
  const read = await lookupVenueDetail(id);
  if (read.status === "unavailable") throw new Error(LEDGER_READ_UNAVAILABLE);
  if (read.status !== "found") return <NotInTheLedger />;
  const { venue } = read;
  // Everything below reads/links off the canonical venue id (D1) so a merged
  // alias URL and the surviving canonical URL share the same logbook, Family
  // Table, and ratings, never the raw route param, which may be a losing
  // duplicate id.
  const canonicalId = venue.id;

  const curation = venue.curation;
  // Official listed-building record (Historic England NHLE), keyed by canonical
  // venue id, feeds the BarOrPub JSON-LD description below. null for the many
  // pubs that are not listed.
  const listedBuilding = await getListedBuilding(canonicalId);
  // The Ledger's own canonical link, for the share actions below. Relative,
  // like every other in-app link on this page (venueMapUrl), because the deployed
  // origin is added by the browser/mail client itself. A future "email this
  // digest" project (see ShareWithFamilyButton's ponytail-ceiling note) would
  // want an absolute URL and should add a proper site-origin helper then.
  const ledgerUrl = `/ledger/${encodeURIComponent(canonicalId)}`;

  // The opening of the "Read this page" text: name and heritage note. The
  // newest few logbook entries join it once the live read lands.
  const speechIntro = [
    `The Ledger for ${venue.name}, ${venueAreaLabel(venue)}.`,
    curation.heritageNote ? curation.heritageNote : "",
  ];
  const priceVenue = mergePriceUpdates(
    [venue],
    cityIdFromVenueId(canonicalId) || isNationalBaseVenueId(canonicalId) ? [] : parsePriceUpdates(rawPriceUpdates),
    venueUpdateKey,
  )[0]!;
  const bundleRead = await ukPriceBundleRowsFor(canonicalId);
  if (bundleRead.status === "unavailable") throw new Error(LEDGER_READ_UNAVAILABLE);
  const bundle = bundlePricesForCategory(bundleRead.rows, BUNDLE_DEFAULT_CATEGORY);
  const hasPubOrBarSchema = isPubVenueKind(venue.kind) || venue.kind === "bar";

  return (
    <main id="main" className="ledgerPage">
      {hasPubOrBarSchema ? <JsonLd data={venueJsonLd(venue, listedBuilding)} /> : null}
      <LedgerLiveProvider venueId={canonicalId}>
        <header className="ledgerHead">
          <Link className="ledgerHomeLink" href="/">
            PUBMAXX
          </Link>
          <p className="ledgerEyebrow">The Ledger</p>
          <h1 className="ledgerTitle">{venue.name}</h1>
          <p className="ledgerAddress">
            {venue.address ? `${venue.address} · ` : ""}
            {venueAreaLabel(venue)}
          </p>

          {/* Listed-building brass plaque (Historic England NHLE). Rendered only
              when the pub is on the official register; the citation link is the
              attribution required by the Open Government Licence. */}
          {listedBuilding ? (
            <a
              className="ledgerListedPlaque"
              href={listedBuilding.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="ledgerListedFact">{listedBuilding.fact}</span>
              <span className="ledgerListedSource">Historic England</span>
            </a>
          ) : null}
          {listedBuilding ? <DataCreditsLink className="ledgerCredits" /> : null}

          <div className="ledgerHeadActions">
            <Link prefetch={false} className="ledgerMapLink" href={venueMapUrl(canonicalId)}>
              Open on the map
            </Link>
            <Link className="ledgerMapLink" href={`/bar-tab/${encodeURIComponent(canonicalId)}`}>
              See the bar tab
            </Link>
            <LedgerReadAloud intro={speechIntro} />
            <ShareWithFamilyButton venueName={venue.name} url={ledgerUrl} label="Share this ledger" />
          </div>

          <LedgerPriceRecord
            venue={{
              id: canonicalId,
              cheapestPrice: priceVenue.cheapestPrice,
              cheapestPint: priceVenue.cheapestPint,
              prices: priceVenue.prices,
              sourcedPrice: priceVenue.sourcedPrice,
            }}
            bundle={bundle}
          />

          {/* Individual, dated Visit Reports. No score or aggregate verdict. */}
          <VisitReportPanel venueId={canonicalId} venueName={venue.name} />

          {/* The pub's community photo wall - the same one the map sheet shows. */}
          <VenuePhotoWall venueId={canonicalId} venueName={venue.name} />
        </header>

        <p className="ledgerLaneNote">
          Public notes go in the logbook. Legacy notes stay at the Family Table below.
        </p>

        <LedgerLogSections
          venueName={venue.name}
          ledgerUrl={ledgerUrl}
          curatedClaims={buildVenueClaims(curation)}
        />
      </LedgerLiveProvider>

      {/* Operator rail (Wayfinder 3.5): a quiet door for the person who runs the
          pub. Signed-in users can verify they run it; verified operators propose
          corrections/events/offers that route through REVIEW and never overwrite
          the trusted notes above. */}
      <OperatorRailPanel venueId={canonicalId} venueName={venue.name} />

      <p className="ledgerFootnote">
        Sources, reports and price history. <Link prefetch={false} href={venueMapUrl(canonicalId)}>See {venue.name} on the map →</Link>
      </p>
    </main>
  );
}
