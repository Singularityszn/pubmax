// Pure fold policy for the UK harvest overlay.
//
// Identity is OSM id, never the pub name. Lore folds only with a name+town
// match AND https citations, as HeritageFact source "web". Website and menu
// URLs must be https. Social observations are out of scope and fail the fold.
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

export type HarvestOverlayRow = {
  osmId: string;
  osmRef: string;
  website: string | null;
  menuUrl: string | null;
  matchedLore: HarvestMatchedLore | null;
  sources: string[];
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

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Harvest ingest bar: the value starts with https://. Serving still uses {@link isHttpsUrl}. */
export function isHttpsObservation(value: string): boolean {
  return value.trim().toLowerCase().startsWith("https://");
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
  const tokens = nameTokens(name);
  if (tokens.length === 0 || !tokens.every((token) => hay.includes(token))) {
    return "name-mismatch";
  }
  const place = typeof town === "string" ? town.trim() : "";
  if (!place) return "town-missing";
  if (!hay.includes(place.toLowerCase())) return "town-mismatch";
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
  return trimmed;
}

function parseLore(value: unknown, line?: number): HarvestMatchedLore | null {
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
  const matchedLore = parseLore(record.matchedLore, line);
  const sources = Array.isArray(record.sources)
    ? record.sources.filter((entry): entry is string => typeof entry === "string" && isHttpsUrl(entry))
    : [];
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
  };
}

export function parseOverlayJsonl(text: string): HarvestOverlayRow[] {
  const rows: HarvestOverlayRow[] = [];
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
    rows.push(parseOverlayRow(parsed, i + 1));
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
  if (!overlay) return venue;
  const website = keepHttps(venue.website) ?? keepHttps(overlay.website) ?? venue.website;
  const menuUrl = keepHttps(venue.menuUrl) ?? keepHttps(overlay.menuUrl) ?? venue.menuUrl;
  return {
    ...venue,
    ...(website !== undefined ? { website } : {}),
    ...(menuUrl !== undefined ? { menuUrl } : {}),
  };
}
