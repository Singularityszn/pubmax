import { allowedEvidenceUrl, GENERIC_NAME_WORDS, isListingUrl, ownSiteFor, postcodeIn, statesDrinking, withoutName, words } from "./parallelVenueDiscovery.mjs";

const POSTCODES = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi;
const STREET_NUMBER = /^(?:unit|units|no\.?|number)?\s*\d+[a-z]?(?:\s*[-–&/]\s*\d+[a-z]?)?,?\s+[a-z]/i;
const STREET_WORD = /\b(?:street|st|road|rd|lane|ln|square|sq|place|pl|row|way|avenue|ave|terrace|parade|gate|hill|walk|court|yard|quay|wharf|arcade|market|centre|center|close|crescent|drive|green|approach|precinct|circus|broadway|boulevard|mews|passage|alley|embankment|promenade|esplanade)\.?$/i;
const BUILDING_WORD = /\b(?:house|building|buildings|mill|works|hall|chambers|exchange|arches|unit|units|floor|basement|upstairs|downstairs|courtyard|station|hotel|centre|quarter)\b/i;
const SKIP_LINE = /^(?:open|(?:permanently |temporarily )?closed|address|location|location information|location_on|find us|where to find us|key information|contact|contact us|get in touch|visit us|directions|map|phone|tel|telephone|email|open now|opening hours|.*miles? from you|\d+ (?:regulars?|changing beers?)|cask ale.*|real ale.*|real cider.*|in [a-z' -]{2,30}|(?:independent |micro ?|community |sports |hotel |wine |cocktail |cafe |restaurant )?(?:pub|bar|club|restaurant|brewery|cafe|hotel)(?:(?: in| ·).{0,30})?)\s*:?$/i;
const PHONE = /^(?:phone|tel|telephone|t)?\s*:?\s*\+?[\d ()]{9,}$/i;
const GENERIC_NAME = /^(?:home|contact|contact us|about|about us|menus?|find us|location|address|opening hours|bookings?|book a table|reviews?|events?|gallery|news|blog|faqs?|directions|welcome|private hire|gift cards?|careers|tripadvisor)$/i;
const NOT_A_NAME = /\b(?:in|near|around)\s+[a-z]|\bbest\b|\btop \d+\b|\bguide\b|\bthings to do\b/i;
const PUB = /\b(?:pub|public house|inn|tavern|alehouse|ale house|freehouse|free house)\b/i;
const BAR = /\b(?:bar|cocktails?|taproom|tap room|wine bar|beer hall)\b/i;
const RESTAURANT = /\b(?:restaurant|dining|bistro|brasserie|trattoria|pizzeria|eatery|steakhouse)\b/i;
const ALCOHOL = /\b(?:beers?|cocktails?|draught|lagers?|wine list|wines|spirits|ales?|alcoholic drinks)\b/i;


// Link targets and image sources are page furniture, not words the page states.
export function pageText(markdown) {
  return String(markdown ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\]\([^)]*\)/g, "]");
}

