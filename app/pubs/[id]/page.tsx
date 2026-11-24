import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import DataCreditsLink from "@/components/legal/DataCreditsLink";
import { PintPriceBadge } from "@/components/PriceBadge";
import { LedgerLiveProvider } from "@/components/ledger/LedgerLive";
import VenueImage from "@/components/media/VenueImage";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import BookingClickAnalytics from "@/components/pubs/BookingClickAnalytics";
import PubLotReviews from "@/components/pubs/PubLotReviews";
import RankThisPub from "@/components/pubs/RankThisPub";
import AddRegularNight from "@/components/tonight/AddRegularNight";
import Screen from "@/components/ui/screen";
import VenueReadUnavailable from "@/components/venue/VenueReadUnavailable";
import ListedPriceSource from "@/components/venue/ListedPriceSource";
import LastOrdersBellSlot from "@/components/wild/LastOrdersBellSlot";
import { BRAND_NAME } from "@/lib/brandNaming";
import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { ledgerPublishedPrice } from "@/lib/ledgerPublishedPrice";
import { mergePriceUpdates, parsePriceUpdates } from "@/lib/priceUpdates";
import { venueUpdateKey } from "@/lib/pubMap";
import { BUNDLE_DEFAULT_CATEGORY, bundlePricesForCategory } from "@/lib/ukPriceBundle";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import { withZoneEstimate } from "@/lib/zonePriceEstimate";
import { loadVenueZone, loadZonePintIndex } from "@/lib/zonePintIndex.server";
import rawPriceUpdates from "@/public/data/price_updates/latest.json";
import { getListedBuilding } from "@/lib/heritageListings";
import { priceBandLabel, type PriceBand } from "@/lib/priceBand";
import { pintDisplayName, pubPintRows, samePintReceipt, sharedPintReceipt } from "@/lib/pubPintRows";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { redirectLegacyVenuePage, redirectMergedVenueId } from "@/lib/venuePermalinkRedirect";
import { venueAreaLabel } from "@/lib/venueDisplay";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { venueJsonLd } from "./venueJsonLd";
import BarTabSection from "./BarTabSection";
import BoardSection from "./BoardSection";
import PriceRecordSection from "./PriceRecordSection";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { venueAmenityStatus, venueContacts, type Venue } from "@/lib/venues";
import { confirmedPubClosure } from "@/lib/verifiedClosedPubs";

import "./pubPage.css";

