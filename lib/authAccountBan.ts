export const AUTH_ACCOUNT_BANNED_MESSAGE =
  "This account has been banned for not following the PubMaxx community guidelines.";

export const AUTH_ACCOUNT_BANNED_TERMS_PATH = "/terms";

type GoTrueLikeError = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  name?: unknown;
};

export function isGoTrueUserBannedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as GoTrueLikeError;
  if (candidate.code === "user_banned") return true;
  const searchable = `${candidate.code ?? ""} ${candidate.message ?? ""}`.toLowerCase();
  if (/user_banned|user is banned|banned_until/.test(searchable)) return true;
  return candidate.status === 403 && searchable.includes("banned");
}

export function isAuthUserBannedUntil(
  user: { banned_until?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  const raw = user?.banned_until;
  if (typeof raw !== "string" || !raw.trim()) return false;
  const until = Date.parse(raw);
  return Number.isFinite(until) && until > now;
}

export function authAccountBanMessageFromError(error: unknown): string | null {
  return isGoTrueUserBannedError(error) ? AUTH_ACCOUNT_BANNED_MESSAGE : null;
}
