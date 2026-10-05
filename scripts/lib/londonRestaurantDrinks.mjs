// London restaurants that serve drinks, on the evidence of their own sites.
//
// OpenStreetMap rarely tags alcohol on a restaurant: of about 9,600 named
// London restaurants, 159 state it, so the London venue layer showed almost no
// restaurant a drinker could sit in. This lane keeps OSM as the identity (name,
// address, position) and asks the restaurant's OWN website whether it pours.
// A row is published only with a verbatim quote from that site, the URL that
// stated it, the day it was read and a robots answer that permitted the read.
//
// The rules are pure and live here; `scripts/harvest_london_restaurant_drinks.mjs`
// does the reading, and `scripts/build_london_venue_shards.mjs` publishes.

import { allowedEvidenceUrl, ownSiteFor, withoutName } from "./parallelVenueDiscovery.mjs";
import { pageText, readFailureIsDefinitive } from "./webVenueDiscovery.mjs";

export const LONDON = { id: "london", displayName: "London" };

// Sites that answer for many restaurants and never for one: delivery,
// booking, review, listing and link-in-bio hosts. An OSM `website` tag that
// points at one of them names a channel, not the restaurant's own site.
const NOT_OWN_SITE = /(?:^|\.)(?:deliveroo\.[a-z.]+|just-?eat\.[a-z.]+|ubereats\.com|uber\.com|tripadvisor\.[a-z.]+|opentable\.[a-z.]+|resy\.com|sevenrooms\.com|thefork\.[a-z.]+|quandoo\.[a-z.]+|bookatable\.[a-z.]+|designmynight\.com|squaremeal\.co\.uk|timeout\.com|yelp\.[a-z.]+|yell\.com|linktr\.ee|beacons\.ai|business\.site|toasttab\.com|order\.online|slerp\.com|flipdish\.[a-z.]+|foodhub\.co\.uk|hungrrr\.co\.uk|kukd\.com|zomato\.com|happycow\.net|wikipedia\.org|wikidata\.org)$/;

export function hostOf(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/** The site a restaurant's OSM tag names, when it is a site of its own and the fence permits it. */
export function taggedOwnSite(website) {
  const raw = String(website ?? "").trim().split(/\s*;\s*/)[0];
  if (!raw) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    if (!allowedEvidenceUrl(url) || NOT_OWN_SITE.test(hostOf(url))) return null;
    return new URL(url).href;
  } catch {
    return null;
  }
}

