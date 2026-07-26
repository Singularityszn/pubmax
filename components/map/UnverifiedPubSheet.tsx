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

import "./unverifiedPubSheet.css";

// The sheet behind a UK base pin - a pub OpenStreetMap knows about but the
// curated venue index does not. It shows existing community reports or invites
// the first one while leaving base pins price-blind. Corroboration policy for
// colouring a pin belongs to the price-trust lane, not this layer.

type UnverifiedPubSheetProps = {
  pub: UkBasePub;
  communityPrices: CommunityPricesState;
};

export default function UnverifiedPubSheet({ pub, communityPrices }: UnverifiedPubSheetProps) {
  const pricesKnown = communityPrices.byVenueId.has(pub.id);
  const communityPrice = freshestCommunityPrice(communityPrices.byVenueId.get(pub.id));
  // Base pins are price-blind - no colour, no provisional dot - so this sheet
  // asks for page-only wording: the note may never claim a mark on the map.
  const communityTrustStanding = communityPrice
    ? communityTrustNote(communityPrice, Date.now(), false)
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
        canMarkMap={false}
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
