"use client";

import { MapPin, Sparkles } from "lucide-react";

import CommunityPriceReport from "@/components/map/CommunityPriceReport";
import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
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
import type { UkBasePub } from "@/lib/ukBasePubs";
import { COMMUNITY_PRICE_NOTE, formatPrice } from "@/lib/venues";
import {
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
};

export default function UnverifiedPubSheet({
  pub,
  communityPrices,
  experienceLens = "all",
}: UnverifiedPubSheetProps) {
  const pricesKnown = communityPrices.byVenueId.has(pub.id);
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
      : rows,
  );
  const communityTrustStanding = communityPrice
    ? communityTrustNote(communityPrice, undefined, "mark")
    : "";

  return (
    <div className="unverifiedPub">
      <div className="unverifiedPubHead">
        <span className="unverifiedPubTag">
          <Sparkles size={12} aria-hidden="true" />
          {communityPrice
            ? "Community price"
            : pricesKnown
              ? "No price yet"
              : "Checking community prices"}
        </span>
        <h2 className="unverifiedPubName">{pub.name}</h2>
        {pub.address ? (
          <p className="unverifiedPubAddress">
            <MapPin size={13} aria-hidden="true" />
            {pub.address}
          </p>
        ) : null}
      </div>

      {communityPrice ? (
        <>
          <p className="unverifiedPubLead">
            We know this pub from OpenStreetMap. Here is what the community last
            logged.
          </p>
          <div className="contributorPrice communityPriceRow">
            <span>
              <ClaimBadge kind="contributor" /> Logged by a Pubmaxxer
            </span>
            <strong>{formatPrice(communityPrice.priceGbp)}</strong>
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
          No {NO_ALCOHOL_LENS_PRICE_NOUN} price logged here yet.
        </p>
      ) : pricesKnown && experienceLens === "food" ? (
        <p className="unverifiedPubLead">
          No sourced food price recorded here.
        </p>
      ) : pricesKnown ? (
        <p className="unverifiedPubLead">
          We know this pub is here, and that is all we know. Nobody has logged what
          a drink costs - <strong>be the first</strong>.
        </p>
      ) : null}

      <VenuePriceSubmit
        key={pub.id}
        venueId={pub.id}
        venueName={pub.name}
        communityPrices={communityPrices}
        mapReach="mark"
      />

      {/* ODbL requires attribution wherever these pins are publicly displayed
          (data/osm/uk/README.md), and it is also the honest provenance line:
          the pub's existence is sourced, its price is not. */}
      <p className="unverifiedPubSource">
        Pub location from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL. Prices never come from OpenStreetMap.
      </p>
    </div>
  );
}
