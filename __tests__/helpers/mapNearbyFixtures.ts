import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

export function nearbyPriceRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "nearby-price", pub_name: "The Crown", pint_name: "Guinness", price_gbp: 4.5,
    price_text: "£4.50", address: "1 Test Street", latitude: 51.501, longitude: -0.1,
    boroughs_visible: "Camden", boroughs_raw_embedded_non_anomaly: "Camden",
    boroughs_raw_embedded_site_anomaly: "", primary_borough: "Camden", rank_visible_borough: "1",
    estimated_average_price_text: "", pub_url: "https://www.pint-prices.com/pub/crown",
    constructed_pub_url: "", borough_urls: "", phone_number: "", email: "", website: "",
    booking_link: "", image_url: "", description: "", comment: "", food: "", cocktails: "",
    beer_garden: "", live_sports: "", live_music: "", pub_quiz: "", darts: "", pool: "",
    happy_hour: "", karaoke: "", cool: "", source_datasets: "pint-prices", source_row_count: 1,
    has_visible_borough_row: true, has_raw_embedded_map_row: false, has_individual_pub_page_row: true,
    is_clean_canonical_app_row: true, data_quality_notes: "", scraped_at_values: "2026-10-20T12:00:00Z",
    ...overrides,
  };
}

export function nearbyVenue(overrides: Partial<Venue> = {}): Venue {
  const base = groupVenuePrices([nearbyPriceRow()])[0];
  if (!base) throw new Error("Nearby fixture did not produce a venue");
  return { ...base, id: "venue-crown", ...overrides };
}
