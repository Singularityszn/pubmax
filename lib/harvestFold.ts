// Pure fold policy for the UK harvest overlay.
//
// Identity is OSM id, never the pub name. Lore folds only with a name+town
// match AND https citations, as HeritageFact source "web". Website and menu
// URLs must be https. Social observations are out of scope and are excluded.
// Folded counts must reconcile with fold-stats.md — a mismatch is an error,
// not a warning.

export const HARVEST_LORE_SOURCE = "web" as const;

export type HarvestFoldErrorCode =
  | "MALFORMED_ROW"
  | "STATS_MISMATCH"
  | "SOCIAL_PRESENT";

export class HarvestFoldError extends Error {
  readonly code: HarvestFoldErrorCode;
  readonly line: number | undefined;

  constructor(code: HarvestFoldErrorCode, message: string, line?: number) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = "HarvestFoldError";
    this.code = code;
    this.line = line;
  }
}

export type HarvestMatchedLore = {
  text: string;
  citations: string[];
};

export type HarvestObservation = {
  kind: "website" | "history" | "social" | "menu" | "coverage";
  value: string;
  sourceUrl: string;
  fetchedAt: string;
};

export type HarvestObservationRecord = {
  osmId: string;
  name: string;
  town: string | null;
  observations: HarvestObservation[];
};

export type HarvestOverlayRow = {
  osmId: string;
  osmRef: string;
  website: string | null;
  menuUrl: string | null;
  matchedLore: HarvestMatchedLore | null;
  sources: string[];
  loreName?: string;
  loreTown?: string;
};

export type FoldCounts = {
  overlayRows: number;
  httpsWebsite: number;
  httpsMenuUrl: number;
  matchedLore: number;
  social: number;
};

const NAME_STOP = new Set(["the", "a", "an", "and", "of"]);
const SOCIAL_KEYS = new Set(["social", "socials", "socialHandle", "socialHandles"]);
const SOCIAL_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "uk.linkedin.com",
  "threads.net",
  "letterboxd.com",
  "spotify.com",
  "open.spotify.com",
  "snapchat.com",
  "strava.com",
  "mobile.twitter.com",
]);
const LOCALITY_NAME_PREFIXES = new Set([
  "new",
  "old",
  "north",
  "south",
  "east",
  "west",
  "greater",
  "upper",
  "lower",
  "central",
]);
const UK_LOCALITY_QUALIFIER_RE =
  /^\s*(?:(?:(?:,|\(|:|;|-|\/|\.|!|\?)\s*)|(?:(?:in|of|from|near|at|within)\s+))(?:the\s+)?(?:uk|u\.k\.?|united kingdom|great britain|britain|england|scotland|wales|northern ireland|yorkshire|north yorkshire|south yorkshire|west yorkshire|east yorkshire|east riding|london)(?:$|[^a-z0-9])/i;
const LOCALITY_QUALIFIER_RE =
  /^\s*(?:(?:,|\(|:|;|-|\/|\.|!)\s*|(?:in|of|from|near|at|within)\s+)[a-z]/i;
const UK_LOCALITY_DESTINATION_RE =
  /^(?:the\s+)?(?:uk|u\.k\.?|united kingdom|great britain|britain|england|scotland|wales|northern ireland|yorkshire|north yorkshire|south yorkshire|west yorkshire|east yorkshire|east riding|london|somerset|kent|surrey|sussex|essex|middlesex|hertfordshire|berkshire|buckinghamshire|cambridgeshire|derbyshire|devon|dorset|durham|gloucestershire|hampshire|herefordshire|isle of wight|lancashire|leicestershire|lincolnshire|norfolk|northamptonshire|northumberland|nottinghamshire|shropshire|staffordshire|suffolk|warwickshire|wiltshire|worcestershire|cheshire|cumbria|cornwall)(?:$|[^a-z0-9])/i;
const LOCALITY_CONTINUATION_WORDS = new Set([
  "and",
  "also",
  "an",
  "are",
  "became",
  "been",
  "built",
  "called",
  "can",
  "closed",
  "contains",
  "dates",
  "dated",
  "features",
  "has",
  "hosts",
  "includes",
  "is",
  "it",
  "lies",
  "located",
  "now",
  "offers",
  "once",
  "opened",
  "remains",
  "served",
  "sits",
  "stands",
  "stood",
  "the",
  "this",
  "was",
  "were",
  "where",
  "which",
  "with",
  "would",
]);

export function isHttpsUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /[\s,]/.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Harvest observations may contain several comma-separated https URLs. */
export function isHttpsObservation(value: string): boolean {
  const parts = value.split(",").map((part) => part.trim());
  return parts.length > 0 && parts.every((part) => part.length > 0 && isHttpsUrl(part));
}

function httpsObservationParts(value: string): string[] {
  return value.split(",").map((part) => part.trim());
}

function isSocialUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return [...SOCIAL_HOSTS].some(
      (socialHost) => host === socialHost || host.endsWith(`.${socialHost}`),
    );
  } catch {
    return false;
  }
}

function containsWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(haystack);
}

function containsExactLocality(haystack: string, locality: string): boolean {
  const escaped = locality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const localityRe = new RegExp(
    `(?:^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`,
    "gi",
  );
  for (const match of haystack.matchAll(localityRe)) {
    const after = haystack.slice((match.index ?? 0) + match[0].length);
    const hasKnownUkQualifier = UK_LOCALITY_QUALIFIER_RE.test(after);
    const nextWord = after.match(/^\s*(?:[.!?]\s+)?([a-z][a-z'-]*)\b/i)?.[1]?.toLowerCase();
    const sentenceContinuation =
      /^[\s]*[.!?]\s+/.test(after) &&
      Boolean(nextWord && LOCALITY_CONTINUATION_WORDS.has(nextWord));
    const laterLocality = after.match(
      /\b(?:is|was|were|lies|located|situated|based)\s+(?:in|near|from|at|within)\s+([a-z][a-z' -]*)/i,
    );
    const hasUnknownLaterLocality = Boolean(
      laterLocality && !UK_LOCALITY_DESTINATION_RE.test(laterLocality[1].trim()),
    );
    if (
      LOCALITY_QUALIFIER_RE.test(after) &&
      !hasKnownUkQualifier &&
      !sentenceContinuation
    ) {
      continue;
    }
    if (hasUnknownLaterLocality) continue;
    if (!hasKnownUkQualifier && nextWord && !LOCALITY_CONTINUATION_WORDS.has(nextWord)) continue;
    const before = haystack.slice(0, match.index ?? 0).match(/[a-z0-9]+\s*$/i)?.[0]
      ?.trim()
      .toLowerCase();
    if (!before || !LOCALITY_NAME_PREFIXES.has(before)) return true;
  }
  return false;
}

function containsVenueName(haystack: string, name: string): boolean {
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  const phrase = tokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^a-z0-9]+");
  return new RegExp(`(?:^|[^a-z0-9])${phrase}(?:$|[^a-z0-9])`, "i").test(haystack);
}

function containsVenueLocalityRelation(
  sentence: string,
  name: string,
  locality: string,
): boolean {
  const nameTokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const localityTokens = locality
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (nameTokens.length === 0 || localityTokens.length === 0) return false;
  const namePattern = nameTokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^a-z0-9]+");
  const localityPattern = localityTokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^a-z0-9]+");
  return new RegExp(
    `(?:^|[^a-z0-9])${namePattern}(?=$|[^a-z0-9])[^.!?]{0,120}(?:\\b(?:in|of|from|near|at|within)\\b|[,;:/()\\-–])\\s*(?:the\\s+)?${localityPattern}(?=$|[^a-z0-9])`,
    "i",
  ).test(sentence);
}

export function nameTokens(name: string): string[] {
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !NAME_STOP.has(token));
  return tokens.length > 0 ? tokens : [name.toLowerCase().trim()].filter(Boolean);
}

export type LoreGateResult = "pass" | "town-missing" | "town-mismatch" | "name-mismatch";

export function loreNameTownGate(
  text: string,
  name: string,
  town: string | null,
): LoreGateResult {
  const hay = text.toLowerCase();
  if (!containsVenueName(hay, name)) {
    return "name-mismatch";
  }
  const place = typeof town === "string" ? town.trim() : "";
  if (!place) return "town-missing";
  const locality = place.toLowerCase();
  const relatedSentence = hay
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .some(
      (sentence) =>
        containsVenueLocalityRelation(sentence, name, locality) &&
        containsExactLocality(sentence, locality),
    );
  if (!relatedSentence) return "town-mismatch";
  return "pass";
}

export function loreMayFold(input: {
  text: string;
  name: string;
  town: string | null;
  citations: unknown;
}): boolean {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return false;
  if (!httpsCitations(input.citations).length) return false;
  return loreNameTownGate(text, input.name, input.town) === "pass";
}

function httpsCitations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return [];
    const trimmed = entry.trim();
    if (!isHttpsUrl(trimmed)) return [];
    if (isSocialUrl(trimmed)) return [];
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function canonicalOsmId(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const typed = raw.match(/^(node|way|relation)\/(\d+)$/i);
  if (typed) return `${typed[1].toLowerCase()}/${typed[2]}`;
  const venue = raw.match(/^(?:venue-uk-|venue-osm-)?([nwr])(\d+)$/i);
  if (venue) {
    const kind = venue[1].toLowerCase();
    const id = venue[2];
    if (kind === "n") return `node/${id}`;
    if (kind === "w") return `way/${id}`;
    return `relation/${id}`;
  }
  return null;
}

export function osmRefFromOsmId(osmId: string): string {
  const canonical = canonicalOsmId(osmId);
  if (!canonical) {
    throw new HarvestFoldError("MALFORMED_ROW", `Unrecognised OSM id ${osmId}`);
  }
  const [kind, id] = canonical.split("/");
  if (kind === "node") return `n${id}`;
  if (kind === "way") return `w${id}`;
  return `r${id}`;
}

export function overlayLookupKeys(osmId: string, extraVenueIds: readonly string[] = []): string[] {
  const canonical = canonicalOsmId(osmId);
  if (!canonical) return [];
  const ref = osmRefFromOsmId(canonical);
  const keys = [canonical, ref, `venue-uk-${ref}`, `venue-osm-${ref}`];
  for (const extra of extraVenueIds) {
    if (typeof extra === "string" && extra.trim() && !keys.includes(extra)) {
      keys.push(extra.trim());
    }
  }
  return keys;
}

function fail(code: HarvestFoldErrorCode, message: string, line?: number): never {
  throw new HarvestFoldError(code, message, line);
}

function httpsOrNull(value: unknown, field: string, line?: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    fail("MALFORMED_ROW", `${field} must be an https URL or null`, line);
  }
  const trimmed = value.trim();
  if (!trimmed) fail("MALFORMED_ROW", `${field} must be an https URL or null`, line);
  if (!isHttpsObservation(trimmed)) {
    fail("MALFORMED_ROW", `${field} must be https`, line);
  }
  if (httpsObservationParts(trimmed).some((part) => isSocialUrl(part))) {
    fail("SOCIAL_PRESENT", `${field} points to a social host`, line);
  }
  return trimmed;
}

