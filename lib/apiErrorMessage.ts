import { serializeInlineScriptJson } from "@/lib/inlineScriptJson";

const SAFE_FALLBACK_MESSAGE = "Something went wrong. Try again.";

export const OFFLINE_RETRY_MESSAGE = "You look offline. Reconnect, then try again.";
export const INVITE_LINK_FALLBACK_MESSAGE = "Could not mint an invite link.";

function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Prefer offline copy for share, copy, and retry surfaces when the browser is offline. */
export function offlineOrMessage(onlineMessage: string): string {
  return isBrowserOffline() ? OFFLINE_RETRY_MESSAGE : onlineMessage;
}

/**
 * A JavaScript expression for a server-rendered INLINE <script> body, so both
 * string literals are built by the one hardened inline-script serializer rather
 * than a bare JSON.stringify: a "</script>" in the copy would otherwise close
 * the element. The \uXXXX escapes are valid inside a JavaScript string literal
 * and decode to the same characters at runtime, so the rendered copy is
 * unchanged.
 */
export function inlineOfflineOrMessageJs(onlineMessage: string): string {
  const offlineLiteral = serializeInlineScriptJson(OFFLINE_RETRY_MESSAGE);
  const onlineLiteral = serializeInlineScriptJson(onlineMessage);
  return `navigator.onLine===false?${offlineLiteral}:${onlineLiteral}`;
}

function safeFallback(fallback: string): string {
  return typeof fallback === "string" && fallback.trim()
    ? fallback.trim()
    : SAFE_FALLBACK_MESSAGE;
}

/** Read a response body only when its media type promises JSON. */
export async function readApiJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return null;
  return response.json().catch(() => null);
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
  if (!isOnline) return OFFLINE_RETRY_MESSAGE;
  return errorMessageFrom(body, INVITE_LINK_FALLBACK_MESSAGE);
}