const clean = (value) => value.replace(/[*_#>`\\[\]]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/^\d{1,3}[.)]\s+/, "").replace(/^(?:address|location|where|find us)\s*:\s*/i, "");
const PROSE = /[.!?]\s|\b\d{1,2}(?:[.:]\d{2})?\s?(?:am|pm)\b/i;

function isNameLike(value, city) {
  const cityWords = new Set(words(city.displayName));
  return value.length >= 3 && value.length <= 60 && value.split(" ").length <= 8 && /[a-z]/i.test(value) && !/[:@]|https?\b|\d{3,}/.test(value) && !PROSE.test(value)
    && !GENERIC_NAME.test(value) && !NOT_A_NAME.test(value) && !SKIP_LINE.test(value)
    && words(value).some((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word) && !cityWords.has(word));
}

function sentenceAround(text, from, to, test) {
  const lines = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (offset + line.length >= from && offset <= to) lines.push(line);
    offset += line.length + 1;
  }
  for (const line of lines) {
    const quote = line.trim();
    if (quote.length >= 15 && quote.length <= 240 && test(quote)) return quote;
  }
  return null;
}

const wordCount = (value) => value.split(" ").length;

// Address parts read backward from the postcode: up to three localities, then
// at least one street, then at most one building. Returns where the name sits.
const isStreet = (piece) => wordCount(piece) <= 6 && (STREET_NUMBER.test(piece) || STREET_WORD.test(piece));

function addressBefore(pieces, tail) {
  const parts = tail ? [tail] : [];
  let index = pieces.length - 2;
  let street = tail && isStreet(tail) ? pieces.length - 1 : -1;
  let localities = 0;
  for (; index >= 0 && parts.length < 6; index -= 1) {
    const piece = pieces[index].text;
    if (!piece) continue;
    if (PROSE.test(piece)) break;
    if (isStreet(piece)) { parts.unshift(piece); street = index; continue; }
    if (street < 0 && localities < 3 && wordCount(piece) <= 3 && !/\d/.test(piece) && !SKIP_LINE.test(piece)) { parts.unshift(piece); localities += 1; continue; }
    if (street >= 0 && BUILDING_WORD.test(piece) && wordCount(piece) <= 5) { parts.unshift(piece); index -= 1; }
    break;
  }
  if (street < 0) return null;
  const skip = (at) => !pieces[at].text || SKIP_LINE.test(pieces[at].text) || PHONE.test(pieces[at].text) || /^in [a-z' -]{2,30}$/i.test(pieces[at + 1]?.text ?? "");
  for (let skipped = 0; index >= 0 && skipped < 6 && skip(index); index -= 1) skipped += 1;
  return { parts, nameAt: index };
}

function entryKind(local) {
  if (PUB.test(local)) return "pub";
  if (BAR.test(local)) return "bar";
  return RESTAURANT.test(local) && ALCOHOL.test(local) ? "restaurant" : null;
}

// Venue entries a page states itself: a name, then the address parts that
// run up to a postcode in the district, with no other postcode between. The
// excerpt quotes the whole entry, so its name, street and postcode are bound
// by one passage rather than joined across a page.
export function pageVenues({ text, title, landedUrl, city, district }) {
  const listing = isListingUrl(landedUrl);
  const titleNames = new Set(String(title ?? "").split(/\s*[|–—:·•]\s*|\s+-\s+/).map(clean).filter(Boolean).map((name) => name.toLowerCase()));
  const venues = [];
  const seen = new Set();
  let previousEnd = 0;
  for (const match of text.matchAll(POSTCODES)) {
    const postcode = postcodeIn(match[0]);
    const start = previousEnd;
    const end = match.index + match[0].length;
    previousEnd = end;
    if (!postcode || postcode.split(" ")[0] !== district) continue;
    const pieces = [...text.slice(start, end).matchAll(/[^\n,|]+/g)].map((piece) => ({ text: clean(piece[0]), at: start + piece.index + piece[0].length - piece[0].trimStart().length }));
    const tail = clean(pieces.at(-1)?.text.replace(match[0], "") ?? "");
    const address = wordCount(tail) <= 6 ? addressBefore(pieces, tail) : null;
    const name = address && address.nameAt >= 0 ? pieces[address.nameAt].text : "";
    if (!isNameLike(name, city) || (!listing && !titleNames.has(name.toLowerCase())) || seen.has(`${name.toLowerCase()}|${postcode}`)) continue;
    const website = ownSiteFor(name, landedUrl, city);
    if (!listing && !website) continue;
    const excerptStart = pieces[address.nameAt].at;
    const excerpt = text.slice(excerptStart, end).trim();
    if (/^\s*(?:permanently |temporarily )?closed\s*$/im.test(excerpt)) continue;
    const next = text.slice(end).search(POSTCODES);
    const entryEnd = Math.min(text.length, end + (next < 0 ? 400 : Math.min(next, 400)));
    const kind = entryKind(withoutName(website ? text.slice(excerptStart, entryEnd) : excerpt, name));
    if (!kind) continue;
    const drinks = (quoted) => statesDrinking(kind, quoted, name);
    const quote = drinks(excerpt) ? null : website ? sentenceAround(text, excerptStart, entryEnd, drinks) : null;
    if (!drinks(excerpt) && !quote) continue;
    seen.add(`${name.toLowerCase()}|${postcode}`);
    const parts = address.parts;
    venues.push({ name, kind, address: [...parts.slice(0, -1), `${parts.at(-1)} ${match[0]}`.trim()].join(", "), website, lat: null, lng: null,
      evidence: [{ url: landedUrl, excerpt }, ...(quote ? [{ url: landedUrl, excerpt: quote }] : [])] });
  }
  return venues;
}

// A read page in the Task result shape, so parseTaskVenues judges it with
// the same rules: every excerpt must appear verbatim in the page it cites.
export function webPageResult({ landedUrl, text, title }, city, district) {
  const venues = pageVenues({ text: pageText(text), title, landedUrl, city, district });
  return { output: { type: "json", content: { venues }, basis: venues.map((_, index) => ({
    field: `venues.${index}`, confidence: "high", citations: [{ url: landedUrl, excerpts: [pageText(text)] }],
  })) } };
}

// Sites that cannot be a venue's own page or a venue listing: public bodies,
// universities, postcode and property lookups, care and childcare directories,
// job boards, transport operators, research indexes and travel aggregators.
const NON_VENUE_SOURCES = [
  [/\.(?:gov|nhs|ac|sch|police|mod)\.uk$|\.(?:gov|edu)$/, "public body or academic site"],
  [/(?:^|\.)(?:postcodearea\.co\.uk|doogal\.co\.uk|getthedata\.com|streetcheck\.co\.uk|rightmove\.co\.uk|zoopla\.co\.uk|onthemarket\.com)$/, "postcode or property lookup"],
  [/(?:^|\.)(?:carehome\.co\.uk|daynurseries\.co\.uk|childcare\.co\.uk)$/, "care or childcare directory"],
  [/(?:^|\.)(?:simplyhired\.co\.uk|indeed\.(?:com|co\.uk)|reed\.co\.uk|totaljobs\.com|caterer\.com)$/, "job board"],
  [/(?:^|\.)(?:stagecoachbus\.com|merseyrail\.org|nationalrail\.co\.uk|firstbus\.co\.uk|arrivabus\.co\.uk|thetrainline\.com)$/, "transport operator"],
  [/(?:^|\.)(?:researchgate\.net|academia\.edu|wikipedia\.org)$/, "research or reference index"],
  [/(?:^|\.)(?:hotels\.com|booking\.com|expedia\.co\.uk|expedia\.com|trip\.com)$/, "travel aggregator"],
];

export function nonVenueSource(url) {
  const host = new URL(url).hostname.toLowerCase();
  return NON_VENUE_SOURCES.find(([pattern]) => pattern.test(host))?.[1] ?? null;
}

// Pages worth reading: permitted, stating a postcode in this district, and
// either a venue listing or a single venue's own page. A page naming several
// postcodes on any other host cannot be the venue's own site.
export function rankSearchResults(results, district) {
  const ranked = [];
  for (const result of results ?? []) {
    if (!allowedEvidenceUrl(result?.url)) continue;
    const text = `${result.title ?? ""} ${result.content ?? ""} ${result.raw_content ?? ""}`;
    const postcodes = new Set((text.match(POSTCODES) ?? []).map(postcodeIn).filter(Boolean));
    const inDistrict = [...postcodes].filter((postcode) => postcode.split(" ")[0] === district).length;
    if (!inDistrict || (postcodes.size > 1 && !isListingUrl(result.url))) continue;
    ranked.push({ url: result.url, inDistrict, score: result.score ?? 0 });
  }
  return ranked.sort((a, b) => b.inDistrict - a.inDistrict || b.score - a.score).map((row) => row.url);
}

export function webQueries(city, district, category) {
  return [
    `${category.label} in ${district} ${city.displayName} UK address`,
    `independent ${category.label} ${district} ${city.displayName} postcode`,
    `new ${category.label} opened ${district} ${city.displayName}`,
  ];
}

// Only a page that is gone is settled by the read itself. Extract's own words
// ("Failed to fetch url", "Error fetching content") give no cause, so they are
// asked again unless other evidence settles them.
export function readFailureIsDefinitive(failure) {
  const status = Number(failure?.status);
  if (Number.isFinite(status) && status > 0) return status === 404 || status === 410;
  return /\b(?:404|410)\b/.test(String(failure?.error ?? ""));
}
