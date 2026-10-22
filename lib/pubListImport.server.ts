import "server-only";

import { z } from "zod";

import { getCity } from "@/lib/cities";
import { isHarvestableOperatorUrl, normalizeHarvestHostname } from "@/lib/harvest/sourcePolicy";
import { getUkNationalPubCatalog } from "@/lib/ukNationalPubSearch.server";
import { venueAreaLabel } from "@/lib/venueDisplay";
import { readCityVenueIndex } from "@/lib/venueIndex";
import { postcodeOutwardFromText } from "@/lib/venuePermalinkSlug";
import { isVerifiedClosedCuratedVenue } from "@/lib/verifiedClosedPubs";

type ImportSource = {
  url: string;
  platform: "tiktok" | "instagram" | "other";
  handle: string | null;
};

type ImportVenue = {
  id: string;
  name: string;
  area: string;
  areaHints?: readonly string[];
  postcodeDistrict?: string;
  closed?: boolean;
};

type ImportCatalog = {
  curated: readonly ImportVenue[];
  national: readonly ImportVenue[];
};

type ImportCandidate = Pick<ImportVenue, "id" | "name" | "area" | "postcodeDistrict"> & {
  layer: "curated" | "national";
  price?: null;
  closed?: true;
};

type ExtractedLine = { rawLine: string; name: string; areaHint: string };

type ImportItem = ExtractedLine & (
  | { state: "matched" | "closed"; venue: ImportCandidate }
  | { state: "ambiguous"; candidates: ImportCandidate[]; candidateCount: number }
  | { state: "unmatched" }
);

async function loadCatalog(): Promise<ImportCatalog> {
  const curated = await readCityVenueIndex(getCity("london"));
  const national = getUkNationalPubCatalog();
  if (!curated?.size || national.status !== "ready") {
    throw new Error("The pub catalogue is unavailable. Try again.");
  }
  return {
    curated: [...curated.values()].map(({ venue, slimVenue }) => ({
      id: venue.id,
      name: venue.name,
      area: venueAreaLabel({ locality: slimVenue.locality, primaryBorough: venue.borough }),
      areaHints: [venue.borough],
      postcodeDistrict: postcodeOutwardFromText(slimVenue.filterHints?.searchText ?? "") ?? undefined,
      closed: isVerifiedClosedCuratedVenue(venue.id),
    })),
    national: national.pubs.map((pub) => ({
      id: pub.id,
      name: pub.name,
      area: pub.address,
      areaHints: pub.address.split(",").map((part) => part.trim()),
      postcodeDistrict: postcodeOutwardFromText(pub.address) ?? undefined,
      closed: pub.closed,
    })),
  };
}

const INSTAGRAM_RESERVED_PATHS = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "share",
  "about", "legal", "privacy", "terms", "developer", "web",
]);

function sourceAttribution(value: string | undefined): ImportSource | null {
  if (value === undefined || value.trim() === "") return null;
  if (!isHarvestableOperatorUrl(value)) {
    throw new RangeError("Use a public HTTPS source link without credentials.");
  }
  const url = new URL(value.trim());
  if (url.protocol !== "https:") {
    throw new RangeError("Use a public HTTPS source link without credentials.");
  }
  const host = normalizeHarvestHostname(url.hostname)?.replace(/^(?:www|m)\./, "");
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return { url: url.href, platform: "tiktok", handle: null };
  }
  if (host === "tiktok.com") {
    const handle = /^\/@([a-z0-9_.]{1,24})(?:\/|$)/i.exec(url.pathname)?.[1];
    return { url: url.href, platform: "tiktok", handle: handle ? `@${handle}` : null };
  }
  if (host === "instagram.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const first = parts[0] ?? "";
    const hasCreatorPath = parts.length === 1
      || (parts.length === 3 && ["p", "reel", "tv"].includes(parts[1] ?? ""));
    const handle = hasCreatorPath && /^[a-z0-9_.]{1,30}$/i.test(first)
      && !INSTAGRAM_RESERVED_PATHS.has(first.toLowerCase()) ? `@${first}` : null;
    return { url: url.href, platform: "instagram", handle };
  }
  return { url: url.href, platform: "other", handle: null };
}

