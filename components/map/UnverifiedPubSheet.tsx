"use client";

import { MapPin, Sparkles } from "lucide-react";

import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { UkBasePub } from "@/lib/ukBasePubs";

import "./unverifiedPubSheet.css";

// The sheet behind a UK base pin - a pub OpenStreetMap knows about and this app
// knows nothing else about.
//
// It is NOT a stripped-down VenueInspector. There is no price story, no
// heritage, no what's-on and no crawl slot to show, and rendering that sheet
// with every section empty would read as a broken pub rather than an honest
// blank. So this surface says the one true thing - nobody has logged a price
// here - and then hands over the whole card to the thing that fixes it.
//
// Price submission is deliberately OPEN on unverified pubs: an unpriced pub is
// exactly where the first price is worth the most, and /api/price-submit keys
// on an opaque venue id, so a base pub's `venue-uk-…` id needs no server
// change. What a submitted price does NOT do here is promote the pin: base pins
// carry no price colour at all, and the corroboration policy for when a
// community price starts colouring a pin belongs to the price-trust lane, not
// to this layer.

type UnverifiedPubSheetProps = {
  pub: UkBasePub;
  communityPrices: CommunityPricesState;
};

export default function UnverifiedPubSheet({ pub, communityPrices }: UnverifiedPubSheetProps) {
  return (
    <div className="unverifiedPub">
      <div className="unverifiedPubHead">
        <span className="unverifiedPubTag">
          <Sparkles size={12} aria-hidden="true" />
          No price yet
        </span>
        <h2 className="unverifiedPubName">{pub.name}</h2>
        {pub.address ? (
          <p className="unverifiedPubAddress">
            <MapPin size={13} aria-hidden="true" />
            {pub.address}
          </p>
        ) : null}
      </div>

      <p className="unverifiedPubLead">
        We know this pub is here, and that is all we know. Nobody has logged what
        a drink costs - <strong>be the first</strong>.
      </p>

      <VenuePriceSubmit
        venueId={pub.id}
        venueName={pub.name}
        communityPrices={communityPrices}
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
