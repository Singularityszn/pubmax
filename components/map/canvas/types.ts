import type { PintTrustState } from "@/lib/pintTrust";
import type { ConfirmedPriceInput } from "@/lib/priceTier";
import type { venueFromDetailPayload } from "@/lib/venues";

export type VenueSignal = {
  hasPintDrops: boolean;
  /**
   * THE trust state of this venue's Pint Drop lane (lib/pintTrust.ts), read
   * once and projected into every drop-lane field below, so the pin, the
   * sheet, the peek and the list rows all read one state. Absent means the
   * signal was built by a caller that holds no drops.
   */
  pintTrust?: PintTrustState;
  latestContributorPrice: number | null;
  /** Epoch ms of the observation supplying latestContributorPrice. */
  latestContributorAt?: number | null;
  /** Display-only demo price for pin colour when cheapestPrice is null. */
  latestDemoPrice?: number | null;
  /**
   * The venue's live Pint Drop confirmation as `priceStandingFor` takes it, or
   * null when nobody has confirmed a price here and null again once the last
   * confirmation ages out. THE read seam for a green standing: a surface hands
   * this to lib/priceTier.ts rather than deciding what confirmed means.
   */
  confirmedPrice?: ConfirmedPriceInput | null;
  /**
   * The venue's in-window pint report that has NOT earned the map
   * (`provisionalPriceDrop`, lib/venues.ts), or null. Kept strictly apart from
   * `latestContributorPrice`: nothing reads this into a band, a bucket or a pin
   * figure. It exists so a sheet can show the drinker's figure, dated, instead
   * of telling the reader the pub has no price.
   */
  provisionalContributorPrice?: number | null;
  /** Epoch ms that provisional report was logged, or null. */
  provisionalContributorAt?: number | null;
  /**
   * The venue's freshest public report that is PAST the window
   * (`agedPriceDrop`, lib/venues.ts), or null. Reaches the sheet's price area
   * alone, as the `aged` lane, and nothing on the pin.
   */
  agedContributorPrice?: number | null;
  /** Epoch ms that aged report was logged, or null. */
  agedContributorAt?: number | null;
};
export type HoveredVenue = { id: string; name: string; x: number; y: number };
/**
 * What `GET /api/venue/[id]` publishes: the amenity STATUS and no amenity
 * booleans, so a payload is read through `venueFromDetailPayload` rather than
 * used as a `Venue` directly.
 */
export type VenueDetailResponse = { venue?: VenueDetailPayload | null };
export type VenueDetailPayload = Parameters<typeof venueFromDetailPayload>[0];
export type FailedHoverImage = { venueId: string; url: string };
