// Which chain owns an OSM pub, decided from its declared website or its
// operator, brewery and name tags.
//
// PLAIN NODE ONLY. This module imports nothing outside node built-ins, because
// `build_uk_base_shards.mjs` reaches it through `londonOsmPromotion.mjs` and
// runs under plain `node`, where the extensionless TypeScript imports behind
// `tavilyPubEnrichment.mjs` do not resolve.
const CHAIN_DOMAINS = [
  {
    chain: "wetherspoons",
    harvester: "scripts/fetch_wetherspoons_pubs.mjs",
    domains: ["jdwetherspoon.com"],
    operator: /\b(?:j\s*d\s*wetherspoon|wetherspoons?)\b/i,
  },
  {
    chain: "greene-king",
    harvester: "scripts/firecrawl_greene_king_prices.mjs",
    domains: ["greeneking.co.uk"],
    operator: /\bgreene king\b/i,
  },
  {
    chain: "mitchells-and-butlers",
    harvester: "scripts/firecrawl_mbplc_prices.mjs",
    domains: [
      "allbarone.co.uk",
      "browns-restaurants.co.uk",
      "emberinns.co.uk",
      "harvester.co.uk",
      "mbplc.com",
      "millerandcarter.co.uk",
      "nicholsonspubs.co.uk",
      "oaksmiths.co.uk",
      "sizzlingpubs.co.uk",
      "stonehouserestaurants.co.uk",
      "vintageinn.co.uk",
    ],
    operator: /\b(?:mitchells?\s*(?:&|and)\s*butlers|m&b)\b/i,
  },
];

export function hostnameOf(value) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** True when the host belongs to a chain that its own harvester reads. */
export function isChainHost(host) {
  return CHAIN_DOMAINS.some((chain) => chain.domains.some((domain) => hostMatches(host, domain)));
}

export function classifyChainPub(pub) {
  const websiteHost = hostnameOf(pub?.website);
  const ownership = `${pub?.operator ?? ""} ${pub?.brewery ?? ""} ${pub?.name ?? ""}`;
  for (const definition of CHAIN_DOMAINS) {
    if (
      (websiteHost && definition.domains.some((domain) => hostMatches(websiteHost, domain))) ||
      definition.operator.test(ownership)
    ) {
      return { chain: definition.chain, harvester: definition.harvester };
    }
  }
  return null;
}