function parseLore(
  value: unknown,
  name: unknown,
  town: unknown,
  line?: number,
): HarvestMatchedLore | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MALFORMED_ROW", "matchedLore must be an object or null", line);
  }
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) fail("MALFORMED_ROW", "matchedLore.text is required", line);
  const citations = httpsCitations(record.citations);
  if (citations.length === 0) {
    fail("MALFORMED_ROW", "matchedLore requires at least one https citation", line);
  }
  const matchName = typeof name === "string" ? name.trim() : "";
  const matchTown = typeof town === "string" ? town.trim() : "";
  if (
    !loreMayFold({
      text,
      name: matchName,
      town: matchTown || null,
      citations,
    })
  ) {
    fail("MALFORMED_ROW", "matchedLore requires a confirmed name and town match", line);
  }
  return { text, citations };
}

function assertNoSocial(record: Record<string, unknown>, line?: number): void {
  for (const key of SOCIAL_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === "") continue;
    fail("SOCIAL_PRESENT", `social observations are out of scope (${key})`, line);
  }
}

export function parseOverlayRow(raw: unknown, line?: number): HarvestOverlayRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("MALFORMED_ROW", "overlay row must be an object", line);
  }
  const record = raw as Record<string, unknown>;
  assertNoSocial(record, line);
  if (typeof record.osmId !== "string" || !record.osmId.trim()) {
    fail("MALFORMED_ROW", "osmId is required", line);
  }
  const osmId = canonicalOsmId(record.osmId);
  if (!osmId) fail("MALFORMED_ROW", `Unrecognised OSM id ${record.osmId}`, line);
  const website = httpsOrNull(record.website, "website", line);
  const menuUrl = httpsOrNull(record.menuUrl, "menuUrl", line);
  const matchedLore = parseLore(record.matchedLore, record.name, record.town, line);
  const loreName = typeof record.name === "string" ? record.name.trim() : "";
  const loreTown = typeof record.town === "string" ? record.town.trim() : "";
  if (!Array.isArray(record.sources)) {
    fail("MALFORMED_ROW", "sources must be an array of https URLs", line);
  }
  const sources: string[] = [];
  for (const entry of record.sources) {
    if (typeof entry !== "string" || !isHttpsUrl(entry.trim())) {
      fail("MALFORMED_ROW", "sources must contain only https URLs", line);
    }
    const trimmed = entry.trim();
    if (isSocialUrl(trimmed)) {
      fail("SOCIAL_PRESENT", "sources cannot contain social hosts", line);
    }
    if (!sources.includes(trimmed)) sources.push(trimmed);
  }
  if (!website && !menuUrl && !matchedLore) {
    fail("MALFORMED_ROW", "row has no usable https website, menu, or cited lore", line);
  }
  return {
    osmId,
    osmRef: osmRefFromOsmId(osmId),
    website,
    menuUrl,
    matchedLore,
    sources,
    ...(matchedLore
      ? {
          loreName,
          loreTown,
        }
      : {}),
  };
}

