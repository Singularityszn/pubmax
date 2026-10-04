import { isHarvestableOperatorUrl } from "../../lib/harvest/sourcePolicy.ts";
import { haversineMeters, namesLikelySamePub, normalizeVenueIdentityName } from "./venueCanonicalization.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const normalizedText = (value) => text(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const POSTCODE = /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;
const LISTING_HOSTS = ["camra.org.uk", "whatpub.com", "designmynight.com", "squaremeal.co.uk", "opentable.co.uk", "opentable.com", "visitbirmingham.com", "visitleeds.co.uk", "visitglasgow.com", "visitscotland.com", "visitmanchester.com", "visitliverpool.com", "visitbristol.co.uk", "visitbath.co.uk", "experienceoxfordshire.org", "visitcambridge.org", "thisisdurham.com", "gonorthwales.co.uk"];

export function postcodeIn(value) {
  const match = text(value).match(POSTCODE);
  if (!match) return null;
  const compact = match[0].toUpperCase().replace(/\s/g, "");
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function allowedEvidenceUrl(value) {
  if (!isHarvestableOperatorUrl(value)) return false;
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return !/(^|\.)(?:google\.[a-z.]+|googleapis\.com|googleusercontent\.com|goo\.gl|g\.co|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com)$/.test(host)
    && !host.endsWith(".google") && !/(?:^|\/)maps(?:\/|$)/i.test(url.pathname);
}

const hostOf = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

export function isListingUrl(url) {
  const host = hostOf(url);
  return LISTING_HOSTS.some((listing) => host === listing || host.endsWith(`.${listing}`));
}

function sourceBelongsToVenue(url, website) {
  if (isListingUrl(url)) return true;
  if (!allowedEvidenceUrl(website)) return false;
  return hostOf(url) === hostOf(website);
}

export const GENERIC_NAME_WORDS = new Set(["the", "and", "bar", "bars", "pub", "pubs", "inn", "restaurant", "restaurants", "kitchen", "club", "lounge", "tavern", "hotel", "cafe", "grill", "wine", "cocktail", "cocktails", "brewery", "taproom", "beer", "tap", "arms", "house", "great", "united", "kingdom", "england", "scotland", "wales"]);

// News brands whose name runs a place into a news word. They are named
// outright, so a venue called The Lamp Post or The Olive Tree keeps its site.
const NEWS_BRANDS = new Set([
  "liverpoolecho", "manchestereveningnews", "bristolpost", "bristollive", "bristol247", "birminghammail", "birminghampost", "birminghamlive",
  "glasgowlive", "glasgowtimes", "eveningtimes", "heraldscotland", "dailyrecord", "scotsman", "yorkshireeveningpost", "yorkshirepost", "leedslive",
  "examinerlive", "chroniclelive", "northernecho", "thenorthernecho", "durhamtimes", "walesonline", "dailypost", "northwaleslive",
  "oxfordmail", "oxfordshirelive", "cambridgenews", "cambridgeshirelive", "bathecho", "somersetlive", "liverpoolworld", "manchesterworld",
  "bristolworld", "nottinghampost", "leicestermercury", "lancashiretelegraph", "theguardian", "dailymail", "thesun", "mirror", "express",
  "telegraph", "independent", "standard", "metro", "bbc", "inyourarea", "trip",
]);
const AGGREGATOR_LABEL = /tripadvisor|yelp|foursquare|timeout|expedia|booking|wikipedia|reddit|tiktok/;

export const words = (value) => normalizeVenueIdentityName(value).split(/\s+/).map((word) => word.replace(/[^a-z0-9]/g, "")).filter(Boolean);

// The page vouches for its own venue only when its registered domain carries
// a distinctive word of the venue's name. City names, short and generic
// words, named news brands, aggregator hosts and subdomains of other sites
// never count; a news word inside a venue's own domain does not refuse it.
export function ownSiteFor(name, landedUrl, city) {
  const hostname = new URL(landedUrl).hostname.toLowerCase();
  const labels = hostname.split(".");
  const registrable = labels.slice(/^(?:co|org|ac|gov|net|ltd|plc|me)\.uk$/.test(labels.slice(-2).join(".")) ? -3 : -2).join(".");
  const label = registrable.split(".")[0].replace(/[^a-z0-9]/g, "");
  if (NEWS_BRANDS.has(label) || AGGREGATOR_LABEL.test(label)) return null;
  const host = registrable.replace(/[^a-z0-9]/g, "");
  const cityWords = new Set(words(city.displayName));
  const distinctive = words(name).filter((word) => word.length >= 4 && !GENERIC_NAME_WORDS.has(word) && !cityWords.has(word));
  return distinctive.some((word) => host.includes(word)) ? `${new URL(landedUrl).origin}/` : null;
}

const fold = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const PUB_OR_BAR_EVIDENCE = /\b(?:pub|public house|bar|beers?|cocktails?|ales?|lagers?)\b/i;
const RESTAURANT_ALCOHOL = /\b(?:beers?|cocktails?|draught|lagers?|wine list|wines|spirits|alcoholic drinks)\b/i;

// A venue's own name is not evidence of what it serves: "Fuzion Noodle Bar"
// or "Bar & Grill" says nothing about alcohol, so the name is struck from the
// quotes before the drinking test, however the quote spells or marks it up:
// accents, apostrophes, markdown, spacing and "&" for "and" all still match.
export function withoutName(quotes, name) {
  const folded = fold(quotes);
  const tokens = fold(name).split(/[^a-z0-9]+/).filter((token) => token && token !== "and");
  if (!tokens.length) return folded;
  const pattern = tokens.map((token) => token.split("").join("[^a-z0-9]*")).join("(?:[^a-z0-9]|and)*");
  return folded.replace(new RegExp(pattern, "g"), " ");
}

export function statesDrinking(kind, quotes, name) {
  const rest = withoutName(quotes, name);
  return kind === "restaurant" ? RESTAURANT_ALCOHOL.test(rest) : PUB_OR_BAR_EVIDENCE.test(rest);
}

const CLUB_EVIDENCE = /\b(?:this is a club|club members|members['’]? (?:only|club|bar)|members sailing club|club ?house)\b/;
const CLUB_LABEL = /\bclub\s*,\s*in\b/;

// A pub or bar discovery is a club, in the sense of a social, members', sports
// or services club, when its name carries the word club and its evidence says
// it is a club. A name alone never makes a club, so Cosy Club or Junkyard Golf
// Club keeps the kind its research gave it. A restaurant keeps its kind,
// because its drinking evidence was judged by the restaurant rule. A stored
// club is judged again as the bar it was filed from. The evidence is read
// without the name, except for CAMRA's "Club, in <place>" type label, which
// follows the name in a camra.org.uk listing and is read there alone.
export function discoveredKind({ name, kind, evidence }) {
  const base = kind === "club" ? "bar" : kind;
  if (base === "restaurant" || !/\bclub\b/.test(fold(name))) return base;
  const rest = withoutName((evidence ?? []).map((entry) => entry.excerpt).join(" "), name);
  const labels = fold((evidence ?? []).filter((entry) => /(^|\.)camra\.org\.uk$/.test(hostOf(entry.url))).map((entry) => entry.excerpt).join(" "));
  return CLUB_EVIDENCE.test(rest) || CLUB_LABEL.test(labels) ? "club" : base;
}

export function inCity(lat, lng, city) {
  const [south, west, north, east] = city.bbox;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= south && lat <= north && lng >= west && lng <= east;
}

// Every address part before and around the postcode must be quoted, so a
// qualifier such as "Upstairs" cannot vouch for an invented street after it.
// With local set, one excerpt must state all of it: a listing's entries are
// separate passages, and joining two of them would pair one venue's name with
// another's address. Parallel's per-field citations bind across excerpts.
export function citationBindsIdentity({ name, address, evidence }, city, { local = false } = {}) {
  if (local) return (evidence ?? []).some((entry) => citationBindsIdentity({ name, address, evidence: [entry] }, city));
  const quotes = normalizedText((evidence ?? []).map((entry) => entry.excerpt).join(" "));
  const segments = text(address).split(",");
  const postcodeAt = segments.findIndex((segment) => postcodeIn(segment));
  const postcode = postcodeIn(address);
  if (!postcode || !quotes.includes(normalizedText(name)) || !quotes.includes(normalizedText(postcode))) return false;
  return segments.slice(0, postcodeAt + 1)
    .map((segment) => normalizedText(segment.replace(POSTCODE, "")))
    .filter((segment) => segment && segment !== normalizedText(city.displayName))
    .every((segment) => quotes.includes(segment));
}

// Names a research page returned that neither a known venue nor an earlier
// page already carries. A page with none ends its slice's paging.
export function unseenNames(rows, known) {
  const names = known.map((row) => normalizeVenueIdentityName(row.name));
  const fresh = [];
  for (const row of rows) {
    const name = normalizeVenueIdentityName(row?.name);
    if (!name || names.some((other) => namesLikelySamePub(name, other))) continue;
    names.push(name);
    fresh.push(row.name);
  }
  return fresh;
}

export function postcodeDistricts(rows, city) {
  const districts = new Set();
  for (const row of rows) {
    const postcode = postcodeIn(row.postcode) ?? postcodeIn(row.address);
    if (postcode && inCity(row.lat, row.lng, city)) districts.add(postcode.split(" ")[0]);
  }
  return [...districts].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export function parseTaskVenues(result, city, observedAt, { local = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(observedAt) || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > Date.now()) throw new Error("Invalid observation date");
  const output = result?.output;
  if (output?.type !== "json" || !Array.isArray(output.content?.venues)) throw new Error("Parallel Task result has no structured venues list");
  const candidates = [];
  const rejected = [];
  for (const [index, row] of output.content.venues.entries()) {
    const name = text(row?.name);
    const address = text(row?.address);
    const postcode = postcodeIn(address);
    const kind = row?.kind;
    const basis = (output.basis ?? []).filter((entry) => entry.field === `venues.${index}` || entry.field?.startsWith(`venues.${index}.`));
    const citations = basis.filter((entry) => entry.confidence !== "low").flatMap((entry) => entry.citations ?? []);
    const evidence = (Array.isArray(row?.evidence) ? row.evidence : []).filter((entry) => {
      if (!allowedEvidenceUrl(entry?.url) || !sourceBelongsToVenue(entry.url, row.website)) return false;
      const excerpt = normalizedText(entry.excerpt);
      return excerpt.length >= 15 && citations.some((citation) => citation.url === entry.url
        && (citation.excerpts ?? []).some((quote) => normalizedText(quote).includes(excerpt)));
    }).map((entry) => ({ url: entry.url, excerpt: text(entry.excerpt) }));
    const quotes = evidence.map((entry) => entry.excerpt).join(" ");
    let reason = null;
    if (!name || !["pub", "bar", "restaurant"].includes(kind)) reason = "invalid-identity-or-kind";
    else if (!address || !postcode) reason = "missing-geocodable-address";
    else if (!evidence.length) reason = "missing-venue-specific-citation";
    else if (!citationBindsIdentity({ name, address, evidence }, city, { local })) reason = "citation-does-not-bind-name-and-address";
    else if (/\b(?:permanently closed|closed permanently|ceased trading)\b/i.test(quotes)) reason = "closed-venue";
    else if (!statesDrinking(kind, quotes, name)) reason = "missing-drinking-evidence";
    if (reason) { rejected.push({ name, reason }); continue; }
    const citedNumbers = new Set((quotes.match(/[-+]?\d+(?:\.\d+)?/g) ?? []).map(Number));
    const pointIsCited = inCity(row.lat, row.lng, city) && citedNumbers.has(row.lat) && citedNumbers.has(row.lng);
    candidates.push({ name, kind, address, postcode, locality: city.displayName, website: text(row.website) || null,
      lat: pointIsCited ? row.lat : null, lng: pointIsCited ? row.lng : null,
      coordinatePrecision: pointIsCited ? "source-coordinate" : null,
      sourceUrls: [...new Set(evidence.map((entry) => entry.url))], evidence, observedAt });
  }
  return { candidates, rejected };
}

const STREET_ABBREVIATIONS = { st: "street", rd: "road", ln: "lane", ave: "avenue", av: "avenue", dr: "drive", sq: "square", pl: "place", cres: "crescent", ter: "terrace", pde: "parade", ct: "court" };

// A venue's street address as a house-number range and a normalised street
// name, read from the first address part that has a street. OSM writes the
// number as its own part ("78, London Road"), so a bare number joins the next.
export function streetIdentity(address) {
  const parts = text(address).split(",").map((part) => part.trim());
  for (const [index, part] of parts.entries()) {
    if (/^\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?$/i.test(part) && parts[index + 1]) parts[index + 1] = `${part} ${parts[index + 1]}`;
  }
  for (const part of parts) {
    const words = fold(part.replace(POSTCODE, " ")).replace(/[^a-z0-9\s-]/g, " ").trim().split(/\s+/).filter(Boolean);
    const numbered = /^(\d+)[a-z]?(?:-(\d+)[a-z]?)?$/.exec(words[0] ?? "");
    const street = (numbered ? words.slice(1) : words).map((word) => STREET_ABBREVIATIONS[word] ?? word).join(" ");
    if (!/\b(?:street|road|lane|avenue|drive|square|place|crescent|terrace|parade|court|way|row|walk|hill|gate|green|close|broadway|quay|wharf|yard|gardens|kirkway|boulevard|mews)\b/.test(street)) continue;
    return { street, from: numbered ? Number(numbered[1]) : null, to: numbered ? Number(numbered[2] ?? numbered[1]) : null };
  }
  return null;
}

// Apostrophes join letters. The shared normalizer handles other punctuation.
const dedupeName = (name) => normalizeVenueIdentityName(text(name).replace(/['’‘`]/g, ""));

// One venue, by compatible name and place. The same house number on the same
// street is the same venue whatever postcode each source gives; the same
// street where a number is missing, or the same full postcode, is the same
// venue within a postcode centroid's spread. Other differing
// street addresses stay apart beyond a corner's width, so nearby branches of
// one name are kept.
export function sameVenue(a, b) {
  const aName = dedupeName(a.name);
  const bName = dedupeName(b.name);
  if (!aName || !bName) return false;
  const namesMatch = namesLikelySamePub(aName, bName);
  const withoutType = (name) => name.replace(/\b(?:pub|inn|hotel|tavern|bar|restaurant|taproom)\b/g, " ").trim().replace(/\s+/g, " ");
  const core = withoutType(aName);
  if (!namesMatch && (!core || core !== withoutType(bName))) return false;
  const distance = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  const centroid = a.coordinatePrecision === "postcode-centroid" || b.coordinatePrecision === "postcode-centroid";
  const near = centroid ? 100 : 50;
  const aStreet = streetIdentity(a.address);
  const bStreet = streetIdentity(b.address);
  const sameStreet = aStreet && bStreet && aStreet.street === bStreet.street;
  const numbered = aStreet?.from != null && bStreet?.from != null;
  const aPostcode = postcodeIn(a.address);
  const bPostcode = postcodeIn(b.address);
  const numbersOverlap = numbered && aStreet.from <= bStreet.to && bStreet.from <= aStreet.to;
  if (!namesMatch && !(sameStreet && (numbered ? numbersOverlap : aPostcode && aPostcode === bPostcode))) return false;
  if (sameStreet && numbered) return aStreet.from <= bStreet.to && bStreet.from <= aStreet.to ? distance <= 1000 : distance <= near;
  if (sameStreet && centroid) return distance <= 800;
  if (aPostcode && aPostcode === bPostcode) return distance <= 800;
  if (aStreet && bStreet && !sameStreet) return distance <= near;
  if (centroid) return distance <= 350;
  if (aPostcode && bPostcode && distance > 50) return false;
  return distance <= 150;
}

// Two bases from the national packs, the city maps' OSM pubs and London.
// `known` is every recorded venue, for slicing cities into districts and
// telling research what exists. `shipped` is what a map shows, the only venues
// a discovery can duplicate: every national OSM pub, the drink pack's bars (as
// the UK base layer ships them), every city map's OSM pubs and the London
// dataset. Food, work and other drink rows ship on no map.
export function venueBases({ ukPubs, ukDrink, ukFood, ukWork, cityPubs, london }) {
  const located = (row) => row.name && Number.isFinite(row.lat) && Number.isFinite(row.lng);
  const shipped = [
    ...ukPubs,
    ...ukDrink.filter((row) => row.kind === "bar"),
    ...cityPubs,
    ...london.map((row) => ({ name: row.pub_name, lat: row.latitude, lng: row.longitude, address: row.address })),
  ].filter(located);
  const unshown = [...ukDrink.filter((row) => row.kind !== "bar"), ...ukFood, ...ukWork].filter(located);
  return { known: [...shipped, ...unshown], shipped };
}

export function dedupeVenues(candidates, existing) {
  const accepted = [];
  const duplicates = [];
  for (const candidate of candidates) {
    const match = [...existing, ...accepted].find((venue) => sameVenue(candidate, venue));
    if (match) duplicates.push({ name: candidate.name, id: candidate.id ?? null, matchedName: match.name, matchedId: match.id ?? match.osmId ?? null });
    else accepted.push(candidate);
  }
  return { accepted, duplicates };
}

const webRow = (row) => Boolean(row.provider) && row.provider !== "parallel";

export function validateDiscoveryPack(pack, city) {
  if (pack?.city !== city.id || !Array.isArray(pack?.venues)) throw new Error(`Invalid Parallel venue pack for ${city.id}`);
  for (const row of pack.venues) {
    if (!text(row?.name) || !["pub", "bar", "club", "restaurant"].includes(row.kind) || !inCity(row.lat, row.lng, city)
      || !postcodeIn(row.address) || !["source-coordinate", "postcode-centroid"].includes(row.coordinatePrecision)
      || !/^\d{4}-\d{2}-\d{2}T/.test(row.observedAt) || !Number.isFinite(Date.parse(row.observedAt)) || Date.parse(row.observedAt) > Date.now()
      || !Array.isArray(row.sourceUrls) || !row.sourceUrls.length || !row.sourceUrls.every(allowedEvidenceUrl)
      || !Array.isArray(row.evidence) || !row.evidence.length || !row.evidence.every((entry) => row.sourceUrls.includes(entry.url) && text(entry.excerpt))
      || (webRow(row) && !row.sourceUrls.every((url) => isListingUrl(url) || ownSiteFor(row.name, url, city)))
      || !citationBindsIdentity(row, city, { local: webRow(row) })
      || !statesDrinking(row.kind, row.evidence.map((entry) => entry.excerpt).join(" "), row.name)) {
      throw new Error(`Invalid Parallel venue evidence: ${text(row?.name) || "unnamed"}`);
    }
  }
  return pack;
}

// Provider citations do not establish permission. Only permitted excerpts
// may bind a venue's identity, address, drinking evidence and kind at
// publication.
export async function gateVenueEvidence(rows, city, permission) {
  const venues = [];
  const rejected = [];
  const results = await Promise.all(rows.map(async (row) => {
    const answers = await Promise.all(row.sourceUrls.map(async (url) => [url, allowedEvidenceUrl(url)
      ? await permission(url) : { outcome: "refused", reason: "outside-source-fence" }]));
    const permitted = new Set(answers.filter(([, answer]) => answer.outcome === "allowed").map(([url]) => url));
    const kept = permitted.size === row.sourceUrls.length ? row : {
      ...row, sourceUrls: row.sourceUrls.filter((url) => permitted.has(url)),
      evidence: row.evidence.filter((entry) => permitted.has(entry.url)),
    };
    try {
      const candidate = { ...kept, kind: discoveredKind(kept) };
      validateDiscoveryPack({ city: city.id, venues: [candidate] }, city);
      if (candidate.coordinatePrecision === "source-coordinate") {
        const numbers = new Set(candidate.evidence.flatMap((entry) => (entry.excerpt.match(/[-+]?\d+(?:\.\d+)?/g) ?? []).map(Number)));
        if (!numbers.has(candidate.lat) || !numbers.has(candidate.lng)) throw new Error("Unpermitted coordinate evidence");
      }
      return { venue: candidate };
    } catch {
      return { rejection: { name: row.name, id: row.id ?? null, reason: "source-permission: insufficient permitted evidence",
        sources: answers.filter(([, answer]) => answer.outcome !== "allowed").map(([url, answer]) => ({ url, ...answer })) } };
    }
  }));
  for (const result of results) {
    if (result.venue) venues.push(result.venue);
    else rejected.push(result.rejection);
  }
  return { venues, rejected };
}

// The city's own earlier discoveries are retained, never reported as
// duplicates of themselves; only other sources can make a candidate a
// duplicate. A stored row that fails validation, or that an existing venue
// now matches, is withdrawn with the reason and the venue it matched.
export function assembleCityDiscoveries({ found, previous, existing, city }) {
  const valid = previous.filter((row) => {
    try { validateDiscoveryPack({ city: city.id, venues: [row] }, city); return true; }
    catch { return false; }
  });
  const stored = dedupeVenues(valid, existing);
  const kept = stored.accepted;
  const withdrawn = [
    ...previous.filter((row) => !valid.includes(row)).map((row) => ({ name: row.name, id: row.id ?? null, reason: "fails validation" })),
    ...stored.duplicates.map((row) => ({ ...row, reason: "duplicate of an existing venue" })),
  ];
  const unique = dedupeVenues(found, []);
  const fresh = dedupeVenues(unique.accepted, kept);
  const { accepted, duplicates } = dedupeVenues(fresh.accepted, existing);
  const retained = [...new Map(fresh.duplicates.map((row) => [row.matchedId ?? row.matchedName, { name: row.matchedName, id: row.matchedId }])).values()];
  return { venues: [...kept, ...accepted], accepted, retained, duplicates, withdrawn, repeats: unique.duplicates.length };
}

export function mergeCityVenueSources(osmPack, discoveryPack, city) {
  validateDiscoveryPack(discoveryPack, city);
  const { accepted } = dedupeVenues(discoveryPack.venues, osmPack.pubs);
  return { ...osmPack, pubs: [...osmPack.pubs, ...accepted] };
}
