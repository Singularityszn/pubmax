/** True when `value` parses as an absolute http(s) URL (no trim — callers trim first). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
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
    if (!/^https:\/\//i.test(trimmed)) continue;
    try {
      if (new URL(trimmed).protocol === "https:") return trimmed;
    } catch {
      // Try next candidate.
    }
  }
  return "";
}
