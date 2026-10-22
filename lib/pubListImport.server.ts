import "server-only";

type ImportVenue = {
  id: string;
  name: string;
  area: string;
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

function normalizedName(value: string): string {
  return value.toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|ye olde)\s+/, "");
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
      const areaMatches = matches.filter((venue) => [venue.area, venue.postcodeDistrict].some((area) => {
        const normalized = area ? normalizedName(area) : "";
        return normalized.length > 0 && hint.includes(` ${normalized} `);
      }));
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

/** Match only supplied text and venue records. This entry point performs no I/O. */
export function importPubList(input: { text: string }, catalog: ImportCatalog): { items: ImportItem[]; truncated: boolean } {
  if (input.text.length > 4000) throw new RangeError("The pub list must contain 4,000 characters or fewer.");
  const lines = extractLines(input.text);
  if (!lines.length) throw new RangeError("Paste at least one pub name.");
  return {
    items: lines.slice(0, 40).map((line) => matchLine(line, catalog)),
    truncated: lines.length > 40,
  };
}
