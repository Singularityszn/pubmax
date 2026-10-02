/**
 * True when `value` parses as an absolute http(s) URL.
 * Non-strings are false. The default rejects whitespace and an empty hostname
 * (callers trim first). `allowWhitespace` is the price-update, editorial,
 * hyped-pub and digest copies: they accept a string the URL constructor
 * rewrites, including a space it percent-encodes, and they do not require a
 * hostname.
 */
export function isHttpUrl(
  value: unknown,
  options?: { allowWhitespace?: boolean },
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const allowWhitespace = options?.allowWhitespace === true;
  if (!allowWhitespace && /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!allowWhitespace && !url.hostname) return false;
    return true;
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
