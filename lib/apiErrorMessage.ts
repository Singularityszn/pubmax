const SAFE_FALLBACK_MESSAGE = "Something went wrong. Please try again.";

export const INVITE_LINK_FALLBACK_MESSAGE = "Could not mint an invite link.";
export const INVITE_LINK_OFFLINE_MESSAGE = "You look offline. Reconnect, then try again.";

function safeFallback(fallback: string): string {
  return typeof fallback === "string" && fallback.trim()
    ? fallback.trim()
    : SAFE_FALLBACK_MESSAGE;
}

/** Read only human-facing API error copy from an untrusted response body. */
export function errorMessageFrom(body: unknown, fallback: string): string {
  const safeMessage = safeFallback(fallback);
  if (!body || typeof body !== "object") return safeMessage;

  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return safeMessage;
}

export function findYourLotInviteFailureMessage(
  body: unknown,
  isOnline: boolean,
): string {
  if (!isOnline) return INVITE_LINK_OFFLINE_MESSAGE;
  return errorMessageFrom(body, INVITE_LINK_FALLBACK_MESSAGE);
}
