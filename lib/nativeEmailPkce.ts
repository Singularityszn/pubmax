import { AUTH_ATTEMPT_PARAM, isAuthAttemptId, type AuthFragmentStorage } from "@/lib/authRedirect";

export const IOS_EMAIL_AUTH_MODE = "ios-email-pkce";
export const IOS_EMAIL_CALLBACK = "pubmaxx://native-email/callback";
export const NATIVE_EMAIL_RECEIPT_KEY = "pubmax_native_email_attempt_v1";
export const NATIVE_EMAIL_RECEIPT_TTL_MS = 60 * 60 * 1000;
export type NativeEmailReceipt = {
  version: 1; id: string; verifier: string; callbackUrl: string;
  expectedEmail: string | null; authOrigin: string; createdAt: number; expiresAt: number;
};
export function normalizeNativeEmail(email: string): string { return email.trim().toLowerCase(); }
export function isS256CodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
export function isNativeEmailCallbackUrl(url: URL): boolean {
  return url.pathname === "/auth/callback" && !url.hash &&
    url.searchParams.getAll("native").length === 1 && url.searchParams.get("native") === IOS_EMAIL_AUTH_MODE &&
    url.searchParams.getAll(AUTH_ATTEMPT_PARAM).length === 1 && isAuthAttemptId(url.searchParams.get(AUTH_ATTEMPT_PARAM));
}
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function createEmailPkce(cryptoProvider: Crypto = crypto): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(cryptoProvider.getRandomValues(new Uint8Array(48)));
  const digest = await cryptoProvider.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}
export function readNativeEmailReceipt(storage: AuthFragmentStorage | null, origin: string, now = Date.now()): NativeEmailReceipt | null {
  try {
    const raw = storage?.getItem(NATIVE_EMAIL_RECEIPT_KEY);
    if (!raw || raw.length > 8192) return null;
    const row = JSON.parse(raw) as Partial<NativeEmailReceipt>;
    if (Object.keys(row).sort().join(",") !== "authOrigin,callbackUrl,createdAt,expectedEmail,expiresAt,id,verifier,version" ||
        row.version !== 1 || !isAuthAttemptId(row.id) || typeof row.verifier !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(row.verifier) ||
        typeof row.createdAt !== "number" || typeof row.expiresAt !== "number" || !Number.isFinite(row.createdAt) ||
        row.createdAt > now || row.expiresAt !== row.createdAt + NATIVE_EMAIL_RECEIPT_TTL_MS ||
        typeof row.authOrigin !== "string" || new URL(row.authOrigin).origin !== row.authOrigin ||
        !/^https?:\/\//.test(row.authOrigin) || typeof row.callbackUrl !== "string" || row.callbackUrl.length > 4096 ||
        !(row.expectedEmail === null || (typeof row.expectedEmail === "string" && row.expectedEmail.length <= 320 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.expectedEmail) && row.expectedEmail === normalizeNativeEmail(row.expectedEmail)))) return null;
    if (row.expiresAt <= now) { storage?.removeItem(NATIVE_EMAIL_RECEIPT_KEY); return null; }
    const callback = new URL(row.callbackUrl);
    if (callback.origin !== origin || !isNativeEmailCallbackUrl(callback) || callback.searchParams.get(AUTH_ATTEMPT_PARAM) !== row.id) return null;
    return row as NativeEmailReceipt;
  } catch { return null; }
}
export function storeNativeEmailReceipt(storage: AuthFragmentStorage | null, receipt: NativeEmailReceipt): boolean {
  if (!storage) return false;
  try {
    const raw = JSON.stringify(receipt);
    storage.setItem(NATIVE_EMAIL_RECEIPT_KEY, raw);
    return storage.getItem(NATIVE_EMAIL_RECEIPT_KEY) === raw;
  } catch { return false; }
}
export function removeNativeEmailReceipt(storage: AuthFragmentStorage | null, id?: string): boolean {
  try {
    if (!storage) return false;
    const raw = storage.getItem(NATIVE_EMAIL_RECEIPT_KEY);
    if (!raw) return false;
    if (id && (JSON.parse(raw) as { id?: unknown }).id !== id) return false;
    storage.removeItem(NATIVE_EMAIL_RECEIPT_KEY);
    return storage.getItem(NATIVE_EMAIL_RECEIPT_KEY) === null;
  } catch { return false; }
}
