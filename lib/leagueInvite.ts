import type { Route } from "next";

/** No 0, O, 1 or I, so a code read aloud is the code typed. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
const INVITE_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const LEAGUE_INVITE_PREFIX = "/social/leagues/join/";

/**
 * A typed or pasted code, or null. Case, spaces and dashes do not matter, so
 * "abcd-efgh" is "ABCDEFGH".
 */
export function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  return INVITE_CODE.test(code) ? code : null;
}

/** "ABCD-EFGH", so a code is easy to read out. */
export function formatInviteCode(code: string): string {
  return code.length === INVITE_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** The path a shared invite link opens. */
export function leagueInvitePath(code: string): string {
  return `${LEAGUE_INVITE_PREFIX}${encodeURIComponent(code)}`;
}

export function safeLeagueInviteReturnTo(raw: string | null | undefined): Route | null {
  if (typeof raw !== "string" || !raw.startsWith(LEAGUE_INVITE_PREFIX)) return null;
  const code = raw.slice(LEAGUE_INVITE_PREFIX.length);
  return INVITE_CODE.test(code) ? leagueInvitePath(code) as Route : null;
}