// One spelling of a page for matching an Extract answer to its request:
// scheme, `www.`, a fragment and a trailing slash are not part of the page.
function pageKey(url) {
  try {
    const parsed = new URL(url);
    return `${hostOf(url)}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return String(url);
  }
}

/**
 * Pairs each requested URL with Tavily Extract's answer for it. Tavily may
 * canonicalise a URL (scheme, `www.`, trailing slash) or report the page it
 * landed on, so a result is matched exactly, then by its normalised spelling,
 * then as the only unmatched result on the only unmatched request's host. A
 * matched page keeps the URL Tavily reported, so the landing check sees any
 * redirect. A failure is settled only when it says the page is gone; any other
 * failure is `retry`, which the caller must not cache.
 */
export function pairExtractResults(urls, data) {
  const results = [...(data?.results ?? [])];
  const failures = data?.failed_results ?? [];
  const answers = new Map();
  const take = (url, test) => {
    const at = results.findIndex(test);
    if (at < 0) return false;
    answers.set(url, { landedUrl: results[at].url, text: results[at].raw_content ?? "" });
    results.splice(at, 1);
    return true;
  };
  const open = urls.filter((url) => !take(url, (result) => result.url === url));
  const still = open.filter((url) => !take(url, (result) => pageKey(result.url) === pageKey(url)));
  for (const url of still) {
    const host = hostOf(url);
    const sameHostRequests = still.filter((other) => hostOf(other) === host && !answers.has(other));
    const sameHostResults = results.filter((result) => hostOf(result.url) === host);
    if (sameHostRequests.length === 1 && sameHostResults.length === 1) take(url, (result) => result === sameHostResults[0]);
  }
  for (const url of urls) {
    if (answers.has(url)) continue;
    const failure = failures.find((row) => row.url === url || pageKey(row.url) === pageKey(url)) ?? { url, error: "Extract returned nothing" };
    const reason = String(failure.error ?? failure.status ?? "Extract returned nothing").slice(0, 160);
    answers.set(url, readFailureIsDefinitive(failure) ? { unreadable: reason } : { retry: reason });
  }
  return answers;
}

/** A cached unreadable page Extract might read on another try: not a 404 or 410. */
export const retryableUnreadable = (page) => Boolean(page?.unreadable) && !readFailureIsDefinitive({ error: page.unreadable });

const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi;
const compactPostcode = (value) => String(value ?? "").toUpperCase().replace(/\s+/g, "");
const fold = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A search result binds a restaurant's own site only when its host carries a
 * distinctive word of the name (the shared own-site rule) and its text states
 * this restaurant's postcode, or its house number and street as whole words,
 * so 1 High Street is not 221 High Street. Two restaurants with one name stay
 * apart that way.
 */
export function searchBindsSite(candidate, result) {
  if (!allowedEvidenceUrl(result?.url) || NOT_OWN_SITE.test(hostOf(result.url))) return null;
  const site = ownSiteFor(candidate.name, result.url, LONDON);
  if (!site) return null;
  const text = `${result.title ?? ""}\n${result.content ?? ""}\n${result.raw_content ?? ""}`;
  const postcode = compactPostcode(candidate.postcode);
  const statedPostcodes = (text.match(POSTCODE) ?? []).map(compactPostcode);
  const street = candidate.street && candidate.housenumber
    ? new RegExp(`(?:^|[^0-9a-z])${escapeRegExp(fold(`${candidate.housenumber} ${candidate.street}`))}(?![0-9a-z])`)
    : null;
  const bound = (postcode && statedPostcodes.includes(postcode)) || (street && street.test(fold(text)));
  return bound ? result.url : null;
}

export function searchQuery(candidate) {
  const where = candidate.postcode || [candidate.housenumber, candidate.street].filter(Boolean).join(" ");
  return `${candidate.name} restaurant ${where} London`.replace(/\s+/g, " ").trim();
}

// What a restaurant pours. Words a soft drink or a dish also uses are left
// out ("drinks", "bar" alone), and the phrases below are struck before the
// test so an alcohol-free beer or a ginger beer cannot pass as one.
const DRINK_WORDS = /\b(?:wine ?lists?|wines?|cocktails?|beers?|lagers?|ales|draught|ciders?|prosecco|champagne|cava|sake|soju|spirits|whiske?y|gin|negronis?|spritz|aperitivo|sommelier|by the glass|fully licensed|licensed (?:bar|restaurant)|alcoholic drinks)\b/;
const NOT_ALCOHOL = /\b(?:non[- ]?alcoholic|alcohol[- ]free|low (?:and|&) no|no (?:and|&) low|zero[- ](?:alcohol|proof)|0(?:\.0)?%|de-?alcoholi[sz]ed|ginger|root|birch|soft|virgin)(?:[- ]+(?!and\b|or\b)[a-z]+){0,2}?[- ]+(?:wine ?lists?|wines?|cocktails?|beers?|lagers?|ales|ciders?|spirits|gin|prosecco|sake|drinks)\b/g;

// A drink cooked into a dish, or named by one, is an ingredient, not a drink
// served: beer batter, a red wine jus, cider vinegar, a sake tare, champagne
// cod, a cider vinaigrette, sake lees, a prawn cocktail, cocktail sauce, white
// wine and saffron, trout grilled in wine, sausage marinated in red wine, no
// beer in our batter, and sake meaning salmon on a sushi menu.
const FOOD = "(?:garlic|tomato(?:es)?|saffron|herbs|chilli|parsley|olive oil|cream|shallots?|onions?|mushrooms?|prawns|mussels|soya?|yuzu|ponzu|mirin|sauce)";
const INGREDIENT = new RegExp([
  String.raw`\b(?:wines?|beers?|lagers?|ales|ciders?|sake|whiske?y|gin|champagne|prosecco|cava)[- ](?:batter(?:ed)?|sauce|jus|vinegar|reduction|glaze[ds]?|braised|poached|marinated|marinade|tare|butter|cream|jelly|gravy|cured|dressing|risotto|mustard|syrup|caramel)\b`,
  String.raw`\b(?:in|with) (?:a )?(?:red |white )?wine (?:and \w+ )?(?:sauce|jus|reduction)\b`,
  String.raw`\bcooking (?:wine|sake)\b`,
  String.raw`\b(?:wines?|beers?|ciders?|sake|champagne|prosecco)(?: (?!and\b)[a-z]+){0,2} (?:vinaigrette|cod|cakes?|lees|filling)\b`,
  String.raw`\b(?:prawn|shrimp|fruit|lobster|crab|seafood|avocado) cocktails?\b`,
  String.raw`\bcocktail (?:sauce|sausages?|sticks?)\b`,
  String.raw`\bsake (?:teriyaki|nigiri|sashimi|maki|roll|don|x ?\d)`,
  String.raw`\b(?:(?:red|white|rice) )?(?:wine|sake) (?:and|&|with) (?:[a-z-]+ )?${FOOD}\b`,
  String.raw`\b${FOOD},? (?:(?:and|&|with) )?(?:(?:red|white|rice) )?(?:wine|sake)\b`,
  String.raw`\b(?:cook(?:ed|s)?|marinated|marinaded|simmered|braised|stewed|poached|battered|glazed|fried|stir|steamed|grilled|baked|roasted) (?:(?!served|paired|enjoyed|washed|accompanied|matched)[a-z-]+ ){0,3}(?:in|with) (?:(?!glass|bottle|pint|carafe|jug)[a-z-]+ ){0,3}(?:wine|sake|beer|cider)\b`,
  String.raw`\b(?:don['’]?t|do not|never) use (?:any )?(?:wines?|beers?|lagers?|ales|ciders?|sake|whiske?y|gin|champagne|prosecco|cava|spirits)\b`,
].join("|"), "g");

// Words that carry a drink word and pour nothing: a mood, a Thai saying, a
// restaurant elsewhere that a chef trained at, glassware, and a drink served at some
// other venue (the venue's own name is struck first, so "the wine experience
// at" with no name left after it still counts).
const IDIOM = /\b(?:high|in good|raise the|lift the) spirits\b|\bgan gin\b|\bbread (?:&|and) wine\b|\b(?:champagne|prosecco|wine|beer|cocktail) (?:flutes?|glass(?:es|ware)?)\b|\b(?:whiske?y|wines?|gin|sake|cocktails?|beers?) experience at [a-z]+/g;

// A page that says the restaurant does not pour settles it, whatever else the
// site says: bring-your-own, unlicensed, or a stated no-alcohol house.
const REFUSES_ALCOHOL = /\b(?:byob?|bring your own (?:bottle|wine|drinks?|alcohol|booze|beer)|unlicen[cs]ed|not licen[cs]ed|(?:do not|don['’]?t|does not|doesn['’]?t) (?:serve|offer|sell) (?:any )?alcohol(?:ic (?:drinks|beverages))?(?! (?:to|without)\b)|no alcohol (?:is )?(?:served|on the premises|allowed)(?! to)|alcohol is not (?:served|permitted|sold)|we are (?:a )?(?:dry|alcohol[- ]free)|alcohol[- ]free (?:restaurant|venue|establishment|premises))\b/;

const clean = (line) => line.replace(/[*_#>`\\|]/g, " ").replace(/\[([^\]]*)\]/g, "$1").replace(/\s+/g, " ").trim();

// The quote read without the venue's own name and without every phrase above
// that names a drink without pouring one.
const drinkText = (quote, name) => withoutName(quote, name).replace(NOT_ALCOHOL, " ").replace(INGREDIENT, " ").replace(IDIOM, " ");

/** True when the quote, read without the venue's own name, states alcohol. */
export function statesRestaurantDrinks(quote, name) {
  return DRINK_WORDS.test(drinkText(quote, name));
}

// Page furniture that can carry a drink word without saying what this
// restaurant pours: copyright footers, legal lines, ingredient declarations
// and sauce lists.
const FURNITURE = /©|\bcopyright\b|all rights reserved|registered (?:in england|office|company)|company (?:no|number)|\b(?:ingredients|sauces) ?:/;

// A line that sells, gives, delivers or teaches a drink, or that names another
// venue, says nothing about what this restaurant pours: a wine shop, a gift,
// a delivery, a masterclass, a consultancy, a sister venue, a bar beneath the
// restaurant, a brasserie elsewhere, or the stray bracket left by navigation
// link text.
const OFF_PREMISES = /\b(?:(?:wine|bottle|online|farm) shop|shop online|purchase|buy\b(?! (?:one|two|1|2)\b)|order online|deliver(?:y|ies|ed)|to take home|hampers?|gifts?|masterclass(?:es)?|workshops?|(?:making|tasting|cooking|cocktail|wine|sushi|cookery|pasta|baking) (?:class(?:es)?|courses?|schools?)|consultancy|consulting|our other (?:restaurants?|venues?|sites?|bars?)|sister (?:restaurants?|venues?|bars?|sites?))\b|\b(?:alongside|part of) [a-z ]* group\b|\b(?:below|above|beneath|underneath) (?:my|our) (?:[a-z]+ )?restaurant\b|\bat (?!our\b|the\b|my\b|this\b)[a-z]+ brasserie\b|[\[\]]/;

// A page at a shop path (a Shopify collection, a product, a shop or a store
// page) sells what it names; it is not evidence and is not followed.
const OFF_PREMISES_PATH = /^\/(?:pages\/)?(?:collections|products?|shop|stores?)(?:\/|$)/i;
export const offPremisesUrl = (url) => OFF_PREMISES_PATH.test(new URL(url).pathname);
const DRINK_WORDS_ALL = new RegExp(DRINK_WORDS.source, "g");

// How much a line says: one point per distinct drink word, so "cocktails,
// wine and craft beer" outranks a passing "prosecco".
function drinkScore(line, name) {
  return new Set(drinkText(line, name).match(DRINK_WORDS_ALL) ?? []).size;
}

/**
 * Reads one page of the restaurant's own site. Returns the line that says
 * most about what it pours, or the line that refuses alcohol, or neither. A
 * refusal outranks any drinking line on the same page, and footers, shop,
 * gift, delivery, class and other-venue lines never count.
 */
export function drinksEvidence(markdown, name) {
  const lines = pageText(markdown).split("\n").map(clean).filter((line) => line.length >= 12 && line.length <= 240);
  const refusal = lines.find((line) => REFUSES_ALCOHOL.test(fold(line)));
  if (refusal) return { refused: refusal };
  let best = null;
  let bestScore = 0;
  for (const line of lines) {
    if (FURNITURE.test(fold(line)) || OFF_PREMISES.test(withoutName(line, name)) || !statesRestaurantDrinks(line, name)) continue;
    const score = drinkScore(line, name);
    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  }
  return best ? { quote: best } : {};
}

const DRINK_LINK = /drink|wine|cocktail|beer|\bbar\b|sake|spirits/i;
const MENU_LINK = /menu/i;

/**
 * Pages of the same site worth one more read when the landing page states
 * nothing: drinks, wine, cocktail and bar pages first, then menus. At most
 * `limit`, never another host, never a shop page, never the page itself.
 */
export function drinkLinks(markdown, pageUrl, limit = 3) {
  const base = new URL(pageUrl);
  const drink = [];
  const menu = [];
  for (const match of String(markdown ?? "").matchAll(/(?<!!)\[([^\]]{0,80})\]\(([^)\s]+)\)/g)) {
    let url;
    try {
      url = new URL(match[2], base);
    } catch {
      continue;
    }
    url.hash = "";
    if (!/^https?:$/.test(url.protocol) || hostOf(url.href) !== hostOf(base.href) || url.href === base.href) continue;
    if (/\.(?:jpe?g|png|gif|webp|svg|mp4|zip)$/i.test(url.pathname)) continue;
    const label = `${match[1]} ${decodeURIComponent(url.pathname)}`;
    if (DRINK_LINK.test(label)) drink.push(url.href);
    else if (MENU_LINK.test(label)) menu.push(url.href);
  }
  return [...new Set([...drink, ...menu])].filter((url) => allowedEvidenceUrl(url) && !offPremisesUrl(url)).slice(0, limit);
}

/** OSM restaurants that may need evidence: named, positioned, alcohol not stated either way, not excluded. */
export function restaurantCandidate(element, { statesAlcohol, excluded }) {
  const tags = element?.tags ?? {};
  const name = String(tags.name ?? "").trim();
  const lat = Number(element?.lat ?? element?.center?.lat);
  const lng = Number(element?.lon ?? element?.center?.lon);
  if (tags.amenity !== "restaurant" || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (statesAlcohol(tags) || /^(?:no|none)$/i.test(String(tags.alcohol ?? "")) || excluded.has(`${element.type}/${element.id}`)) return null;
  const street = String(tags["addr:street"] ?? "").trim() || null;
  const housenumber = String(tags["addr:housenumber"] ?? "").trim() || null;
  const postcode = String(tags["addr:postcode"] ?? "").trim() || null;
  return {
    osmId: `${element.type}/${element.id}`,
    name,
    lat,
    lng,
    address: [housenumber, street, tags["addr:city"] || null, postcode].filter(Boolean).join(", "),
    postcode,
    street,
    housenumber,
    website: taggedOwnSite(tags.website ?? tags["contact:website"] ?? tags.url),
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const OSM_ID = /^(?:node|way|relation)\/\d+$/;

const ownSite = (url) => allowedEvidenceUrl(url) && !NOT_OWN_SITE.test(hostOf(url));

function evidenceProblems(entry, row) {
  const excerpt = String(entry?.excerpt ?? "");
  return [
    (!ownSite(row.website) || !allowedEvidenceUrl(entry?.url) || hostOf(entry.url) !== hostOf(row.website)) && `evidence ${entry?.url} is not on the restaurant's own site`,
    allowedEvidenceUrl(entry?.url) && offPremisesUrl(entry.url) && `evidence ${entry.url} is a shop page`,
    !statesRestaurantDrinks(excerpt, row.name) && "excerpt does not state alcohol without the name",
    REFUSES_ALCOHOL.test(fold(excerpt)) && "excerpt refuses alcohol",
    FURNITURE.test(fold(excerpt)) && "excerpt is page furniture",
    OFF_PREMISES.test(withoutName(excerpt, row.name)) && "excerpt sells, gives, delivers or teaches a drink, or names another venue",
    !ISO.test(String(entry?.observedAt ?? "")) && "evidence has no read date",
    (entry?.robots?.outcome !== "allowed" || !ISO.test(String(entry?.robots?.checkedAt ?? ""))) && "evidence has no recorded robots permission",
  ].filter(Boolean);
}

function rowProblems(row, inGreaterLondon) {
  const evidence = Array.isArray(row?.evidence) ? row.evidence : [];
  return [
    !OSM_ID.test(String(row?.osmId ?? "")) && "osmId is not an OSM element id",
    row?.kind !== "restaurant" && "kind must be restaurant",
    (typeof row?.name !== "string" || !row.name.trim()) && "no name",
    !inGreaterLondon(Number(row?.lat), Number(row?.lng)) && "outside Greater London",
    !ownSite(row?.website) && "website is not an own site the fence permits",
    !evidence.length && "no evidence",
    ...evidence.flatMap((entry) => evidenceProblems(entry, row)),
  ].filter(Boolean);
}

/**
 * The OSM ids of `data/london_restaurant_drinks/exclusions.json`: restaurants
 * whose quote the classifier accepts but a reviewer found says nothing about
 * this restaurant pouring. Every row names its osmId, its name and a reason.
 */
export function excludedOsmIds(exclusions) {
  if (!exclusions || !Array.isArray(exclusions.rows)) throw new Error("exclusions has no rows array");
  return new Set(exclusions.rows.map((row) => {
    if (!OSM_ID.test(String(row?.osmId ?? "")) || !String(row?.name ?? "").trim() || !String(row?.reason ?? "").trim()) {
      throw new Error(`exclusion ${JSON.stringify(row)} needs an OSM osmId, a name and a reason`);
    }
    return row.osmId;
  }));
}

/**
 * Every published row, checked again on every build: an OSM identity inside
 * Greater London and not excluded, an own-site evidence URL the fence permits,
 * a recorded robots permission, a quote that states alcohol without the
 * venue's name and a read date. Returns the problems; an empty list is a valid
 * pack.
 */
export function validateRestaurantDrinksPack(pack, { inGreaterLondon, exclusions }) {
  const excluded = excludedOsmIds(exclusions);
  if (!pack || !Array.isArray(pack.rows)) return ["pack has no rows array"];
  const problems = [];
  const seen = new Set();
  for (const row of pack.rows) {
    const id = row?.osmId ?? "(no osmId)";
    if (seen.has(id)) problems.push(`${id}: repeated`);
    if (excluded.has(id)) problems.push(`${id}: excluded in exclusions.json`);
    seen.add(id);
    problems.push(...rowProblems(row, inGreaterLondon).map((problem) => `${id}: ${problem}`));
  }
  return problems;
}
