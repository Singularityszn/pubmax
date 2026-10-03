"use client";

import { useEffect, useState } from "react";
import { priceBand, priceBandAreaForVenue, priceBandNote } from "@/lib/priceBand";
import { ExternalLink, MapPin, Sparkles } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import PriceBadge from "@/components/PriceBadge";
import PublishedMenuPrices from "@/components/map/PublishedMenuPrices";
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
import { parseDrinkSubtypeParam } from "@/lib/drinkSubtypes";
import { parsePublicOverlay, type PublicHarvestOverlay } from "@/lib/harvestFold";
import type { ListedCategoryPrice } from "@/lib/listedCategoryPrices";
import { drinkCategoryIndexKey, listedServingGroup } from "@/lib/listedPriceComparison";
import { discardBody } from "@/lib/responseBody";
import type { UkBasePub } from "@/lib/ukBasePubs";
import { COMMUNITY_PRICE_NOTE, formatPrice } from "@/lib/venues";
import {
  drinkLensEmptyVenueNote,
  drinkLensPriceNoun,
  NO_ALCOHOL_LENS_PRICE_NOUN,
  readListedDrinkIndex,
  type CategoryPriceIndexStatus,
  type MapExperienceLens,
} from "@/lib/mapExperienceLens";

import { Button } from "@/components/ui/button";

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
  drinkLensSubtype?: string | null;
  drinkServingGroup?: string | null;
  onAcceptStop1?: () => void;
  acceptanceError?: string | null;
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

function basePriceReadLabel({
  published,
  community,
  unread,
  communityPending,
  publishedPending,
  publishedPartial,
}: {
  published: boolean;
  community: boolean;
  unread: boolean;
  communityPending: boolean;
  publishedPending: boolean;
  publishedPartial: boolean;
}) {
  if (published) return "Published menu prices";
  if (community) return "Community price";
  if (unread) return "Prices unread";
  if (publishedPartial) return "Published menu prices incomplete";
  if (communityPending) return "Checking community prices";
  if (publishedPending) return "Checking published menu prices";
  return "No price yet";
}

function selectedBasePublishedPrices(
  communityPrices: CommunityPricesState,
  pubId: string,
  category: DrinkCategory,
  subtype: string | null,
  serving: string | null,
): { prices: readonly ListedCategoryPrice[] | null | undefined; status: CategoryPriceIndexStatus } {
  const key = drinkCategoryIndexKey(category, serving, subtype);
  const status = communityPrices.drinkCategoryIndexStatus.get(key) ?? "idle";
  if (status === "degraded") return { prices: null, status };
  if (status === "idle" || status === "loading") return { prices: undefined, status };
  const ownRows = (communityPrices.listedDrinkPrices.get(key) ?? [])
    .filter((quote) => quote.venueId === pubId);
  const prices = readListedDrinkIndex(ownRows, category, subtype).flatMap((quote) => {
    if (!quote.category || !quote.sourceUrl || !quote.observedAt) return [];
    if (serving && listedServingGroup(category, quote.servingSize, subtype) !== serving) return [];
    return [{
      source: "listed" as const,
      category: quote.category,
      drinkLabel: quote.drinkLabel ?? null,
      priceGbp: quote.priceGbp,
      servingSize: quote.servingSize ?? null,
      sourceUrl: quote.sourceUrl,
      observedAt: quote.observedAt,
    }];
  });
  return { prices, status };
}

