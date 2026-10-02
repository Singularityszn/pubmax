/**
 * True when `value` parses as an absolute http(s) URL.
 * Non-strings and empty strings are false. The default rejects any whitespace,
 * so callers trim first. `allowWhitespace` is the price-update, editorial,
 * hyped-pub and digest copies: the URL parser trims surrounding whitespace and
 * percent-encodes a space in the path, and that string is accepted.
 */
export function isHttpUrl(
  value: unknown,
  options?: { allowWhitespace?: boolean },
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const allowWhitespace = options?.allowWhitespace === true;
  if (!allowWhitespace && /\s/.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** First non-empty trimmed http(s) candidate, or `""` if none. */
export function firstHttp(...candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed && isHttpUrl(trimmed)) return trimmed;
  }
  return "";
}

/** First non-empty trimmed https candidate, or "" if none. */
export function firstHttps(...candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (!trimmed || !isHttpUrl(trimmed)) continue;
    const url = new URL(trimmed);
    if (url.protocol === "https:") return trimmed;
  }
  return "";
}
