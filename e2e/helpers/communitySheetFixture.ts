/**
 * E2e specs that drive Pint Drop / community sheet state need a pub with no
 * harvested uk_prices rows and no drink_price_updates overlays. The guard is
 * __tests__/e2eCommunitySheetFixtureVenue.test.ts.
 */
export const COMMUNITY_SHEET_FIXTURE_VENUE_ID = "venue-4xlgb0";

export const COMMUNITY_SHEET_FIXTURE_VENUE_NAME = "Princess Louise";

export const COMMUNITY_SHEET_FIXTURE_MAP_PATH = `/map?sel=${COMMUNITY_SHEET_FIXTURE_VENUE_ID}`;
