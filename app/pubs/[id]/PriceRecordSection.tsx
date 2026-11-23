import type { Route } from "next";
import Link from "next/link";
import { LedgerCommunity, LedgerLiveProvider, LedgerPriceRecord, LedgerReadAloud } from "@/components/ledger/LedgerLive";
import ShareWithFamilyButton from "@/components/ledger/ShareWithFamilyButton";
import OperatorRailPanel from "@/components/operators/OperatorRailPanel";
import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { buildVenueClaims } from "@/lib/ledger";
import { mergePriceUpdates, parsePriceUpdates } from "@/lib/priceUpdates";
import { venueUpdateKey } from "@/lib/pubMap";
import { BUNDLE_DEFAULT_CATEGORY, bundlePricesForCategory } from "@/lib/ukPriceBundle";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { venueMapUrl } from "@/lib/venueIndex";
import { venueAreaLabel } from "@/lib/venueDisplay";
import type { Venue } from "@/lib/venues";
import { withZoneEstimate } from "@/lib/zonePriceEstimate";
import { loadVenueZone, loadZonePintIndex } from "@/lib/zonePintIndex.server";
import rawPriceUpdates from "@/public/data/price_updates/latest.json";
import "@/app/ledger/[id]/ledger.css";

export default async function PriceRecordSection({ venue }: { venue: Venue }) {
  const id = venue.id;
  const priceVenue = mergePriceUpdates(
    [venue],
    cityIdFromVenueId(id) || isNationalBaseVenueId(id) ? [] : parsePriceUpdates(rawPriceUpdates),
    venueUpdateKey,
  )[0]!;
  const bundleRead = await ukPriceBundleRowsFor(id);
  let bundle = bundleRead.status === "unavailable" ? null : bundlePricesForCategory(bundleRead.rows, BUNDLE_DEFAULT_CATEGORY);
  if (bundle && isPubVenueKind(venue.kind)) {
    const [zone, zoneIndex] = await Promise.all([loadVenueZone(id), loadZonePintIndex()]);
    bundle = withZoneEstimate(bundle, zone, zoneIndex);
  }
  return (
    <section id="ledger" className="pubPage__section">
      <LedgerLiveProvider venueId={id}>
        {bundle ? <LedgerPriceRecord venue={priceVenue} bundle={bundle} /> : <><h2>Price record</h2><p role="status">The price record did not answer just now.</p></>}
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
