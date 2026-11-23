import type { Route } from "next";
import Link from "next/link";
import { LedgerCommunity, LedgerLiveProvider, LedgerPriceRecord, LedgerReadAloud } from "@/components/ledger/LedgerLive";
import ShareWithFamilyButton from "@/components/ledger/ShareWithFamilyButton";
import OperatorRailPanel from "@/components/operators/OperatorRailPanel";
import { buildVenueClaims } from "@/lib/ledger";
import type { LedgerPublishedPrice } from "@/lib/ledgerPublishedPrice";
import type { PricedVenue } from "@/lib/priceUpdates";
import type { VenueBundlePrices } from "@/lib/venuePriceLane";
import { venueMapUrl } from "@/lib/venueIndex";
import { venueAreaLabel } from "@/lib/venueDisplay";
import "@/app/ledger/[id]/ledger.css";

export default function PriceRecordSection({ venue, bundle, publishedPrice }: {
  venue: PricedVenue;
  bundle: VenueBundlePrices | null;
  publishedPrice: LedgerPublishedPrice;
}) {
  const id = venue.id;
  return (
    <section id="ledger" className="pubPage__section">
      <LedgerLiveProvider venueId={id}>
        {bundle ? <LedgerPriceRecord venue={venue} bundle={bundle} publishedPrice={publishedPrice} /> : <><h2>Price record</h2><p role="status">The price record did not answer just now.</p></>}
        <Link className="pubPage__more" href={`${venueMapUrl(id)}&log=1` as Route}>Log a pint</Link>
        <details className="ledgerSecondaryActions">
          <summary>More actions</summary>
          <div className="ledgerHeadActions">
            <LedgerReadAloud intro={[`The Ledger for ${venue.name}, ${venueAreaLabel(venue)}.`, venue.curation.heritageNote ?? ""]} />
            <ShareWithFamilyButton venueName={venue.name} url={`/pubs/${encodeURIComponent(id)}#ledger`} label="Share this ledger" />
          </div>
        </details>
        <LedgerCommunity venueId={id} venueName={venue.name} ledgerUrl={`/pubs/${encodeURIComponent(id)}#ledger`} curatedClaims={buildVenueClaims(venue.curation)} />
      </LedgerLiveProvider>
      <OperatorRailPanel venueId={id} venueName={venue.name} />
    </section>
  );
}