export function parseOverlayJsonl(text: string): HarvestOverlayRow[] {
  const rows: HarvestOverlayRow[] = [];
  const seenOsmIds = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail("MALFORMED_ROW", "JSONL line is not JSON", i + 1);
    }
    const row = parseOverlayRow(parsed, i + 1);
    if (seenOsmIds.has(row.osmId)) {
      fail("MALFORMED_ROW", `duplicate OSM id ${row.osmId}`, i + 1);
    }
    seenOsmIds.add(row.osmId);
    rows.push(row);
  }
  return rows;
}

function observationValue(
  record: Record<string, unknown>,
  key: string,
  line: number,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    fail("MALFORMED_ROW", `observation.${key} is required`, line);
  }
  return value.trim();
}

/** Convert completed enriched harvest records into one OSM-keyed overlay row. */
export function overlayRowsFromHarvestRecords(rawRecords: unknown[]): HarvestOverlayRow[] {
  if (!Array.isArray(rawRecords)) {
    fail("MALFORMED_ROW", "harvest records must be an array");
  }

  const grouped = new Map<
    string,
    {
      name: string;
      town: string | null;
      websites: string[];
      menus: string[];
      lore: HarvestMatchedLore | null;
      sources: string[];
    }
  >();

  rawRecords.forEach((raw, index) => {
    const line = index + 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      fail("MALFORMED_ROW", "harvest record must be an object", line);
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.osmId !== "string" || !record.osmId.trim()) {
      fail("MALFORMED_ROW", "harvest record osmId is required", line);
    }
    if (typeof record.name !== "string" || !record.name.trim()) {
      fail("MALFORMED_ROW", "harvest record name is required", line);
    }
    if (record.town !== null && record.town !== undefined && typeof record.town !== "string") {
      fail("MALFORMED_ROW", "harvest record town must be a string or null", line);
    }
    if (!Array.isArray(record.observations)) {
      fail("MALFORMED_ROW", "harvest record observations must be an array", line);
    }

    const osmId = canonicalOsmId(record.osmId);
    if (!osmId) fail("MALFORMED_ROW", `Unrecognised OSM id ${record.osmId}`, line);
    const name = record.name.trim();
    const town = typeof record.town === "string" && record.town.trim() ? record.town.trim() : null;
    const existing = grouped.get(osmId);
    const current =
      existing ?? { name, town, websites: [], menus: [], lore: null, sources: [] };
    if (existing && (existing.name !== name || existing.town !== town)) {
      fail("MALFORMED_ROW", `conflicting venue metadata for ${osmId}`, line);
    }

    for (const rawObservation of record.observations) {
      if (!rawObservation || typeof rawObservation !== "object" || Array.isArray(rawObservation)) {
        fail("MALFORMED_ROW", "harvest observation must be an object", line);
      }
      const observation = rawObservation as Record<string, unknown>;
      const kind = observation.kind;
      if (!["website", "history", "social", "menu", "coverage"].includes(String(kind))) {
        fail("MALFORMED_ROW", "harvest observation kind is invalid", line);
      }
      const value = observationValue(observation, "value", line);
      const sourceUrl = observationValue(observation, "sourceUrl", line);
      observationValue(observation, "fetchedAt", line);
      if (isSocialUrl(sourceUrl)) {
        if (kind === "social") continue;
        fail("SOCIAL_PRESENT", "social-host harvest observations are out of scope", line);
      }
      if (!isHttpsUrl(sourceUrl)) {
        fail("MALFORMED_ROW", "harvest observation sourceUrl must be https", line);
      }
      if (kind === "social") continue;
      if (kind === "website") {
        if (httpsObservationParts(value).some((part) => isSocialUrl(part))) {
          fail("SOCIAL_PRESENT", "social-host harvest observations are out of scope", line);
        }
        if (!isHttpsObservation(value)) fail("MALFORMED_ROW", "harvest website must be https", line);
        if (!current.websites.includes(value)) current.websites.push(value);
        if (!current.sources.includes(sourceUrl)) current.sources.push(sourceUrl);
      } else if (kind === "menu") {
        if (httpsObservationParts(value).some((part) => isSocialUrl(part))) {
          fail("SOCIAL_PRESENT", "social-host harvest observations are out of scope", line);
        }
        if (!isHttpsObservation(value)) fail("MALFORMED_ROW", "harvest menu must be https", line);
        if (!current.menus.includes(value)) current.menus.push(value);
        if (!current.sources.includes(sourceUrl)) current.sources.push(sourceUrl);
      } else if (kind === "history") {
        if (!current.lore && loreMayFold({ text: value, name, town, citations: [sourceUrl] })) {
          current.lore = { text: value, citations: [sourceUrl] };
          if (!current.sources.includes(sourceUrl)) current.sources.push(sourceUrl);
        }
      }
    }
    grouped.set(osmId, current);
  });

  const rows: HarvestOverlayRow[] = [];
  for (const [osmId, value] of grouped) {
    if (value.websites.length === 0 && value.menus.length === 0 && !value.lore) continue;
    rows.push(
      parseOverlayRow({
        osmId,
        name: value.name,
        town: value.town,
        website: value.websites.length > 0 ? value.websites.join(", ") : null,
        menuUrl: value.menus.length > 0 ? value.menus.join(", ") : null,
        matchedLore: value.lore,
        sources: value.sources,
      }),
    );
  }
  return rows;
}

