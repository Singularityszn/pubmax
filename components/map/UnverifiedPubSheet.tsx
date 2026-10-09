"use client";

import { applyPlacesEnrichment } from "@/lib/venuePlacesEnrichment";

import { useEffect, useState } from "react";
import { priceBand, priceBandAreaForVenue, priceBandNote } from "@/lib/priceBand";
import { ExternalLink, MapPin, Sparkles } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import PriceBadge from "@/components/PriceBadge";
import CommunityPriceReport from "@/components/map/CommunityPriceReport";
import VenueSheetPriceEntry from "@/components/map/inspector/VenueSheetPriceEntry";
import VenueSpoonsValueRow from "./inspector/VenueSpoonsValueRow";
import { useVenueSheetOpened } from "@/components/map/useVenueSheetOpened";
import {
  freshestCommunityPrice,
  type CommunityPricesState,
} from "@/components/map/useCommunityPrices";
import { ClaimBadge } from "@/components/map/venueInspectorBits";
import {
  communityStampLabel,
  communityTrustNote,
  submitCategoryLabel,
} from "@/lib/communityPrice";
import { DEFAULT_DRINK_LANE } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import { parsePublicOverlay, type PublicHarvestOverlay } from "@/lib/harvestFold";
import { discardBody } from "@/lib/responseBody";
import type { UkBasePub } from "@/lib/ukBasePubs";
import { COMMUNITY_PRICE_NOTE, formatPrice, type Venue } from "@/lib/venues";
import { type PlacesEnrichmentRecord } from "@/lib/placesEnrichment";
import { slimVenueToPin } from "@/lib/slimPins";
import VenuePlacesDetails from "./VenuePlacesDetails";
import {
  drinkLensEmptyVenueNote,
  drinkLensPriceNoun,
  NO_ALCOHOL_LENS_PRICE_NOUN,
  type MapExperienceLens,
} from "@/lib/mapExperienceLens";

import "./unverifiedPubSheet.css";

// The sheet behind a UK base pin - a pub OpenStreetMap knows about but the
// curated venue index does not. It shows existing community reports or invites
// the first one. A lone fresh pint report MARKS this pin, so the copy may say
// so; it can never COLOUR it, because base features carry no band, no cheapest
// price and no pin label, and the price merge never reaches a `venue-uk-*` id.
// Hence reach "mark" everywhere below: the mark is real, the colour is not, and
// promising the colour to the first drinker in an uncovered town would be a
// promise this layer cannot keep.

type UnverifiedPubSheetProps = {
  pub: UkBasePub;
  communityPrices: CommunityPricesState;
  experienceLens?: MapExperienceLens;
  /** Selected-drink map lens (e.g. coffee). Never the no-alcohol experience. */
  drinkLensCategory?: DrinkCategory | null;
};

