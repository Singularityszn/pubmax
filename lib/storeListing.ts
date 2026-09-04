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
  /**
   * Apple keyword field, comma-separated. The ceiling is 100 BYTES rather
   * than characters, so a non-ASCII localisation spends two or three bytes
   * on a character this English field spends one on. Spaces count, which is
   * why nothing here has a space after its comma.
   */
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

/**
 * Google Play's short description, shown above the fold in search and INDEXED,
 * unlike Apple's subtitle-plus-keywords arrangement. So it is written to carry
 * the terms rather than to sound like a strapline, and it still has to read as
 * one sentence a person would say.
 */
export const STORE_LISTING_SHORT_DESCRIPTION =
  "London pub prices, the cheapest pint near you, and a crawl route home.";

/**
 * Apple's keyword field. Three rules, in the order they cost characters.
 *
 * SINGLE TOKENS, NOT PHRASES. Apple builds the combinations itself across the
 * name, the subtitle and this field, so "pub crawl" and "pub finder" spent the
 * word "pub" twice and Apple indexed it once. Fifteen words now buy the
 * phrases the eleven entries used to name, and several the old field could not
 * reach: beer garden, local pub, pub guide, London nightlife.
 *
 * NOTHING THE SUBTITLE ALREADY EARNS. Apple indexes the name and the subtitle
 * for free, so cheap, pint, near, you and tonight are deliberately absent.
 * "near me" used to sit here and spent five of its seven characters on a word
 * "near you" had already bought.
 *
 * NO THIRD-PARTY MARKS. A brewery's name is somebody else's trademark, and
 * Apple rejects a keyword field that trades on one.
 *
 * "taproom" left with the phrases: it is an American word for a room a British
 * drinker calls the pub, and "local", "ale" and "lager" are what the same
 * person types.
 */
export const STORE_LISTING_KEYWORDS =
  "london,uk,pub,bar,crawl,beer,ale,lager,garden,price,drink,nightlife,happy,hour,finder,local,guide";

/**
 * Apple's promotional text. It sits above the description and can be changed
 * without a review, so it carries what is true this month. Apple has confirmed
 * it is NOT indexed for search, so it is written for the reader alone and
 * spends none of its 170 characters chasing a term.
 */
export const STORE_LISTING_PROMOTIONAL_TEXT =
  "Paid for a pint? Log what you paid, and the next drinker sees it. Nearest pubs, " +
  "what a pint costs, what is on tonight, and a crawl route home. London prices, UK pubs.";

/**
 * The description both stores take. ONE body, not two.
 *
 * It used to be a short version and a long version, which is two originals and
 * therefore two things to keep true. Apple does not index the description at
 * all, so length costs it nothing; Google Play indexes it heavily, so length
 * is the only place several target terms can honestly live. One longer body
 * serves both, and a reader on either store sees the same first three lines
 * before the fold.
 *
 * Every line here is a claim a reviewer can open the app and check, so each one
 * names something that ships:
 *  - the price a drinker logs, and the second drinker who confirms it
 *    (lib/pintDropConfirmation.ts, the corroboration threshold in
 *    lib/communityPrice.ts)
 *  - the Pint Index (app/pint-index)
 *  - Pub Pal and its seven forms (lib/pubPal.ts)
 *  - the last train badge (lib/lastTrainBadge.ts)
 *  - prices London, pubs UK-wide (lib/cityCapabilities.ts)
 *
 * What is NOT here matters as much. "Last orders" was in this copy for a month
 * and the app has never held a last-orders time for any pub. And the old line
 * calling the night log "not a feed for strangers" contradicted section 5 of
 * docs/STORE_READINESS.md, which declares a pub wall photo SHARED on Google
 * Play's data safety form, because it is.
 */
export const STORE_LISTING_DESCRIPTION = [
  `${BRAND_NAME} tells you what a pint costs before you walk in.`,
  "",
  "You have left work. You want a decent pint that does not cost a fortune, somewhere close, " +
    `without reading forty reviews first. ${BRAND_NAME} opens on the map, works out where you ` +
    "are, and puts the nearest pubs in front of you with the price we hold for each one. " +
    "Ask for more than one and it lays out a crawl you can actually walk.",
  "",
  "Find a pint",
  "",
  "- The nearest London pubs, ranked by how far you actually have to walk.",
  "- Pint prices with the day we last saw them, so you know how fresh the number is.",
  "- Beer, wine, spirits, cocktails and no alcohol, each priced on its own.",
  "- Opening hours, so you do not arrive at a locked door.",
  "",
  "Log what you paid",
  "",
  "- Paid for a pint? Log the price. That is where these numbers come from, and it is " +
    "how the cheap ones get found.",
  "- A price only moves the map once a second drinker confirms it, so one wrong figure " +
    "cannot drag a pub up or down on its own.",
  "- The Pint Index publishes what London is charging, month by month, with the day each " +
    "price was seen.",
  "",
  "Plan the night",
  "",
  "- Describe the outing and get a crawl route back in order, with the walking kept honest.",
  "- What is on tonight, from named sources, with the date we read them.",
  "- The last train, so the night has an ending you chose.",
  "",
  "Meet your Pub Pal",
  "",
  "- A companion who helps you find a pub, sort a plan and keep the night. Pick its form " +
    "and give it a name. It is yours and it stays on your account.",
  "",
  "Straight answers on prices",
  "",
  "Pubs change their prices and we are not standing at the bar. We show the best figure we " +
    "have and when we last saw it. Treat it as a steer, not a promise.",
  "",
  "Privacy",
  "",
  "Full GPS precision stays on your phone. Ask for something nearby and the app sends a " +
    "rounded point for that one request. Analytics stay off until you turn them on. There " +
    "are no adverts, and nothing is sold on. A photo is public only where you post it: a " +
    "pub wall and the feed are public by design, and a Moment stays on your phone until " +
    "you publish it.",
  "",
  "Where it works",
  "",
  "Pubs across the UK are on the map. Pint prices are London for now, because a price is " +
    "only worth showing once drinkers here have checked it. Other cities follow the same way.",
  "",
  `${BRAND_NAME} is free. You do not need an account to find a pint.`,
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
