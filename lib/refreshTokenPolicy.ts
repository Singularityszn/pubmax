/** Browser-safe shape check shared by every local refresh-token lane. */
const MAX_REFRESH_TOKEN_LENGTH = 2_048;

export function isPlausibleRefreshToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= MAX_REFRESH_TOKEN_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}
