/** Curated source-to-venue joins for the London soft-drinks harvest. */

const ENRICHMENT_SOURCE_BY_CHAIN = Object.freeze({
  youngs: "youngs.co.uk",
  "greene-king": "greene-king.co.uk",
  nicholsons: "nicholsonspubs.co.uk",
});

function normaliseUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function normaliseHost(value) {
  return value.toLowerCase().replace(/^www\./, "");
}

/**
 * Resolve exact publisher records to canonical dataset venues. Page headings
 * are never used as identity evidence. Chains without this curated join yield
 * no targets until their directory/sitemap has a reviewed venue binding.
 */
export function buildCuratedSoftDrinkTargets({ chain, enrichment, indexes, inGreaterLondon }) {
  const expectedPublisher = ENRICHMENT_SOURCE_BY_CHAIN[chain];
  if (!expectedPublisher || typeof inGreaterLondon !== "function") return [];
  const targets = [];

  for (const [venueId, record] of Object.entries(enrichment?.venues ?? {})) {
    if (record?.source !== expectedPublisher || typeof record?.menuUrl !== "string") continue;
    const venueKey = indexes?.idToKey?.get(venueId);
    const row = venueKey ? indexes.rowsByKey.get(venueKey) : null;
    if (
      !row ||
      !Number.isFinite(row.latitude) ||
      !Number.isFinite(row.longitude) ||
      !inGreaterLondon({ lat: row.latitude, lng: row.longitude })
    ) {
      continue;
    }

    let url;
    try {
      const base = new URL(record.menuUrl);
      if (base.protocol !== "https:") continue;
      url = base.href;
    } catch {
      continue;
    }
    const parsed = new URL(url);
    targets.push({
      url,
      pubName: row.pub_name,
      venueId,
      venueKey,
      locality: row.primary_borough ?? null,
      host: normaliseHost(parsed.hostname),
    });
  }

  const identityCounts = new Map();
  for (const target of targets) {
    const key = chain === "youngs" ? target.host : target.url;
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  return targets.filter((target) => {
    const key = chain === "youngs" ? target.host : target.url;
    return identityCounts.get(key) === 1;
  });
}

/** A caller URL file may select targets, never add or rename one. */
export function selectCuratedSoftDrinkTargets(targets, { urlsFileText, limit = 200 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("soft-drinks page limit must be a positive integer");
  }
  const byUrl = new Map(targets.map((target) => [normaliseUrl(target.url), target]));
  if (byUrl.has(null)) throw new Error("curated target contains an invalid URL");
  if (urlsFileText === undefined) return targets.slice(0, limit);

  const selected = [];
  const seen = new Set();
  for (const [index, rawLine] of String(urlsFileText).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const url = normaliseUrl(line);
    if (!url) throw new Error(`invalid --urls-file URL on line ${index + 1}`);
    const target = byUrl.get(url);
    if (!target) throw new Error(`--urls-file URL has no exact curated London venue binding: ${url}`);
    if (seen.has(url)) continue;
    seen.add(url);
    selected.push(target);
  }
  return selected.slice(0, limit);
}