export function HarvestOverlayFields({ overlay }: { overlay: PublicHarvestOverlay }) {
  const hasLinks = Boolean(overlay.website || overlay.menuUrl);
  if (!hasLinks && !overlay.lore) return null;
  return (
    <div className="unverifiedPubOverlay">
      {hasLinks ? (
        <div className="unverifiedPubActions">
          {overlay.website ? (
            <a href={overlay.website} target="_blank" rel="noopener noreferrer">
              Pub website
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
          {overlay.menuUrl ? (
            <a href={overlay.menuUrl} target="_blank" rel="noopener noreferrer">
              Look at the menu
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
      {overlay.lore ? (
        <div className="unverifiedPubLore">
          <p>{overlay.lore.fact}</p>
          <div className="unverifiedPubLoreMeta">
            <span>Web</span>
            <a href={overlay.lore.sourceRef} target="_blank" rel="noopener noreferrer">
              Source
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The heading, plus a note when OSM states the pub with no name. */
function UnverifiedPubName({ pub }: { pub: UkBasePub }) {
  return (
    <>
      <h2 className="unverifiedPubName">{pub.name}</h2>
      {pub.unnamed ? (
        <p className="unverifiedPubNameNote">
          We don&rsquo;t know this pub&rsquo;s name yet.
        </p>
      ) : null}
    </>
  );
}

/** Google Places content is more than a pin, so only a pub without it says the pin is all we know. */
function knownHereLead(placeNoun: string, venue: Venue): string {
  return venue.placesContent ? `We know this ${placeNoun} is here.` : `We know this ${placeNoun} is here, and that is all we know.`;
}

export default function UnverifiedPubSheet({
  pub,
  communityPrices,
  experienceLens = "all",
  drinkLensCategory = null,
}: UnverifiedPubSheetProps) {
  const { user, loading: authLoading, configured: authConfigured } = useAuth();
  // The base-layer half of the release funnel's third step, through the one
  // hook the curated sheet uses.
  useVenueSheetOpened(pub.id, "uk_base");
  const [overlay, setOverlay] = useState<PublicHarvestOverlay | null>(null);
  const [places, setPlaces] = useState<{ id: string; record: PlacesEnrichmentRecord } | null>(null);
  const detailVenue = applyPlacesEnrichment({
    ...slimVenueToPin({ id: pub.id, name: pub.name, lat: pub.lat, lng: pub.lng, borough: "", cheapestPrice: null }),
    address: pub.address,
  }, places?.id === pub.id ? places.record : null);
  const readStatus = communityPrices.venuePriceStatus.get(pub.id) ?? "idle";
  const pricesKnown = readStatus === "ready";
  const readFailed = readStatus === "degraded";
  const rows = communityPrices.byVenueId.get(pub.id);
  const communityPrice = freshestCommunityPrice(
    experienceLens === "food"
      ? undefined
      : experienceLens === "no-alcohol"
      ? rows?.filter(
          (row) =>
            row.drinkCategory === "soft-drink" ||
            row.drinkCategory === "alcohol-free",
        )
      : drinkLensCategory
        ? rows?.filter((row) => row.drinkCategory === drinkLensCategory)
        : rows,
  );
  const communityTrustStanding = communityPrice
    ? communityTrustNote(communityPrice, undefined, "mark")
    : "";
  // A base pub's id names no city, so the area answers null and the band is cut
  // from the whole dataset (review finding F-21). Taken once, so the plaque's
  // colour and its own sentence cannot come from two readings.
  const baseBandArea = priceBandAreaForVenue(pub.id);
  const basePriceBand =
    communityPrice && communityPrice.drinkCategory === "beer"
      ? priceBand(communityPrice.priceGbp, baseBandArea)
      : null;
  const drinkLensNoun = drinkLensCategory
    ? drinkLensPriceNoun(drinkLensCategory)
    : null;

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setOverlay(null);
    });
    (async () => {
      try {
        const res = await fetch(
          `/api/harvest-overlay?venueId=${encodeURIComponent(pub.id)}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { overlay?: unknown; placesContent?: PlacesEnrichmentRecord };
        if (body.placesContent && !controller.signal.aborted) setPlaces({ id: pub.id, record: body.placesContent });
        const parsed = parsePublicOverlay(body.overlay);
        if (!parsed) return;
        void Promise.resolve().then(() => {
          if (!controller.signal.aborted) setOverlay(parsed);
        });
      } catch {
        /* fail-soft: overlay unknown */
      }
    })();
    return () => controller.abort();
  }, [pub.id]);

  // OSM states a pub or a bar, and the sheet says which. Calling a bar a pub is
  // a claim a reader can check on the pavement outside.
  const placeNoun = pub.kind === "bar" ? "bar" : "pub";

  return (
    <div className="unverifiedPub">
      <div className="unverifiedPubHead">
        <span className="unverifiedPubTag">
          <Sparkles size={12} aria-hidden="true" />
          {communityPrice
            ? "Community price"
            : pricesKnown
              ? "No price yet"
              : readFailed
                ? "Prices unread"
                : "Checking community prices"}
        </span>
        <UnverifiedPubName pub={pub} />
        {detailVenue.address ? (
          <p className="unverifiedPubAddress">
            <MapPin size={13} aria-hidden="true" />
            {detailVenue.address}
          </p>
        ) : null}
      </div>

      {communityPrice ? (
        <>
          <p className="unverifiedPubLead">
            We know this {placeNoun} from OpenStreetMap. Here is what the
            community last logged.
          </p>
          <div className="contributorPrice communityPriceRow">
            <span>
              <ClaimBadge kind="contributor" /> Logged by a PUBMAXXER
            </span>
            <PriceBadge
              variant="current"
              band={basePriceBand}
              // A national base pub names no city, so its band is cut from the
              // whole dataset and the sentence says so rather than implying
              // this pub's own town (review finding F-21).
              title={basePriceBand ? priceBandNote(basePriceBand, baseBandArea) : undefined}
            >
              {formatPrice(communityPrice.priceGbp)}
            </PriceBadge>
            <small className="communityPriceStamp">
              {submitCategoryLabel(communityPrice.drinkCategory)} ·{" "}
              {communityStampLabel(communityPrice.submittedAt)}
            </small>
            {communityTrustStanding ? (
              <small className="communityPriceStanding">{communityTrustStanding}</small>
            ) : null}
            <small className="communityPriceNote">{COMMUNITY_PRICE_NOTE}</small>
            <CommunityPriceReport
              price={communityPrice}
              communityPrices={communityPrices}
              venueName={pub.name}
            />
          </div>
        </>
      ) : pricesKnown && experienceLens === "no-alcohol" ? (
        <p className="unverifiedPubLead">
          {drinkLensEmptyVenueNote(NO_ALCOHOL_LENS_PRICE_NOUN, "ready")}
        </p>
      ) : drinkLensNoun ? (
        <p className="unverifiedPubLead">
          {drinkLensEmptyVenueNote(drinkLensNoun, readStatus)}
        </p>
      ) : pricesKnown && experienceLens === "food" ? (
        <p className="unverifiedPubLead">
          No sourced food price recorded here.
        </p>
      ) : pricesKnown ? (
        <p className="unverifiedPubLead">
          {knownHereLead(placeNoun, detailVenue)} Nobody has
          logged what a drink costs. <strong>Be the first</strong>.
        </p>
      ) : readFailed ? (
        <p className="unverifiedPubLead">
          We could not read what has been logged here just now. You can still add
          tonight&rsquo;s price below.
        </p>
      ) : null}

      <VenuePlacesDetails venue={detailVenue} links websiteLink />
      {overlay ? <HarvestOverlayFields overlay={detailVenue.website ? { ...overlay, website: null } : overlay} /> : null}

      <VenueSheetPriceEntry
        key={pub.id}
        venueId={pub.id}
        venueName={pub.name}
        isPub
        communityPrices={communityPrices}
        canSubmitPrice={!authConfigured || Boolean(user)}
        showSignInGate
        authLoading={authLoading}
        mapReach="mark"
        laneCategory={drinkLensCategory ?? DEFAULT_DRINK_LANE}
      />

      {/* What a tenner buys here, when this pub is one of the Wetherspoons the
          Spoons value ranking holds. Most of the pubs that ranking joins are
          base pins like this one, so the row lives on this sheet as well as on
          the curated Overview, and renders nothing for every other pub. */}
      <VenueSpoonsValueRow venueId={pub.id} visible={!drinkLensCategory} />

      {/* ODbL requires attribution wherever these pins are publicly displayed
          (data/osm/uk/README.md), and it is also the honest provenance line:
          the pub's existence is sourced, its price is not. */}
      <p className="unverifiedPubSource">
        {placeNoun === "bar" ? "Bar" : "Pub"} location from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL. Prices never come from OpenStreetMap.
      </p>
    </div>
  );
}
