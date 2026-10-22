import {
  fetchHarvestResponse,
  fetchHarvestedPage,
  HarvestOutboundRefusal,
} from "../../lib/harvest/robots.ts";

export function permittedSitemapUrls(xml, sourcePredicate) {
  if (typeof sourcePredicate !== "function") {
    throw new TypeError("sourcePredicate is required for sitemap URL filtering");
  }
  return [...String(xml ?? "").matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1].trim())
    .filter(sourcePredicate);
}

/**
 * Fetch one caller-owned source page through the shared redirect and DNS
 * transport while applying the caller's narrower publisher binding before
 * every actual page request. A redirect response is discarded by
 * fetchHarvestedPage; a foreign landing therefore never reaches fetchImpl or
 * allocates its page body.
 */
export async function fetchSourceBoundPage(
  input,
  robots,
  {
    sourcePredicate,
    init = {},
    fetchImpl,
    urlPolicy = "operator",
  } = {},
) {
  if (typeof sourcePredicate !== "function") {
    throw new TypeError("sourcePredicate is required for a source-bound harvest request");
  }
  const initialUrl = input instanceof URL ? input.href : String(input);
  if (!sourcePredicate(initialUrl)) {
    throw new HarvestOutboundRefusal(`Source-specific policy refused ${initialUrl}.`);
  }

  const guardedFetch = async (url, requestInit) => {
    const currentUrl = url instanceof URL ? url.href : String(url);
    if (!sourcePredicate(currentUrl)) {
      throw new HarvestOutboundRefusal(`Source-specific policy refused ${currentUrl}.`);
    }
    if (fetchImpl) return fetchImpl(url, requestInit);
    return fetchHarvestResponse(url, requestInit, { urlPolicy });
  };

  return fetchHarvestedPage(input, robots, init, {
    fetchImpl: guardedFetch,
    urlPolicy,
  });
}
