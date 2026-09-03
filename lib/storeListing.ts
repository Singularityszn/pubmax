// The store listing, as data.
//
// Every field an App Store Connect or Play Console form asks for has a HARD
// character limit, and going over is not caught by review: the form truncates
// the text, or refuses the paste, at the moment the owner is trying to ship.
// Those limits were prose in docs/STORE_READINESS.md, so nothing could check
// them and nothing could say whether an edit to the copy had broken one.
//
// So the copy lives here with its limit beside it,
// __tests__/storeAssets.test.ts holds every field to its own limit, and the doc
// quotes this module rather than being a second original. The doc stays the
// owner's paste sheet; this is what says the paste will fit.
//
// The two names are NOT interchangeable and neither is typed out here. A store
// listing is an INSTALL surface, so the name field is APP_NAME; the description
// is talking about the product, so it names the BRAND. lib/brandNaming.ts is
// the one seam for both (AGENTS.md, "PUBMAXX is the brand; PUBMAXXING is the
// app"), and letters typed here would rot apart from it.
//
// Voice: docs/VOICE.md governs this like any other copy. No exclamation marks,
// British English, and the price lane described honestly, because a listing
// that promises a figure the map cannot keep is the one claim a reviewer and a
// drinker both catch.

import { APP_NAME, BRAND_NAME } from "@/lib/brandNaming";

/**
 * What each store's form will actually accept. Apple and Google publish these
 * and they have been stable for years; they sit here so a field and its ceiling
 * cannot drift apart.
 */
export const STORE_LISTING_LIMITS = {
  /** Apple app name, and Google Play title. Both 30. */
  name: 30,
  /** Apple subtitle. Google has no equivalent field. */
  subtitle: 30,
  /** Google Play short description. */
  shortDescription: 80,
  /** Apple keyword field, comma-separated. Spaces count. */
  keywords: 100,
  /** Apple description and Google Play full description. */
  description: 4000,
  /** Apple promotional text, editable without a review. */
  promotionalText: 170,
} as const;

export type StoreListingField = keyof typeof STORE_LISTING_LIMITS;

/** The name under the icon. An install surface, so APP_NAME. */
export const STORE_LISTING_NAME: string = APP_NAME;

/**
 * Apple's subtitle. It says what the app does in a search result, so it carries
 * the promise rather than repeating the name.
 */
export const STORE_LISTING_SUBTITLE = "Cheap pints near you, tonight";

/** Google Play's short description, shown above the fold in search. */
export const STORE_LISTING_SHORT_DESCRIPTION =
  "The nearest London pubs, what a pint costs, and a crawl route home.";

/**
 * Apple's keyword field. Comma-separated with no space after each comma,
 * because the spaces count against the 100 and buy nothing. Nothing here
 * repeats the name or the subtitle: Apple indexes both already, so a repeat
 * spends characters on a term that is free.
 */
export const STORE_LISTING_KEYWORDS =
  "london pubs,pub crawl,pint prices,near me,nightlife,beer,happy hour,bars,pub finder,drinks,taproom";

/**
 * Apple's promotional text. It sits above the description and can be changed
 * without a review, so it carries what is true this month.
 */
export const STORE_LISTING_PROMOTIONAL_TEXT =
  `Leaving the office and want a good cheap pint near you? ${BRAND_NAME} shows the nearest pubs, ` +
  "what a pint costs, and a crawl route home. London only, for now.";

/** The description both stores take. */
export const STORE_LISTING_DESCRIPTION = [
  `${BRAND_NAME} finds you a good cheap pint near where you are, then gets you home.`,
  "",
  "You have left work. You want a decent pint that does not cost a fortune, somewhere close, " +
    `without reading forty reviews first. ${BRAND_NAME} opens straight on the map, shows the ` +
    "nearest pubs, tells you roughly what a pint costs, and lays out a short crawl you can " +
    "actually walk.",
  "",
  "What you get:",
  "",
  "- Nearest pubs, ranked by distance, with pint prices where we have them.",
  "- A one-tap crawl route that keeps the walking sensible and ends near a way home.",
  "- Opening hours, last orders, and what is on tonight.",
  "- A private log of your nights out, with photos if you want them. Yours, on your phone, " +
    "not a feed for strangers.",
  "",
  "London only for now. More cities later.",
  "",
  "A note on prices: pubs change them and we do not. We show the best figure we have and when " +
    "we last saw it. Treat it as a steer, not a promise.",
  "",
  `${BRAND_NAME} is free. No account needed to find a pint.`,
].join("\n");

/** Every field with the limit it must fit, so a test can walk the whole form. */
export const STORE_LISTING_FIELDS: Record<StoreListingField, string> = {
  name: STORE_LISTING_NAME,
  subtitle: STORE_LISTING_SUBTITLE,
  shortDescription: STORE_LISTING_SHORT_DESCRIPTION,
  keywords: STORE_LISTING_KEYWORDS,
  description: STORE_LISTING_DESCRIPTION,
  promotionalText: STORE_LISTING_PROMOTIONAL_TEXT,
};

/** Whether one field fits its form. Pure; the test walks every field with it. */
export function storeListingFieldFits(field: StoreListingField): boolean {
  return STORE_LISTING_FIELDS[field].length <= STORE_LISTING_LIMITS[field];
}
