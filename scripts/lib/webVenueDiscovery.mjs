import { allowedEvidenceUrl, isListingUrl, postcodeIn } from "./parallelVenueDiscovery.mjs";
import { normalizeVenueIdentityName } from "./venueCanonicalization.mjs";

const POSTCODES = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi;

// Link targets and image sources are page furniture, not words the page states.
export function pageText(markdown) {
  return String(markdown ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\]\([^)]*\)/g, "]");
}

const GENERIC_NAME_WORDS = new Set(["the", "and", "bar", "bars", "pub", "inn", "restaurant", "kitchen", "club", "lounge", "tavern", "hotel", "cafe", "grill", "wine", "cocktail", "cocktails", "brewery", "taproom"]);

// The extractor reads the page it would vouch for, so its own-site claim is
// circular. A page is a venue's own site only when its host carries a
// distinctive word of the venue's name; otherwise only a listing can vouch.
export function ownSiteFor(name, landedUrl) {
  const host = new URL(landedUrl).hostname.toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = normalizeVenueIdentityName(name).split(/\s+/).map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word));
  return words.some((word) => host.includes(word)) ? `${new URL(landedUrl).origin}/` : null;
}

// A scraped page in the Task result shape, so parseTaskVenues judges it with
// the same rules: every excerpt must appear verbatim in the page it cites.
export function webPageResult({ landedUrl, markdown, json }) {
  const venues = (Array.isArray(json?.venues) ? json.venues : []).map((row) => ({
    ...row, website: ownSiteFor(row?.name, landedUrl), evidence: (Array.isArray(row?.evidence) ? row.evidence : []).map((entry) => ({ url: landedUrl, excerpt: entry?.excerpt })),
  }));
  const text = pageText(markdown);
  return { output: { type: "json", content: { venues }, basis: venues.map((_, index) => ({
    field: `venues.${index}`, confidence: "high", citations: [{ url: landedUrl, excerpts: [text] }],
  })) } };
}

// Pages worth a scrape: permitted, stating a postcode in this district, and
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
