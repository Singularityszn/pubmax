// Pure, node-free sanitiser for the read-only heritage facts payload.
//
// Shared by the venue Story ("Lore") tab (a client component) and its unit
// test. Deliberately kept free of node:fs / node:crypto — unlike lib/heritage,
// which reaches into the shipped cache + Supabase server-side — so it is safe to
// bundle into a client component.
//
// Provenance-honest: this only ever validates, trims, and de-dupes the server
// payload. It never invents a fact, a source, or a citation — a malformed or
// empty response degrades to [] rather than to anything fabricated.

// Mirror of lib/heritage's HeritageFact, redeclared here so the client bundle
// never has to import that node-backed module just for the shape.
export type HeritageFact = {
  source: "osm" | "wikidata" | "wikipedia" | "seed";
  fact: string;
  sourceRef?: string;
};

// The only sources we render. An entry with any other (or missing) source is
// dropped rather than surfaced under an unknown provenance.
const KNOWN_SOURCES: ReadonlySet<HeritageFact["source"]> = new Set([
  "osm",
  "wikidata",
  "wikipedia",
  "seed",
]);

function isKnownSource(value: unknown): value is HeritageFact["source"] {
  return typeof value === "string" && KNOWN_SOURCES.has(value as HeritageFact["source"]);
}

// Validate + normalise the `{ facts }` array from GET /api/heritage into a clean
// HeritageFact[]. Fail-soft: a non-array yields []. Each kept entry carries a
// known source and non-empty fact text (trimmed); sourceRef survives only when
// it is a non-empty string. Facts are de-duped case-insensitively on their
// trimmed text — first occurrence wins, input order preserved.
export function sanitizeHeritageFacts(raw: unknown): HeritageFact[] {
  if (!Array.isArray(raw)) return [];
  const out: HeritageFact[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (!isKnownSource(record.source)) continue;
    const fact = typeof record.fact === "string" ? record.fact.trim() : "";
    if (!fact) continue;
    const key = fact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const clean: HeritageFact = { source: record.source, fact };
    const sourceRef = typeof record.sourceRef === "string" ? record.sourceRef.trim() : "";
    if (sourceRef) clean.sourceRef = sourceRef;
    out.push(clean);
  }
  return out;
}
