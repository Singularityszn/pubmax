// Browser-safe Web Push subscription codec. The existing push token table is
// keyed by one opaque string, so a web PushSubscription is stored as a compact,
// prefixed token without changing the provider/fan-out interface. The payload
// carries no account, Plan, location, or other identity.

export const WEB_PUSH_TOKEN_PREFIX = "webpush:";

export type WebPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function webPushKey(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > maxLength) return null;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export function validateWebPushSubscription(value: unknown): WebPushSubscription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  let endpoint: URL;
  try {
    endpoint = new URL(typeof row.endpoint === "string" ? row.endpoint : "");
  } catch {
    return null;
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
    return null;
  }
  const keys = row.keys && typeof row.keys === "object" && !Array.isArray(row.keys)
    ? row.keys as Record<string, unknown>
    : null;
  const p256dh = webPushKey(keys?.p256dh, 256);
  const auth = webPushKey(keys?.auth, 128);
  const expirationTime = row.expirationTime == null
    ? null
    : typeof row.expirationTime === "number" && Number.isFinite(row.expirationTime) && row.expirationTime > 0
      ? row.expirationTime
      : undefined;
  if (!p256dh || !auth || expirationTime === undefined) return null;
  return { endpoint: endpoint.toString(), expirationTime, keys: { p256dh, auth } };
}

export function encodeWebPushSubscription(value: unknown): string | null {
  const subscription = validateWebPushSubscription(value);
  if (!subscription) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(subscription));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${WEB_PUSH_TOKEN_PREFIX}${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export function decodeWebPushSubscription(token: string): WebPushSubscription | null {
  if (!token.startsWith(WEB_PUSH_TOKEN_PREFIX)) return null;
  try {
    const encoded = token.slice(WEB_PUSH_TOKEN_PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const raw = new TextDecoder().decode(bytes);
    return validateWebPushSubscription(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function isWebPushToken(token: string): boolean {
  return token.startsWith(WEB_PUSH_TOKEN_PREFIX);
}
