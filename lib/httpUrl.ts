import {
  firstHttp as firstHttpImpl,
  firstHttps as firstHttpsImpl,
  isHttpUrl as isHttpUrlImpl,
} from "./httpUrl.mjs";

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
  return isHttpUrlImpl(value, options);
}

/** First non-empty trimmed http(s) candidate, or `""` if none. */
export function firstHttp(...candidates: Array<string | undefined | null>): string {
  return firstHttpImpl(...candidates);
}

/** First non-empty trimmed https candidate, or "" if none. */
export function firstHttps(...candidates: Array<string | undefined | null>): string {
  return firstHttpsImpl(...candidates);
}