// The pub's own page, laid out the way a booking app lays out a restaurant:
// the photo, the name and where it is, one thing to do (book, when the pub
// takes bookings, otherwise open it on the map), then what a reader decides
// on: the pints and what they cost, when it is open, what is there, the
// story, and what your lot said. Every line is a fact the record already
// holds; a fact it does not hold prints nothing rather than a guess. Booking
// links out to the pub's own page, because PUBMAXX takes no payment.

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const BANDS: readonly PriceBand[] = ["cheap", "average", "expensive"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const AMENITIES: ReadonlyArray<{ key: keyof Venue["amenities"]; label: string }> = [
  { key: "food", label: "Serves food" },
  { key: "beerGarden", label: "Beer garden" },
  { key: "liveSports", label: "Live sports" },
  { key: "liveMusic", label: "Live music" },
  { key: "pubQuiz", label: "Pub quiz" },
  { key: "cocktails", label: "Cocktails" },
  { key: "nonAlcoholic", label: "Alcohol-free options" },
  { key: "darts", label: "Darts" },
  { key: "pool", label: "Pool" },
  { key: "karaoke", label: "Karaoke" },
  { key: "happyHour", label: "Happy hour" },
];
const SHOWN_PINTS = 6;

function hoursLine(windows: Array<{ opens: string; closes: string }> | undefined): string {
  if (windows === undefined) return "Not stated";
  if (windows.length === 0) return "Closed";
  return windows.map((window) => `${window.opens} to ${window.closes}`).join(", ");
}

async function resolvePublishedPrice(venue: Venue) {
  const priceVenue = mergePriceUpdates(
    [venue],
    cityIdFromVenueId(venue.id) || isNationalBaseVenueId(venue.id) ? [] : parsePriceUpdates(rawPriceUpdates),
    venueUpdateKey,
  )[0]!;
  const bundleRead = await ukPriceBundleRowsFor(venue.id);
  let bundle = bundleRead.status === "unavailable" ? null : bundlePricesForCategory(bundleRead.rows, BUNDLE_DEFAULT_CATEGORY);
  if (bundle && isPubVenueKind(venue.kind)) {
    const [zone, zoneIndex] = await Promise.all([loadVenueZone(venue.id), loadZonePintIndex()]);
    bundle = withZoneEstimate(bundle, zone, zoneIndex);
  }
  const publishedPrice = ledgerPublishedPrice(priceVenue, bundle ?? {});
  return { priceVenue, bundle, publishedPrice };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const closure = confirmedPubClosure(id);
  if (closure) return { title: closure.name, description: `${closure.name} is permanently closed.`, robots: { index: false, follow: true } };
  const read = await lookupVenueDetail(id);
  if (read.status !== "found") return { title: "Pub", robots: { index: false, follow: false } };
  const { venue } = read;
  const description = `${venue.name} in ${venueAreaLabel(venue)}: pint prices, opening hours, what's there and what your lot said.`;
  const canonical = `/pubs/${encodeURIComponent(venue.id)}`;
  const cardTitle = `${venue.name} · ${BRAND_NAME}`;
  const images = venue.imageUrl ? [{ url: venue.imageUrl, alt: venue.name }] : [];
  return {
    title: venue.name,
    description,
    alternates: { canonical },
    openGraph: { title: cardTitle, description, type: "website", url: canonical, images },
    twitter: { card: images.length ? "summary_large_image" : "summary", title: cardTitle, description, images },
  };
}

export default async function PubPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const closure = confirmedPubClosure(id);
  if (closure) {
    return (
      <main id="main" className="pubPage">
        <SiteNav active="pubs" />
        <div className="pubPage__inner">
          <h1>{closure.name}</h1>
          <section className="pubPage__section">
            <p>Permanently closed</p>
            <p>Reported <time dateTime={closure.observedAt}>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${closure.observedAt}T00:00:00Z`))}</time>. <a href={closure.sourceUrl} target="_blank" rel="noreferrer">{closure.sourceName}</a></p>
          </section>
          <div className="pubPage__actions"><Link className="pubPage__action" href="/map">Find another pub on the map</Link></div>
        </div>
      </main>
    );
  }
  // A read we could not run is answered before the not-found card, or the
  // card would claim a pub is missing when we simply could not look.
  const read = await lookupVenueDetail(id);
  if (read.status === "unavailable") {
    return (
      <main id="main" className="pubPage pubPage--empty">
        <SiteNav active="pubs" />
        <div className="pubPage__inner pubPage__unavailable">
          <VenueReadUnavailable
            eyebrow="Pubs"
            href={`/pubs/${encodeURIComponent(id)}`}
            classNames={{ eyebrow: "pubPage__eyebrow", title: "pubPage__emptyTitle", body: "pubPage__note", action: "pubPage__action" }}
          />
        </div>
      </main>
    );
  }
  if (read.status !== "found") notFound();
  const { venue } = read;
  redirectLegacyVenuePage(venue.id, await searchParams);
  redirectMergedVenueId("/pubs", id, venue.id);
  const pageUrl = `/pubs/${encodeURIComponent(venue.id)}`;
  const listed = await getListedBuilding(venue.id);
  const contacts = venueContacts(venue);
  const status = venueAmenityStatus(venue);
  const amenities = AMENITIES.filter(({ key }) => status[key] === "known-true");
  const pints = pubPintRows(venue.prices);
  const shownPints = pints.slice(0, SHOWN_PINTS);
  const pintsReceipt = sharedPintReceipt(shownPints);
  const { priceVenue, bundle, publishedPrice } = await resolvePublishedPrice(venue);
  const listedPint = publishedPrice.publishedPint;
  const band = venue.priceBand === undefined ? null : BANDS[venue.priceBand];
  const hours = venue.openingHours;
  const story = venue.curation.heritageNote?.trim() ?? "";
  const priceRecord = <PriceRecordSection venue={priceVenue} bundle={bundle} publishedPrice={publishedPrice} />;
  const barTab = <BarTabSection venueId={venue.id} venueName={venue.name} />;

  const primary = contacts.bookingHref ? (
    <a href={contacts.bookingHref} target="_blank" rel="noopener noreferrer" data-booking-link="true" data-tier="direct" data-venue-id={venue.id}>
      Book a table
    </a>
  ) : (
    <Link href={venueMapUrl(venue.id)} prefetch={false}>Open on the map</Link>
  );

  return (
    <LedgerLiveProvider venueId={venue.id}><main id="main" className="pubPage">
      <SiteNav active="pubs" />
      {isPubVenueKind(venue.kind) || venue.kind === "bar" ? <JsonLd data={venueJsonLd(venue, listed)} /> : null}
      <BookingClickAnalytics />
      <div className="pubPage__inner">
        <VenueImage
          className="pubPage__hero venueImage--cover"
          sources={[{ url: venue.imageUrl, provenance: "chain" }]}
          alt={`${venue.name}, outside or in`}
          venueName={venue.name}
          venueArea={venueAreaLabel(venue)}
          width={960}
          height={540}
          priority
        />
        <Screen
          as="section"
          kicker={venueAreaLabel(venue)}
          title={venue.name}
          titleId="pub-title"
          answer={
            <div className="pubPage__answer">
              {listedPint ? (
                <div className="pubPage__price">
                  <PintPriceBadge size="display" priceGbp={listedPint.priceGbp} venueId={venue.id} />
                  <p className="pubPage__priceLabel">
                    <span>Cheapest pint</span>
                    {listedPint.pintName ? <strong>{pintDisplayName(listedPint.pintName)}</strong> : null}
                  </p>
                  <ListedPriceSource evidence={listedPint} className="pubPage__priceSource" />
                </div>
              ) : null}
              {band || listed || venue.address ? (
                <ul className="pubPage__facts" aria-label="At a glance">
                  {band ? <li>{priceBandLabel(band)} for the area</li> : null}
                  {listed ? (
                    <li>
                      <a href={listed.url} target="_blank" rel="noopener noreferrer">Grade {listed.grade} listed</a>
                    </li>
                  ) : null}
                  {venue.address ? <li>{venue.address}</li> : null}
                </ul>
              ) : null}
            </div>
          }
          primary={primary}
        />

        <LastOrdersBellSlot venueId={venue.id} venueName={venue.name} lat={venue.latitude} lng={venue.longitude} />

        <div className="pubPage__actions">
          {contacts.bookingHref ? (
            <Link className="pubPage__action" href={venueMapUrl(venue.id)} prefetch={false}>Open on the map</Link>
          ) : null}
          <RankThisPub venueId={venue.id} venueName={venue.name} returnTo={pageUrl} />
          {contacts.phoneHref ? <a className="pubPage__action" href={contacts.phoneHref}>Call</a> : null}
          {contacts.websiteHref ? (
            <a className="pubPage__action" href={contacts.websiteHref} target="_blank" rel="noopener noreferrer">Website</a>
          ) : null}
          {venue.menuUrl ? (
            <a className="pubPage__action" href={venue.menuUrl} target="_blank" rel="noopener noreferrer">Menu</a>
          ) : null}
        </div>

        {priceRecord}

        {pints.length > 0 ? (
          <section className="pubPage__section" aria-labelledby="pub-pints-title">
            <h2 id="pub-pints-title">Pints and prices</h2>
            {pintsReceipt ? <ListedPriceSource evidence={pintsReceipt} className="pubPage__priceSource" /> : null}
            <ul className="pubPage__pints">
              {shownPints.map((pint) => (
                <li key={pint.name}>
                  <div>
                    <span>{pint.name}</span>
                    {pintsReceipt && samePintReceipt(pint.receipt, pintsReceipt) ? null : (
                      <ListedPriceSource evidence={pint.receipt} className="pubPage__priceSource" />
                    )}
                  </div>
                  <PintPriceBadge priceGbp={pint.price} venueId={venue.id} />
                </li>
              ))}
            </ul>
            {pints.length > SHOWN_PINTS ? (
              <Link className="pubPage__more" href={venueMapUrl(venue.id)} prefetch={false}>
                {pints.length - SHOWN_PINTS} more on the map
              </Link>
            ) : null}
          </section>
        ) : null}

        {hours ? (
          <section className="pubPage__section" aria-labelledby="pub-hours-title">
            <h2 id="pub-hours-title">Opening hours</h2>
            <dl className="pubPage__hours">
              {WEEK_ORDER.map((day) => (
                <div key={day}>
                  <dt>{DAYS[day]}</dt>
                  <dd>{hoursLine(hours[day])}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {amenities.length > 0 ? (
          <section className="pubPage__section" aria-labelledby="pub-here-title">
            <h2 id="pub-here-title">What&rsquo;s here</h2>
            <ul className="pubPage__chips">
              {amenities.map(({ key, label }) => <li key={key}>{label}</li>)}
            </ul>
          </section>
        ) : null}

        <PubLotReviews venueId={venue.id} venueName={venue.name} />

        {story || listed ? (
          <section className="pubPage__section" aria-labelledby="pub-story-title">
            <h2 id="pub-story-title">The story</h2>
            {story ? <p className="pubPage__story">{story}</p> : null}
            {listed ? <p className="pubPage__note">{listed.fact} <DataCreditsLink /></p> : null}
          </section>
        ) : null}

        {barTab}
        {isPubVenueKind(venue.kind) ? <BoardSection venueId={venue.id} venueName={venue.name} /> : null}
        <section className="pubPage__section" aria-label="Regular nights">
          <AddRegularNight where="pub" venueId={venue.id} venueName={venue.name} />
        </section>
      </div>
    </main></LedgerLiveProvider>
  );
}
