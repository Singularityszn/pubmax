// Shared untrusted-text helpers. These consolidate the byte-identical `readString`
// / `clean*` definitions that were copy-pasted across the community write paths
// (pint-drops, comments, reactions, saved-pubs, profiles). One place so the trust
// boundary can't drift between routes.
//
// NOTE: lib/pintDrops.ts keeps its OWN private clean() on purpose — it is a
// load-bearing validator and is intentionally left untouched to avoid behaviour
// drift there. This module reproduces the SAME behaviour, verbatim, for the
// callers that duplicated it.

/**
 * Read an untrusted value as a non-empty string, or undefined. The exact shape
 * (`typeof === "string" && value.trim() ? value : undefined`) used verbatim by
 * the pint-drops / comments / reactions / saved-pubs routes. Note: it returns
 * the ORIGINAL (untrimmed) value — trimming is only the emptiness test.
 */
export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Grapheme segmenter, built once and only if the runtime has one. Constructing
 * it can throw on an ICU-stripped build, which reads the same as absent here.
 */
let graphemeSegmenter: Intl.Segmenter | null | undefined;

function segmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter === undefined) {
    try {
      graphemeSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter("en", { granularity: "grapheme" })
        : null;
    } catch {
      graphemeSegmenter = null;
    }
  }
  return graphemeSegmenter;
}

/**
 * The pieces a cap may cut between. With `Intl.Segmenter` these are grapheme
 * clusters, so a flag, a ZWJ sequence and a combining mark each stay whole.
 * Without it they are code points, which is weaker but still never splits a
 * surrogate pair: a cut mid-cluster costs legibility, a cut mid-pair stores
 * bytes no UTF-8 database will accept.
 */
function* cuttablePieces(text: string): Generator<string> {
  const found = segmenter();
  if (found) {
    for (const { segment } of found.segment(text)) yield segment;
    return;
  }
  for (const point of text) yield point;
}

/**
 * Cap `text` at `cap` CODE POINTS, cutting only on a piece boundary.
 *
 * The unit is code points because that is what the database counts: every
 * `char_length(...) between 1 and N` check behind these callers (crew name 40,
 * plan title 80, venue name 120, handle 30, caption 500) counts code points, so
 * counting graphemes instead would let 40 flags through as 80 code points and
 * trade one 500-class refusal for another. The boundary is a grapheme so that
 * what a reader typed as one character is kept whole or dropped whole.
 */
function capCodePoints(text: string, cap: number): string {
  if (cap <= 0) return "";
  // A string this short is already inside the cap and needs no cut at all: the
  // UTF-16 length is an upper bound on both the code-point and grapheme counts.
  if (text.length <= cap) return text;
  let out = "";
  let points = 0;
  for (const piece of cuttablePieces(text)) {
    const pieceLength = [...piece].length;
    if (points + pieceLength > cap) break;
    out += piece;
    points += pieceLength;
  }
  return out;
}

/**
 * Trust boundary for free text. Strip anything that could be inline HTML angle
 * brackets, drop ASCII control chars (U+0000–U+001F and U+007F), collapse runs
 * of whitespace, trim, then cap to `cap` code points on a grapheme boundary.
 * Returns "" for a non-string.
 *
 * The cap used to be `.slice(0, cap)`, which counts UTF-16 code units and so
 * cut a surrogate pair in half whenever an emoji straddled the boundary. A lone
 * surrogate is not valid UTF-8, so Postgres refused the whole write and a
 * 40-character name ending in an emoji answered 503 rather than being trimmed
 * (battle-test defect D03).
 */
export function cleanText(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  const normalised = value
    .replace(/[<>]/g, "") // no inline user HTML
    .replace(/[\u0000-\u001F\u007F]/g, " ") // strip control chars
    .replace(/\s+/g, " ")
    .trim();
  return capCodePoints(normalised, cap);
}

/**
 * Validate an untrusted avatar/link URL. Returns the trimmed URL when it is a
 * well-formed http(s) URL within `cap` characters, otherwise undefined. Rejects
 * javascript:/data: schemes, bare strings, and over-long URLs so nothing that
 * isn't a real remote URL is ever stored. An empty/blank value returns undefined
 * (callers treat that as "cleared"). Consolidates the profile route + store
 * avatar checks.
 */
export function cleanHttpUrl(value: unknown, cap: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > cap) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return trimmed;
}