export function summariseOverlay(rows: readonly HarvestOverlayRow[]): FoldCounts {
  let httpsWebsite = 0;
  let httpsMenuUrl = 0;
  let matchedLore = 0;
  for (const row of rows) {
    if (row.website) httpsWebsite += 1;
    if (row.menuUrl) httpsMenuUrl += 1;
    if (row.matchedLore) matchedLore += 1;
  }
  return {
    overlayRows: rows.length,
    httpsWebsite,
    httpsMenuUrl,
    matchedLore,
    social: 0,
  };
}

const STATS_ROWS: Array<{ label: string; key: keyof FoldCounts }> = [
  { label: "Overlay row (any usable field)", key: "overlayRows" },
  { label: "https website", key: "httpsWebsite" },
  { label: "https menu URL", key: "httpsMenuUrl" },
  { label: "Matched lore", key: "matchedLore" },
  { label: "Social", key: "social" },
];

export function parseFoldStatsMarkdown(markdown: string): FoldCounts {
  const counts: Partial<FoldCounts> = {};
  for (const { label, key } of STATS_ROWS) {
    const match = markdown.match(
      new RegExp(`\\|\\s*${label.replace(/[()]/g, "\\$&")}\\s*\\|\\s*(\\d+)\\s*\\|`, "i"),
    );
    if (!match) {
      fail("STATS_MISMATCH", `fold-stats.md is missing the ${label} row`);
    }
    counts[key] = Number(match[1]);
  }
  return counts as FoldCounts;
}