function basePubPriceReading({
  pub,
  communityPrices,
  experienceLens,
  drinkLensCategory,
  drinkLensSubtype,
  drinkServingGroup,
}: Pick<Required<UnverifiedPubSheetProps>,
  "pub" | "communityPrices" | "experienceLens" | "drinkLensCategory" | "drinkLensSubtype" | "drinkServingGroup"
>) {
  const readStatus = communityPrices.venuePriceStatus.get(pub.id) ?? "idle";
  const pricesKnown = readStatus === "ready";
  const readFailed = readStatus === "degraded";
  const rows = communityPrices.byVenueId.get(pub.id);
  const subtype = experienceLens === "all" && drinkLensCategory
    ? parseDrinkSubtypeParam(drinkLensSubtype, drinkLensCategory) : null;
  const serving = experienceLens === "all" && drinkLensCategory
    ? listedServingGroup(drinkLensCategory, drinkServingGroup, subtype?.id) : null;
  const selectedPublished = drinkLensCategory && (subtype || serving)
    ? selectedBasePublishedPrices(communityPrices, pub.id, drinkLensCategory, subtype?.id ?? null, serving)
    : null;
  const listed = selectedPublished
    ? selectedPublished.prices : communityPrices.listedPricesByVenueId?.get(pub.id);
  const visibleListed = (listed ?? []).filter((quote) =>
    experienceLens === "food" ? false
      : experienceLens === "no-alcohol"
        ? quote.category === "soft-drink" || quote.category === "alcohol-free"
        : !drinkLensCategory || quote.category === drinkLensCategory,
  );
  const hasPublished = visibleListed.length > 0;
  const communityPrice = freshestCommunityPrice(
    selectedPublished || experienceLens === "food"
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
    ? subtype?.longLabel.toLowerCase() ?? drinkLensPriceNoun(drinkLensCategory)
    : null;

  const priceReadLabel = basePriceReadLabel({
    published: hasPublished,
    community: Boolean(communityPrice),
    unread: selectedPublished ? listed === null : readFailed || listed === null,
    communityPending: !selectedPublished && !pricesKnown,
    publishedPending: listed === undefined && experienceLens !== "food",
    publishedPartial: selectedPublished?.status === "partial",
  });
  return {
    readStatus, pricesKnown, readFailed, listed, visibleListed, hasPublished,
    communityPrice, communityTrustStanding, baseBandArea, basePriceBand,
    drinkLensNoun, selectedPublished, priceReadLabel,
  };
}

export default function UnverifiedPubSheet({
  pub,
  communityPrices,
  experienceLens = "all",
  drinkLensCategory = null,
  drinkLensSubtype = null,
  drinkServingGroup = null,
  onAcceptStop1,
  acceptanceError = null,
}: UnverifiedPubSheetProps) {
  const { user, loading: authLoading, configured: authConfigured } = useAuth();
  // The base-layer half of the release funnel's third step, through the one
  // hook the curated sheet uses.
  useVenueSheetOpened(pub.id, "uk_base");
  const [overlay, setOverlay] = useState<PublicHarvestOverlay | null>(null);
  const {
    readStatus, pricesKnown, readFailed, listed, visibleListed, hasPublished,
    communityPrice, communityTrustStanding, baseBandArea, basePriceBand,
    drinkLensNoun, selectedPublished, priceReadLabel,
  } = basePubPriceReading({
    pub, communityPrices, experienceLens, drinkLensCategory, drinkLensSubtype, drinkServingGroup,
  });

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
        const body = (await res.json()) as { overlay?: unknown };
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
          {priceReadLabel}
        </span>
        <h2 className="unverifiedPubName">{pub.name}</h2>
        {pub.address ? (
          <p className="unverifiedPubAddress">
            <MapPin size={13} aria-hidden="true" />
            {pub.address}
          </p>
        ) : null}
      </div>

      {experienceLens !== "food" ? (
        <PublishedMenuPrices
          prices={visibleListed}
          unavailable={listed === null}
          loading={listed === undefined}
        />
      ) : null}

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
      ) : hasPublished ? null : selectedPublished ? (
        selectedPublished.status === "ready" ? (
          <p className="unverifiedPubLead">No {drinkLensNoun} menu price recorded here.</p>
        ) : selectedPublished.status === "partial" ? (
          <p className="unverifiedPubLead">Published menu prices are incomplete.</p>
        ) : null
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
          Nobody has logged what a drink costs at this {placeNoun} - <strong>be the first</strong>.
        </p>
      ) : readFailed ? (
        <p className="unverifiedPubLead">
          We could not read what has been logged here just now. You can still add
          tonight&rsquo;s price below.
        </p>
      ) : null}

      {pub.kind === "pub" && onAcceptStop1 ? (
        <Button type="button" variant="ghost" onClick={onAcceptStop1} aria-label={`Make ${pub.name} Stop 1`}>
          Make it Stop 1
        </Button>
      ) : null}
      {acceptanceError ? <p role="alert">{acceptanceError}</p> : null}
      {overlay ? <HarvestOverlayFields overlay={overlay} /> : null}

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
          OSM sources the location, while each price names its own source. */}
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
