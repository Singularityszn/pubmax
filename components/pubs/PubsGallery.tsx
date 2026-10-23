import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { firstHttps } from "@/lib/httpUrl";

import BookingClickAnalytics from "@/components/pubs/BookingClickAnalytics";
import PubsFilters, {
  type PubsFilterCounts,
  type PubsFilterKey,
} from "@/components/pubs/PubsFilters";
import VenueImage from "@/components/media/VenueImage";
import PriceBadge from "@/components/PriceBadge";
import { LANDING_RECEIPT_LABEL, pintDropDoorHref } from "@/lib/landingHero";
import {
  SCRAPED_SOURCE_LABELS,
  type ScrapedPub,
} from "@/lib/scrapedPubs";
import { formatPrice } from "@/lib/venues";
import { priceBand } from "@/lib/priceBand";
import { VENUE_IMAGE_PROVENANCE_LABEL } from "@/lib/venueImages";
import { pubsIndexHref } from "@/lib/pageFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { resolveBookingAction } from "@/lib/venueExternalActions";
import type { ZoneSelection } from "@/lib/zones";

import "./pubsGallery.css";
import "@/components/map/zonePicker.css";

export function pubsCountLabel({
  matchingPubs,
  filter,
  zone,
  page,
  totalPages,
  complete,
}: {
  matchingPubs: number;
  filter: PubsFilterKey;
  zone: ZoneSelection;
  page: number;
  totalPages: number;
  complete: boolean;
}): string {
  const count = `${matchingPubs} pub${matchingPubs === 1 ? "" : "s"}`;
  const parts = [complete && filter === "all" ? `${count} we've checked` : complete ? count : `${count} available`];
  if (filter !== "all") parts.push(SCRAPED_SOURCE_LABELS[filter]);
  if (zone !== "all") parts.push(`Zone ${zone}`);
  if (totalPages > 1) parts.push(`Page ${page} of ${totalPages}`);
  if (!complete) parts.push("Some chain data is unavailable");
  return parts.join(" · ");
}

// The chain's own photograph of the pub, and nothing painted over it. The card
// used to lay a drink glyph and a word ("Shots", "Whisky", "Alcohol-free") on
// top, picked by hashing the venue id: decoration that read as a fact about
// what the pub pours, so it is gone. So is the dark wash, and the "Photo: pub
// website" pill that sat on the picture: the credit is a caption UNDER it
// (taste plan, 18 Oct 2026). VenueImage still prints its own on-image label,
// which pubsGallery.css hides here because this caption says the same thing;
// a photo that fails to load shows VenueImage's own "No photo yet", and the
// caption hides with it.
function PubPhoto({ photoUrl }: { photoUrl: string }) {
  return (
    <figure className="pubsCardFigure">
      <div className="pubsCardArt">
        <VenueImage
          className="pubsCardPhoto"
          sources={[{ url: photoUrl, provenance: "chain" }]}
          alt=""
          fill
          // One column at 420 and under, two up to 640, and a column of at
          // most 344px above that. Capped at 640: a 3x phone has no use for a
          // third pass of pixels over a card photograph.
          sizes="(max-width: 420px) 100vw, (max-width: 640px) 50vw, 344px"
          maxWidth={640}
        />
      </div>
      <figcaption className="pubsCardCredit">{VENUE_IMAGE_PROVENANCE_LABEL.chain}</figcaption>
    </figure>
  );
}

