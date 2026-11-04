// A pub's OWN website as a crawl input, shared by the document and rendered lanes.
// Kept beside run.mjs and render.mjs so both lanes ask one rule, and the rule is
// testable without starting a crawl.

import { isHarvestableOperatorUrl } from "../../../lib/harvest/sourcePolicy.ts";
import { isLikelyMenuUrl } from "../../../lib/harvest/ukPriceCrawl.ts";

/**
 * A social or listing page is not a pub's own site: it is a third party with its
 * own permission question this crawl has not asked.
 */
export const THIRD_PARTY_SITE_HOSTS =
  /(facebook|instagram|twitter|x\.com|tripadvisor|yelp|google|linktr\.ee|wixsite|whatpub)/i;

/** How many of a pub site's own menu links the rendered lane opens after its home page. */
export const PUB_SITE_MENU_PAGES = 3;

function ukBaseVenueId(osmId) {
  if (typeof osmId !== "string") return null;
  const match = /^(node|way|relation)\/(\d+)$/.exec(osmId.trim());
  return match ? `venue-uk-${match[1][0]}${match[2]}` : null;
}

/**
 * The stated website of one snapshot pub, normalised, when it is a pub's own site
 * the source table permits; otherwise null.
 */
export function permittedPubSite(website) {
  if (typeof website !== "string" || website.trim().length === 0) return null;
  const url = website.includes("//") ? website.trim() : `https://${website.trim()}`;
  if (!isHarvestableOperatorUrl(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (THIRD_PARTY_SITE_HOSTS.test(host)) return null;
  return { url, host, origin: parsed.origin };
}

/**
 * One rendered target per pub whose own site serves ONLY that pub.
 *
 * A host the snapshot names for two or more pubs is an estate, and an estate's
 * home page price belongs to no one pub, so it is left to the document lane's
 * attribution rule rather than rendered here. `only` names hosts, and a pub site
 * outside it is not a target.
 */
export function singlePubSiteTargets(pubs, { only = null } = {}) {
  const byHost = new Map();
  for (const pub of pubs) {
    const site = permittedPubSite(pub?.website);
    if (!site) continue;
    const held = byHost.get(site.host) ?? { site, pubs: [] };
    held.pubs.push(pub);
    byHost.set(site.host, held);
  }
  const targets = [];
  for (const [host, { site, pubs: onHost }] of byHost) {
    if (onHost.length !== 1) continue;
    if (only && !only.some((name) => host === name || host.endsWith(`.${name}`))) continue;
    const pub = onHost[0];
    const venueId = ukBaseVenueId(pub.osmId);
    if (!venueId) continue;
    targets.push({
      venueId,
      osmId: pub.osmId ?? null,
      name: pub.name ?? null,
      postcode: pub.postcode ?? null,
      lat: pub.lat ?? null,
      lng: pub.lng ?? null,
      // What a branch URL could name this pub by (pageNamesAnotherBranch).
      locality: pub.locality ?? null,
      address: pub.address ?? null,
      host,
      homeUrl: site.url,
      origin: site.origin,
    });
  }
  return targets;
}

/**
 * The links a rendered home page states that look like its own drinks list,
 * deduplicated in page order and capped. The same link test the document lane
 * applies to served HTML decides, and the source table is asked about each.
 */
export function renderedMenuLinks(links, homeUrl, max = PUB_SITE_MENU_PAGES) {
  let origin;
  let home;
  try {
    origin = new URL(homeUrl).origin;
    home = new URL(homeUrl).href;
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set([home]);
  for (const raw of Array.isArray(links) ? links : []) {
    const href = typeof raw === "string" ? raw : raw?.href ?? raw?.url;
    if (typeof href !== "string" || !isLikelyMenuUrl(href, origin)) continue;
    let resolved;
    try {
      const url = new URL(href, origin);
      url.hash = "";
      resolved = url.href;
    } catch {
      continue;
    }
    if (seen.has(resolved) || !isHarvestableOperatorUrl(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
    if (out.length >= max) break;
  }
  return out;
}
