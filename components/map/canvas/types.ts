import type { ConfirmedPriceInput } from "@/lib/priceTier";
import type { Venue } from "@/lib/venues";

export type VenueSignal = {
  hasPintDrops: boolean;
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
};
export type HoveredVenue = { id: string; name: string; x: number; y: number };
export type VenueDetailResponse = { venue?: Venue | null };
export type FailedHoverImage = { venueId: string; url: string };