export default function PubsGallery({
  pubs,
  matchingPubs,
  filter,
  zone,
  counts,
  zonesPresent,
  page,
  totalPages,
  complete,
}: {
  pubs: ScrapedPub[];
  matchingPubs: number;
  filter: PubsFilterKey;
  zone: ZoneSelection;
  counts: PubsFilterCounts;
  zonesPresent: number[];
  page: number;
  totalPages: number;
  complete: boolean;
}) {
  const boroughJumpTargets: { borough: string; id: string }[] = [];
  const seenBoroughs = new Set<string>();
  for (const pub of pubs) {
    const borough = pub.borough.trim();
    if (!borough || seenBoroughs.has(borough)) continue;
    seenBoroughs.add(borough);
    boroughJumpTargets.push({ borough, id: pub.id });
  }

  return (
    <div className="pubsGallery">
      <BookingClickAnalytics />
      <PubsFilters
        counts={counts}
        filter={filter}
        zone={zone}
        zonesPresent={zonesPresent}
        showCounts={complete}
      />

      <p className="pubsCount" aria-live="polite">
        {pubsCountLabel({ matchingPubs, filter, zone, page, totalPages, complete })}
      </p>

      {boroughJumpTargets.length > 1 ? (
        <nav className="pubsJumpNav" aria-label="Jump to area">
          {boroughJumpTargets.map(({ borough, id }) => (
            <a key={borough} className="pubsJumpChip" href={`#pubsCard-${id}`}>
              {borough}
            </a>
          ))}
        </nav>
      ) : null}

      <ul className="pubsGrid">
        {pubs.map((pub) => {
          const menuUrl = firstHttps(pub.menuUrl);
          const booking = resolveBookingAction({
            name: pub.name,
            bookingUrl: pub.bookingUrl,
            menuUrl: pub.menuUrl,
            areaHint: pub.borough,
          });
          const hasPhoto = Boolean(pub.photoUrl);
          const cardClassName = hasPhoto
            ? "pubsCard"
            : "pubsCard pubsCard--no-art";
          return (
            <li key={pub.id} id={`pubsCard-${pub.id}`} className={cardClassName}>
              {pub.photoUrl ? <PubPhoto photoUrl={pub.photoUrl} /> : null}
              <div className="pubsCardBody">
                <h2 className="pubsCardName">{pub.name}</h2>
                {/* One meta line in one style: chain, borough, fare zone. It
                    was a tinted chain pill, a plain borough and a zone pill
                    sharing a line. */}
                <p className="pubsCardMeta">
                  {[pub.sourceLabel, pub.borough || null, pub.zone !== null ? `Zone ${pub.zone}` : null]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="pubsCardPrice">
                  {pub.cheapestPrice != null ? (
                    <>
                      <span className="listingFrom">from</span>
                      <PriceBadge variant="current" band={priceBand(pub.cheapestPrice, { city: "london" })}>
                        {formatPrice(pub.cheapestPrice)}
                      </PriceBadge>
                    </>
                  ) : (
                    <>
                      <span className="pubsCardNoPrice">No listed price yet.</span>{" "}
                      <Link
                        className="pubsCardLog"
                        href={pintDropDoorHref(pub.id)}
                        prefetch={false}
                      >
                        {LANDING_RECEIPT_LABEL}
                      </Link>
                    </>
                  )}
                </p>
                {/* THE CARD IS ONE DOOR: the whole card opens the pub on the
                    map. "On the map" is the card's own link, stretched over the
                    card (`.pubsMapLink::after`), and it carries the pub's name
                    so twenty cards are not twenty identical links to a screen
                    reader. It is a quiet ink link, not a tinted button: the
                    tint was the "you are here" state, on every card. Menu and
                    booking sit above the stretch, so they still open their own
                    pages.

                    A plain Link that PREFETCHES NOTHING, which is the same rule
                    IntentLink states and the only way to state it from a server
                    component. IntentLink is a client one, so importing it here
                    pulled the router and lib/mapWarmup into this page's own
                    bundle: measured on the Avrea runner, /pubs went from 1114 KB
                    decoded to 1276 KB against a 1200 ceiling. Reverting to a
                    bare Link put the weight back a second way, because Next
                    prefetches a Link on sight and each of these pulls /map's own
                    chunks in front of this page's answer. `prefetch={false}`
                    costs nothing and warms nothing. */}
                <div className="pubsCardLinks">
                  <Link
                    className="pubsMapLink"
                    href={venueMapUrl(pub.id)}
                    prefetch={false}
                    aria-label={`See ${pub.name} on the map`}
                  >
                    On the map
                  </Link>
                  {menuUrl ? (
                    <a
                      className="pubsMenuLink"
                      href={menuUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Menu
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  ) : null}
                  <a
                    className="pubsBookLink"
                    href={booking.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-booking-link="true"
                    data-tier={booking.tier}
                    data-venue-id={pub.id}
                  >
                    {booking.label}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 ? (
        <nav className="pubsPagination" aria-label="Pub pages">
          {page > 1 ? (
            <Link
              className="pubsShowMoreBtn"
              href={pubsIndexHref({ source: filter, zone: zone === "all" ? null : zone, page }, page - 1)}
            >
              Previous
            </Link>
          ) : <span />}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link
              className="pubsShowMoreBtn"
              href={pubsIndexHref({ source: filter, zone: zone === "all" ? null : zone, page }, page + 1)}
            >
              Next
            </Link>
          ) : <span />}
        </nav>
      ) : null}

      {pubs.length === 0 ? (
        <p className="pubsEmpty">No pubs under that filter yet. Loosen it, or take it to the map.</p>
      ) : null}
    </div>
  );
}