export function reconcileFoldStats(actual: FoldCounts, expected: FoldCounts): void {
  const diffs: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof FoldCounts>) {
    if (actual[key] !== expected[key]) {
      diffs.push(`${key}: folded ${actual[key]}, stats ${expected[key]}`);
    }
  }
  if (diffs.length > 0) {
    fail("STATS_MISMATCH", `fold counts do not match fold-stats.md (${diffs.join("; ")})`);
  }
}

export function heritageFactFromOverlay(row: HarvestOverlayRow): {
  source: typeof HARVEST_LORE_SOURCE;
  fact: string;
  sourceRef: string;
} | null {
  if (!row.matchedLore) return null;
  if (
    !loreMayFold({
      text: row.matchedLore.text,
      name: row.loreName ?? "",
      town: row.loreTown ?? null,
      citations: row.matchedLore.citations,
    })
  ) {
    return null;
  }
  const sourceRef = row.matchedLore.citations[0];
  if (!sourceRef || !isHttpsUrl(sourceRef)) return null;
  return {
    source: HARVEST_LORE_SOURCE,
    fact: row.matchedLore.text,
    sourceRef,
  };
}

export type PublicHarvestOverlay = {
  website: string | null;
  menuUrl: string | null;
  lore: {
    fact: string;
    source: typeof HARVEST_LORE_SOURCE;
    sourceRef: string;
  } | null;
};

export function toPublicOverlay(row: HarvestOverlayRow): PublicHarvestOverlay {
  return {
    website: row.website && isHttpsUrl(row.website) ? row.website : null,
    menuUrl: row.menuUrl && isHttpsUrl(row.menuUrl) ? row.menuUrl : null,
    lore: heritageFactFromOverlay(row),
  };
}

export function parsePublicOverlay(raw: unknown): PublicHarvestOverlay | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const website =
    typeof record.website === "string" && isHttpsUrl(record.website) ? record.website : null;
  const menuUrl =
    typeof record.menuUrl === "string" && isHttpsUrl(record.menuUrl) ? record.menuUrl : null;
  let lore: PublicHarvestOverlay["lore"] = null;
  if (record.lore && typeof record.lore === "object" && !Array.isArray(record.lore)) {
    const entry = record.lore as Record<string, unknown>;
    const fact = typeof entry.fact === "string" ? entry.fact.trim() : "";
    const sourceRef = typeof entry.sourceRef === "string" ? entry.sourceRef.trim() : "";
    if (fact && entry.source === HARVEST_LORE_SOURCE && isHttpsUrl(sourceRef)) {
      lore = { fact, source: HARVEST_LORE_SOURCE, sourceRef };
    }
  }
  return { website, menuUrl, lore };
}

function keepHttps(value: string | undefined | null): string | undefined {
  return typeof value === "string" && isHttpsUrl(value) ? value : undefined;
}

/** Fill https website/menu gaps from an overlay. Never copies lore. Never overwrites an existing https URL. */
export function applyHarvestWebsiteMenu<T extends { website?: string; menuUrl?: string }>(
  venue: T,
  overlay: HarvestOverlayRow | PublicHarvestOverlay | null,
): T {
  const website = keepHttps(venue.website) ?? keepHttps(overlay?.website);
  const menuUrl = keepHttps(venue.menuUrl) ?? keepHttps(overlay?.menuUrl);
  const next = { ...venue };
  delete next.website;
  delete next.menuUrl;
  if (website) next.website = website;
  if (menuUrl) next.menuUrl = menuUrl;
  return next;
}
