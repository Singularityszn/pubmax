// Exa-found pub websites as price-crawl candidates, and the address check that
// binds one to its pub. Kept beside run.mjs so the crawl CLI stays readable and
// the rules stay testable.
//
// THREE RULES.
//
// 1. THE WEBSITE IS THE ONE THE FOLD WOULD RECORD. Candidates come from the
//    completed Exa shards through `overlayRowsFromHarvestRecords`, the same
//    derivation `npm run harvest:fold` writes to `harvest_venue_overlays`, so
//    https, one URL and no social host are already enforced before this file
//    sees a row. Nothing here reads or writes production.
//
// 2. A NEW HOST IS BOUND BY ADDRESS OR IT IS NOT READ FOR A PRICE. Exa finds a
//    namesake's site as readily as the pub's own (the Joiners Arms in Morpeth
//    answered for the one in Morecambe). A host the OSM snapshot states for no
//    pub is therefore admitted only for a pub whose OSM tags state a postcode
//    or a house number and street, and the crawl keeps its prices only when a
//    page of that site states the same postcode or the same street address.
//    That is the Tavily lane's binding rule, applied to Exa.
//
// 3. ONE NEW HOST, ONE PUB. A host several pubs' searches landed on is an
//    estate or a guess, and an estate is argued for in the source table, so it
//    is counted and never crawled from this input.

/** Every reason an Exa overlay row produced no crawl candidate. */
export const EXA_SITE_OUTCOMES = Object.freeze([
  "candidate",
  "no-site",
  "unparseable-url",
  "policy-refused-host",
  "not-a-pubs-own-host",
  "no-address",
]);

/** Aggregators, directories and socials: a page about a pub, never the pub's own site. */
export const NOT_A_PUBS_OWN_SITE =
  /(^|\.)(pint-prices\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|tripadvisor\.[a-z.]+|yelp\.[a-z.]+|google\.[a-z.]+|linktr\.ee|wixsite\.com|whatpub\.com|camra\.org\.uk|useyourlocal\.com|inapub\.co\.uk|sluurpy\.[a-z.]+|opentable\.[a-z.]+|designmynight\.com|timeout\.com|squaremeal\.co\.uk|beerintheevening\.com|pubsgalore\.co\.uk|restaurantguru\.com|ubereats\.com|deliveroo\.co\.uk|just-eat\.co\.uk|wikipedia\.org|loveyourpub\.co\.uk)$/i;

const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

export function hostOfUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A full UK postcode in its canonical spaced form, or null. */
export function canonicalPostcode(value) {
  if (typeof value !== "string") return null;
  const match = UK_POSTCODE.exec(value.trim().toUpperCase());
  return match ? `${match[1]} ${match[2]}` : null;
}