function normalizedText(value: string): string {
  return value.toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedName(value: string): string {
  return normalizedText(value).replace(/^(?:the|ye olde)\s+/, "");
}

const fallbackSchema = z.array(z.object({
  name: z.string().trim().min(1).max(4000),
  areaHint: z.string().trim().max(4000),
})).max(40);

async function fallbackLines(
  text: string,
  extract: (text: string) => Promise<unknown>,
): Promise<ExtractedLine[]> {
  try {
    const parsed = fallbackSchema.safeParse(await extract(text));
    if (!parsed.success) return [];
    const input = ` ${normalizedText(text)} `;
    const seen = new Set<string>();
    return parsed.data.flatMap(({ name, areaHint }) => {
      const normalized = normalizedText(name);
      if (!normalized || !input.includes(` ${normalized} `) || seen.has(normalized)) return [];
      seen.add(normalized);
      const rawLine = text.split(/\r?\n/).find((line) =>
        ` ${normalizedText(line)} `.includes(` ${normalized} `)) ?? text;
      const hint = normalizedText(areaHint);
      return [{
        rawLine,
        name,
        areaHint: hint && ` ${normalizedText(rawLine)} `.includes(` ${hint} `) ? areaHint : "",
      }];
    }).sort((left, right) => input.indexOf(` ${normalizedText(left.name)} `)
      - input.indexOf(` ${normalizedText(right.name)} `));
  } catch {
    // A failed extractor leaves the deterministic result available for review.
    return [];
  }
}

function extractLines(text: string): ExtractedLine[] {
  const lines = text.split(/\r?\n|\s+(?=(?:\d+[.)]\s|[•●▪◦]\s|(?:\p{Extended_Pictographic}[\uFE0F\u200D]?)+\s|\d\uFE0F?\u20E3\s))/u);
  return lines.map((rawLine) => {
    rawLine = rawLine.trim();
    const line = rawLine.replace(/^(?:(?:\d+[.)]|[-*•●▪◦]|\d\uFE0F?\u20E3|(?:\p{Extended_Pictographic}[\uFE0F\u200D]?)+)\s*)+/u, "");
    const [name = "", ...tail] = line.split(/,|\s[-\u2013\u2014]\s|\(/);
    return { rawLine, name: name.trim(), areaHint: tail.join(" ").replace(/\)$/, "").trim() };
  }).filter((line) => line.name.length > 0);
}

function matchLine(line: ExtractedLine, catalog: ImportCatalog): ImportItem {
  const name = normalizedName(line.name);
  for (const layer of ["curated", "national"] as const) {
    let matches = [...new Map(catalog[layer]
      .filter((venue) => normalizedName(venue.name) === name)
      .map((venue) => [venue.id, venue])).values()];
    if (!matches.length) continue;
    if (matches.length > 1 && line.areaHint) {
      const hint = ` ${normalizedName(line.areaHint)} `;
      const areaMatches = matches.filter((venue) => {
        const areas = [venue.area, venue.postcodeDistrict, ...(venue.areaHints ?? [])];
        return areas.some((area) => {
          const normalized = area ? normalizedName(area) : "";
          return normalized.length > 0 && hint.includes(` ${normalized} `);
        });
      });
      if (areaMatches.length) matches = areaMatches;
    }
    const candidates: ImportCandidate[] = matches.slice(0, 4).map((venue) => ({
      id: venue.id, name: venue.name, area: venue.area,
      ...(venue.postcodeDistrict ? { postcodeDistrict: venue.postcodeDistrict } : {}),
      ...(venue.closed ? { closed: true as const } : {}),
      ...(layer === "national" ? { price: null } : {}),
      layer,
    }));
    if (matches.length > 1) return { ...line, state: "ambiguous", candidates, candidateCount: matches.length };
    const venue = candidates[0];
    if (venue) return { ...line, state: venue.closed ? "closed" : "matched", venue };
  }
  return { ...line, state: "unmatched" };
}

/** The optional model adapter receives pasted text only, never the source URL. */
export async function importPubList(
  input: { text: string; sourceUrl?: string },
  catalog?: ImportCatalog,
  extractFallback?: (text: string) => Promise<unknown>,
): Promise<{ source: ImportSource | null; items: ImportItem[]; truncated: boolean }> {
  if (input.text.length > 4000) throw new RangeError("The pub list must contain 4,000 characters or fewer.");
  const source = sourceAttribution(input.sourceUrl);
  let lines = extractLines(input.text);
  if (!lines.length) throw new RangeError("Paste at least one pub name.");
  catalog ??= await loadCatalog();
  if (lines.length < 2 && extractFallback) {
    const extracted = await fallbackLines(input.text, extractFallback);
    const known = lines.filter((line) => matchLine(line, catalog).state !== "unmatched");
    const preservesKnown = known.every((line) => extracted.some((candidate) =>
      normalizedName(candidate.name) === normalizedName(line.name)));
    if (extracted.length && preservesKnown) {
      lines = extracted.map((candidate) => known.find((line) =>
        normalizedName(candidate.name) === normalizedName(line.name)) ?? candidate);
    }
  }
  return {
    source,
    items: lines.slice(0, 40).map((line) => matchLine(line, catalog)),
    truncated: lines.length > 40,
  };
}
