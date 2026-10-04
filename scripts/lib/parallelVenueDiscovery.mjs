import { isHarvestableOperatorUrl } from "../../lib/harvest/sourcePolicy.ts";
import { haversineMeters, namesLikelySamePub, normalizeVenueIdentityName } from "./venueCanonicalization.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const normalizedText = (value) => text(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const POSTCODE = /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;
const LISTING_HOSTS = ["camra.org.uk", "whatpub.com", "designmynight.com", "squaremeal.co.uk", "opentable.co.uk", "opentable.com", "visitbirmingham.com", "visitleeds.co.uk", "visitglasgow.com", "visitscotland.com", "visitmanchester.com", "visitliverpool.com", "visitbristol.co.uk"];

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

function sourceBelongsToVenue(url, website) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (LISTING_HOSTS.some((listing) => host === listing || host.endsWith(`.${listing}`))) return true;
  if (!allowedEvidenceUrl(website)) return false;
  return host === new URL(website).hostname.toLowerCase().replace(/^www\./, "");
}

export function inCity(lat, lng, city) {
  const [south, west, north, east] = city.bbox;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= south && lat <= north && lng >= west && lng <= east;
}

// Every address part before and around the postcode must be quoted, so a
// qualifier such as "Upstairs" cannot vouch for an invented street after it.
export function citationBindsIdentity({ name, address, evidence }, city) {
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

export function parseTaskVenues(result, city, observedAt) {
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
    else if (!citationBindsIdentity({ name, address, evidence }, city)) reason = "citation-does-not-bind-name-and-address";
    else if (/\b(?:permanently closed|closed permanently|ceased trading)\b/i.test(quotes)) reason = "closed-venue";
    else if (kind === "restaurant" ? !/\b(?:beers?|cocktails?|draught|lagers?|wine list|wines|spirits|alcoholic drinks)\b/i.test(quotes) : !/\b(?:pub|public house|bar|beers?|cocktails?|ales?|lagers?)\b/i.test(quotes)) reason = "missing-drinking-evidence";
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

export function sameVenue(a, b) {
  const aName = normalizeVenueIdentityName(a.name);
  const bName = normalizeVenueIdentityName(b.name);
  if (!aName || !bName || !namesLikelySamePub(aName, bName)) return false;
  const radius = a.coordinatePrecision === "postcode-centroid" || b.coordinatePrecision === "postcode-centroid" ? 350 : 150;
  const distance = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  const aPostcode = postcodeIn(a.address);
  const bPostcode = postcodeIn(b.address);
  if (aPostcode && bPostcode && aPostcode !== bPostcode && distance > 50) return false;
  return distance <= radius;
}

export function dedupeVenues(candidates, existing) {
  const accepted = [];
  const duplicates = [];
  for (const candidate of candidates) {
    const match = [...existing, ...accepted].find((venue) => sameVenue(candidate, venue));
    if (match) duplicates.push({ name: candidate.name, matchedName: match.name, matchedId: match.id ?? match.osmId ?? null });
    else accepted.push(candidate);
  }
  return { accepted, duplicates };
}

export function validateDiscoveryPack(pack, city) {
  if (pack?.city !== city.id || !Array.isArray(pack?.venues)) throw new Error(`Invalid Parallel venue pack for ${city.id}`);
  for (const row of pack.venues) {
    if (!text(row?.name) || !["pub", "bar", "restaurant"].includes(row.kind) || !inCity(row.lat, row.lng, city)
      || !postcodeIn(row.address) || !["source-coordinate", "postcode-centroid"].includes(row.coordinatePrecision)
      || !/^\d{4}-\d{2}-\d{2}T/.test(row.observedAt) || !Number.isFinite(Date.parse(row.observedAt)) || Date.parse(row.observedAt) > Date.now()
      || !Array.isArray(row.sourceUrls) || !row.sourceUrls.length || !row.sourceUrls.every(allowedEvidenceUrl)
      || !Array.isArray(row.evidence) || !row.evidence.length || !row.evidence.every((entry) => row.sourceUrls.includes(entry.url) && text(entry.excerpt))
      || !citationBindsIdentity(row, city)) {
      throw new Error(`Invalid Parallel venue evidence: ${text(row?.name) || "unnamed"}`);
    }
  }
  return pack;
}

// The city's own earlier discoveries are retained, never reported as
// duplicates of themselves; only other sources can make a candidate a duplicate.
export function assembleCityDiscoveries({ found, previous, existing, city }) {
  const kept = previous.filter((row) => {
    try { validateDiscoveryPack({ city: city.id, venues: [row] }, city); return true; }
    catch { return false; }
  });
  const withdrawn = previous.filter((row) => !kept.includes(row)).map((row) => ({ name: row.name, id: row.id ?? null }));
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