/** What a page must state for the site to be this pub's: OSM's postcode, or its house number and street. */
export function bindingFromAddressTags(tags) {
  if (!tags || typeof tags !== "object") return null;
  const postcode = canonicalPostcode(tags["addr:postcode"]);
  const number = typeof tags["addr:housenumber"] === "string" ? tags["addr:housenumber"].trim() : "";
  const street = typeof tags["addr:street"] === "string" ? tags["addr:street"].trim() : "";
  // A street alone is not an address: half the country has a High Street pub.
  const streetAddress = number && street ? `${number} ${street}` : null;
  if (!postcode && !streetAddress) return null;
  return { postcode, streetAddress };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The page's words, lower-cased, with markup and runs of whitespace collapsed.
 * Script bodies are kept: a site builder often states its address only in its
 * own page data or JSON-LD, and that is still the site stating it.
 */
function plainText(body) {
  return String(body ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[,\s]+/g, " ")
    .toLowerCase();
}

/** Does this page state the pub's postcode or its street address? */
export function pageBindsPub(body, binding) {
  if (!binding) return false;
  const text = plainText(body);
  if (binding.postcode) {
    const [outward, inward] = binding.postcode.toLowerCase().split(" ");
    const postcode = new RegExp(`(^|[^a-z0-9])${escapeRegExp(outward)} ?${escapeRegExp(inward)}($|[^a-z0-9])`);
    // A full postcode is specific enough to be read inside an attribute too,
    // where a site builder keeps its own page data.
    const raw = String(body ?? "").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").toLowerCase();
    if (postcode.test(text) || postcode.test(raw)) return true;
  }
  if (binding.streetAddress) {
    const wanted = binding.streetAddress.toLowerCase().replace(/[,\s]+/g, " ");
    const words = wanted.split(" ").map(escapeRegExp);
    // "12 Fleet Street" also reads as "12 Fleet St".
    const last = words.length > 1 && /^(street|road|avenue|lane)$/.test(words.at(-1))
      ? `(${words.at(-1)}|${{ street: "st", road: "rd", avenue: "ave", lane: "ln" }[words.at(-1)]}\\.?)`
      : words.at(-1);
    const pattern = [...words.slice(0, -1), last].join(" ");
    if (new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`).test(text)) return true;
  }
  return false;
}

/** Links on a page that usually carry a pub's address. */
export function contactLinkCandidates(html, origin, limit = 2) {
  const found = [];
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html ?? "").matchAll(anchor)) {
    if (found.length >= limit) break;
    const label = match[2].replace(/<[^>]+>/g, " ").toLowerCase();
    if (!/contact|find us|location|visit us|getting here|directions/.test(`${match[1].toLowerCase()} ${label}`)) continue;
    let url;
    try {
      url = new URL(match[1], origin);
    } catch {
      continue;
    }
    if (url.origin !== origin || !/^https?:$/.test(url.protocol)) continue;
    const href = url.toString();
    if (!found.includes(href)) found.push(href);
  }
  return found;
}

/**
 * Turn fold-derived overlay rows into crawl candidates, counting every row that
 * yields none. `seedByOsmId` maps a canonical OSM id to its seed row.
 */
export function selectExaSiteCandidates(overlayRows, seedByOsmId, { isHarvestableOperatorUrl }) {
  const outcomes = Object.fromEntries(EXA_SITE_OUTCOMES.map((name) => [name, 0]));
  const refusedHosts = {};
  const candidates = [];
  for (const row of overlayRows) {
    const siteUrl = row.website ?? row.menuUrl ?? null;
    if (!siteUrl) {
      outcomes["no-site"] += 1;
      continue;
    }
    const host = hostOfUrl(siteUrl);
    const menuHost = row.menuUrl ? hostOfUrl(row.menuUrl) : null;
    if (!host) {
      outcomes["unparseable-url"] += 1;
      continue;
    }
    if (!isHarvestableOperatorUrl(siteUrl)) {
      outcomes["policy-refused-host"] += 1;
      refusedHosts[host] = (refusedHosts[host] ?? 0) + 1;
      continue;
    }
    if (NOT_A_PUBS_OWN_SITE.test(host)) {
      outcomes["not-a-pubs-own-host"] += 1;
      continue;
    }
    const seed = seedByOsmId.get(row.osmId);
    const binding = bindingFromAddressTags(seed?.addressTags);
    if (!seed || !binding) {
      outcomes["no-address"] += 1;
      continue;
    }
    outcomes.candidate += 1;
    candidates.push({
      venueId: `venue-uk-${row.osmRef}`,
      osmId: row.osmId,
      osmRef: row.osmRef,
      name: seed.name,
      lat: seed.lat,
      lng: seed.lng,
      host,
      siteUrl,
      // A menu page on another host is not this site's page, so it is not seeded.
      menuUrl: row.menuUrl && menuHost === host && isHarvestableOperatorUrl(row.menuUrl) ? row.menuUrl : null,
      binding,
    });
  }
  candidates.sort((a, b) => a.osmId.localeCompare(b.osmId));
  return { candidates, outcomes, refusedHosts };
}

/**
 * Join Exa candidates to the crawl's host list. A candidate on a host the list
 * already holds seeds that host's menu page; a candidate on a new host adds the
 * host with one pub and that pub's address binding.
 */
export function addExaSiteHosts(hostEntries, candidates, { publishedHosts = new Set(), sourceTableHosts = [] } = {}) {
  const known = new Map(hostEntries.map((entry) => [entry.host, entry]));
  const estates = sourceTableHosts.map((host) => host.replace(/^www\./, ""));
  const counts = { considered: 0, seededOnKnownHost: 0, hostsAdded: 0, sharedHost: 0, estateHost: 0, alreadyPublished: 0 };
  const byNewHost = new Map();
  for (const candidate of candidates ?? []) {
    counts.considered += 1;
    const entry = known.get(candidate.host);
    if (entry) {
      if (candidate.menuUrl) {
        entry.seedPages = entry.seedPages ?? [];
        if (!entry.seedPages.includes(candidate.menuUrl)) {
          entry.seedPages.push(candidate.menuUrl);
          counts.seededOnKnownHost += 1;
        }
      }
      continue;
    }
    if (estates.some((estate) => candidate.host === estate || candidate.host.endsWith(`.${estate}`))) {
      counts.estateHost += 1;
      continue;
    }
    if (publishedHosts.has(candidate.host)) {
      counts.alreadyPublished += 1;
      continue;
    }
    const list = byNewHost.get(candidate.host) ?? [];
    list.push(candidate);
    byNewHost.set(candidate.host, list);
  }
  for (const [host, list] of byNewHost) {
    // RULE 3. Several pubs' searches landing on one new host is not one pub's site.
    if (list.length !== 1) {
      counts.sharedHost += list.length;
      continue;
    }
    const [candidate] = list;
    const origin = new URL(candidate.siteUrl).origin;
    const seedPages = [];
    if (new URL(candidate.siteUrl).pathname.replace(/\/+$/, "") !== "") seedPages.push(candidate.siteUrl);
    if (candidate.menuUrl && !seedPages.includes(candidate.menuUrl)) seedPages.push(candidate.menuUrl);
    hostEntries.push({
      host,
      origin,
      exaSite: true,
      seedPages,
      pubs: [
        {
          venueId: candidate.venueId,
          osmId: candidate.osmId,
          name: candidate.name,
          postcode: candidate.binding.postcode,
          lat: candidate.lat,
          lng: candidate.lng,
          website: candidate.siteUrl,
          binding: candidate.binding,
        },
      ],
    });
    counts.hostsAdded += 1;
  }
  return counts;
}
