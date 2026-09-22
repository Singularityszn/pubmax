"use client";

const PUBLIC_WEB_PUSH_TOKEN_KEY = "pubmax_public_web_push_token";
const WEB_PUSH_PROMPT_ENABLED_KEY = "pubmax:webPush:enabled:v1";
const WEB_PUSH_PROMPT_EVENT = "pubmax:web-push-prompt";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(WEB_PUSH_PROMPT_EVENT));
  } catch {
    // Persisted state remains authoritative.
  }
}

export function markPublicWebPushToken(subscriptionToken: string): boolean {
  const target = storage();
  if (!target) return false;
  try {
    target.setItem(PUBLIC_WEB_PUSH_TOKEN_KEY, subscriptionToken);
    return target.getItem(PUBLIC_WEB_PUSH_TOKEN_KEY) === subscriptionToken;
  } catch {
    return false;
  }
}

export type PublicPushTokenRead =
  | { status: "none" }
  | { status: "active"; subscriptionToken: string }
  | { status: "unavailable" };

export function readPublicWebPushToken(): PublicPushTokenRead {
  if (typeof window === "undefined") return { status: "none" };
  try {
    const target = storage();
    if (!target) return { status: "none" };
    const subscriptionToken = target.getItem(PUBLIC_WEB_PUSH_TOKEN_KEY);
    return subscriptionToken
      ? { status: "active", subscriptionToken }
      : { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}

export function shouldPreservePublicWebPushToken(
  subscriptionToken: string,
): boolean {
  const publicToken = readPublicWebPushToken();
  return publicToken.status === "active" &&
    publicToken.subscriptionToken === subscriptionToken;
}

/** Clear persisted consent only when its exact physical token is gone. */
export function clearPublicWebPushRegistration(
  subscriptionToken?: string,
): void {
  const target = storage();
  if (!target) return;
  try {
    const storedToken = target.getItem(PUBLIC_WEB_PUSH_TOKEN_KEY);
    if (subscriptionToken && storedToken && storedToken !== subscriptionToken) {
      return;
    }
    target.removeItem(PUBLIC_WEB_PUSH_TOKEN_KEY);
    target.removeItem(WEB_PUSH_PROMPT_ENABLED_KEY);
    notify();
  } catch {
    // Physical subscription state remains authoritative.
  }
}
